import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool, withTransaction, audit } from "./db.js";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const app = express();

const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters.");

const webauthnRelyingParty = {
  id: process.env.WEBAUTHN_RP_ID || "localhost",
  name: process.env.WEBAUTHN_RP_NAME || "حضوربان",
};
const webauthnOrigins = (process.env.WEBAUTHN_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const roles = ["admin", "teacher", "student"];
const statusMap = {
  حاضر: "present",
  تأخیر: "late",
  "با تأخیر": "late",
  غایب: "absent",
  "غیبت موجه": "excused",
  "خروج زودهنگام": "left_early",
  ثبت‌نشده: "unmarked",
};
const bodyLimit = "1mb";
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN?.split(",")
        .map((item) => item.trim())
        .filter(Boolean) || false,
    credentials: false,
  }),
);
app.use(express.json({ limit: bodyLimit }));
// مسیر ذخیره تصاویر دانشجویان
const uploadsRoot = path.resolve(process.cwd(), "uploads");
const studentPhotosDir = path.join(uploadsRoot, "students");

fs.mkdirSync(studentPhotosDir, { recursive: true });
// Uploaded reference photos are served to the face-recognition engine in the
// browser.  They are intentionally outside /api so the static middleware does
// not require a JWT.
app.use("/uploads", express.static(uploadsRoot, { fallthrough: true }));
const studentPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, studentPhotosDir);
  },

  filename: (req, file, cb) => {
    const extensions = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    };

    const extension = extensions[file.mimetype];

    if (!extension) {
      return cb(new Error("فرمت تصویر مجاز نیست."));
    }

    cb(null, `${crypto.randomUUID()}${extension}`);
  },
});
const uploadStudentPhoto = multer({
  storage: studentPhotoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // حداکثر ۵ مگابایت
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        Object.assign(new Error("فقط تصاویر JPG، PNG و WEBP مجاز هستند."), {
          status: 400,
        }),
      );
    }

    cb(null, true);
  },
});
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
function tokenFor(user, organizationId = user.organization_id) {
  return jwt.sign(
    { sub: user.id, org: organizationId, role: user.role },
    jwtSecret,
    { expiresIn: "8h", issuer: "hozorban-api", audience: "hozorban-web" },
  );
}
function authorize(...allowed) {
  return (req, res, next) =>
    allowed.includes(req.user.role)
      ? next()
      : res.status(403).json({ message: "دسترسی کافی نیست." });
}
function authenticate(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token)
    return res.status(401).json({ message: "ورود به سامانه لازم است." });
  try {
    req.user = jwt.verify(token, jwtSecret, {
      issuer: "hozorban-api",
      audience: "hozorban-web",
    });
    return next();
  } catch {
    return res.status(401).json({ message: "نشست معتبر نیست." });
  }
}
function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(
      source === "query" ? req.query : req.body,
    );
    if (!result.success)
      return res.status(422).json({
        message: "اطلاعات ارسالی معتبر نیست.",
        errors: result.error.flatten(),
      });
    if (source === "query") {
      Object.defineProperty(req, "query", {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req.body = result.data;
    }
    return next();
  };
}

const fingerprintResponseSchemas = {
  registration: z.object({ response: z.any() }).passthrough(),
  authentication: z.object({ response: z.any() }).passthrough(),
};

async function createWebAuthnChallenge({ organizationId, userId, kind, sessionId }) {
  const challenge = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + Number(process.env.WEBAUTHN_CHALLENGE_TTL_MINUTES || 5) * 60_000);
  const { rows } = await pool.query(
    `INSERT INTO webauthn_challenges (organization_id, user_id, student_id, kind, challenge, session_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, kind, challenge, expires_at`,
    [organizationId, userId, null, kind, challenge, sessionId, expiresAt],
  );
  return rows[0];
}

async function takeWebAuthnChallenge({ organizationId, userId, kind, sessionId }) {
  const { rows } = await pool.query(
    `SELECT id, challenge FROM webauthn_challenges
      WHERE organization_id = $1 AND user_id = $2 AND kind = $3 AND session_id IS NOT DISTINCT FROM $4 AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [organizationId, userId, kind, sessionId],
  );
  const found = rows[0];
  if (!found) return null;
  await pool.query(`DELETE FROM webauthn_challenges WHERE id = $1`, [found.id]);
  return found.challenge;
}

async function safeVerifyRegistration(options) {
  try {
    return await verifyRegistrationResponse(options);
  } catch {
    return { verified: false };
  }
}

async function safeVerifyAuthentication(options) {
  try {
    return await verifyAuthenticationResponse(options);
  } catch {
    return { verified: false };
  }
}

async function listFingerprintCredentials(organizationId, studentId = null) {
  const conditions = [
    "fc.organization_id = $1",
    "fc.revoked_at IS NULL",
  ];
  const params = [organizationId];
  if (studentId) {
    params.push(studentId);
    conditions.push(`fc.student_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT fc.id, fc.student_id AS "studentId", fc.user_id AS "userId",
            fc.credential_id AS "credentialId", encode(fc.public_key::bytea, 'hex') AS "publicKeyHex",
            fc.counter, fc.transports, fc.device_type AS "deviceType", fc.backed_up AS "backedUp",
            fc.aaguid AS "aaguid", fc.device_label AS "deviceLabel",
            fc.created_at AS "createdAt", fc.last_used_at AS "lastUsedAt", fc.revoked_at AS "revokedAt",
            st.student_number AS "studentNumber", st.full_name AS "fullName"
       FROM fingerprint_credentials fc
       JOIN students st ON st.id = fc.student_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY fc.created_at`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    publicKey: row.publicKeyHex ? Buffer.from(row.publicKeyHex, "hex") : null,
    transports: row.transports || [],
  }));
}

async function findStudentByUserId(userId, organizationId) {
  const { rows } = await pool.query(
    `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS "fullName"
       FROM users u
       JOIN students st ON st.id = u.student_id::uuid
      WHERE u.id = $1 AND u.organization_id = $2 AND u.is_active = true`,
    [userId, organizationId],
  );
  return rows[0] || null;
}
function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    role: row.role,
    studentId: row.student_id,
    avatarUrl: row.avatar_url,
  };
}

async function loadFaculty(organizationId) {
  if (!organizationId) return null;
  const { rows } = await pool.query(
    "SELECT id, name, code FROM organizations WHERE id = $1 AND is_active = true",
    [organizationId],
  );
  return rows[0] || null;
}

async function listUserFaculties(user) {
  if (user.role !== "teacher") {
    const faculty = await loadFaculty(user.organization_id);
    return faculty ? [faculty] : [];
  }
  // Teachers may belong to several faculties: home faculty plus explicit memberships.
  const { rows } = await pool.query(
    `SELECT o.id, o.name, o.code
       FROM organizations o
      WHERE o.is_active = true
        AND (o.id = $1 OR EXISTS (
              SELECT 1 FROM user_faculties uf
               WHERE uf.user_id = $2 AND uf.organization_id = o.id))
      ORDER BY (o.id = $1) DESC, o.name`,
    [user.organization_id, user.id],
  );
  return rows;
}

async function canAccessFaculty(user, organizationId) {
  if (!organizationId) return false;
  if (user.organization_id === organizationId) return true;
  if (user.role !== "teacher") return false;
  const { rowCount } = await pool.query(
    "SELECT 1 FROM user_faculties WHERE user_id = $1 AND organization_id = $2",
    [user.id, organizationId],
  );
  return rowCount > 0;
}

async function authPayload(user, organizationId = user.organization_id) {
  const faculty = await loadFaculty(organizationId);
  const faculties = await listUserFaculties(user);
  return {
    token: tokenFor(user, organizationId),
    user: { ...publicUser(user), faculty, faculties },
  };
}
const id = z.string().uuid();
const studentSchema = z.object({
  studentNumber: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(2).max(120),
  major: z.string().trim().max(120).optional().default(""),
  term: z.string().trim().max(30).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});
const courseSchema = z.object({
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(2).max(160),
  teacherName: z.string().trim().min(2).max(120),
  room: z.string().trim().max(80).optional().default(""),
  weekday: z.string().trim().max(20).optional().default(""),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  studentIds: z.array(id).max(1000).default([]),
});
const sessionSchema = z.object({
  courseId: id,
  date: z.string().date(),
  teacherName: z.string().trim().min(2).max(120),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  graceMinutes: z.number().int().min(0).max(180).default(10),
  openBeforeMinutes: z.number().int().min(0).max(180).default(15),
  closeAfterMinutes: z.number().int().min(0).max(180).default(30),
  studentIds: z.array(id).min(1).max(1000),
});
const attendanceStatusSchema = z.enum([
  "unmarked",
  "present",
  "late",
  "absent",
  "excused",
  "left_early",
]);
const attendanceMethodSchema = z
  .enum(["manual", "face", "voice", "class_camera", "system", "fingerprint"])
  .default("manual");
const attendanceUpsertSchema = z.object({
  sessionId: id,
  studentId: id,
  status: attendanceStatusSchema,
  method: attendanceMethodSchema,
  reason: z.string().trim().max(500).optional().default(""),
});
const settingsSchema = z.object({
  systemName: z.string().trim().min(1).max(120),
  lateAfterMinutes: z.number().int().min(0).max(120),
  notificationsEnabled: z.boolean().default(true),
  faceRecognitionEnabled: z.boolean().default(true),
});
const voiceSampleSchema = z.object({
  features: z.array(z.number().finite()).length(24),
  featureVersion: z.number().int().min(0).max(20).default(2),
});
const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(4000),
});
const ticketRespondSchema = z.object({
  response: z.string().trim().min(2).max(4000),
  outcome: z.enum(["accept", "reject"]).default("accept"),
});

app.get(
  "/health",
  asyncRoute(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  }),
);
app.get(
  "/api/faculties",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, name, code FROM organizations WHERE is_active = true ORDER BY name",
    );
    res.json({ faculties: rows });
  }),
);

app.post(
  "/api/auth/login",
  validate(
    z.object({
      email: z.string().trim().email().max(254),
      password: z.string().min(8).max(128),
      facultyId: z.string().uuid().optional(),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { email, password, facultyId } = req.body;
    // A multi-tenant deployment may legitimately reuse an email in different
    // organizations, so compare the password against every active candidate
    // instead of trusting whichever row PostgreSQL happens to return first.
    const result = await pool.query(
      `SELECT * FROM users
        WHERE lower(email) = lower($1) AND is_active = true
        ORDER BY created_at`,
      [email],
    );
    let user = null;
    for (const candidate of result.rows) {
      if (await bcrypt.compare(password, candidate.password_hash)) {
        user = candidate;
        break;
      }
    }
    if (!user)
      return res.status(401).json({ message: "ایمیل یا رمز عبور نادرست است." });

    const selectedOrg = facultyId || user.organization_id;
    const faculty = await loadFaculty(selectedOrg);
    if (!faculty)
      return res
        .status(404)
        .json({ message: "دانشکدهٔ انتخاب‌شده معتبر یا فعال نیست." });
    if (!(await canAccessFaculty(user, selectedOrg)))
      return res.status(403).json({
        message:
          user.role === "teacher"
            ? "شما عضو دانشکدهٔ انتخاب‌شده نیستید."
            : "این حساب به دانشکدهٔ انتخاب‌شده تعلق ندارد.",
      });

    res.json(await authPayload(user, selectedOrg));
  }),
);

app.post(
  "/api/registrations",
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      username: z.string().trim().min(3).max(120),
      password: z.string().min(8).max(128),
      facultyId: z.string().uuid().optional(),
      nationalId: z.string().trim().max(20).optional().default(""),
      major: z.string().trim().max(120).optional().default(""),
      term: z.string().trim().max(20).optional().default(""),
      phone: z.string().trim().max(40).optional().default(""),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { fullName, username, password, facultyId, nationalId, major, term, phone } =
      req.body;
    // A registration always belongs to exactly one faculty. The dropdown value is
    // required in the UI; fall back to the first active faculty for older clients.
    const faculty = facultyId
      ? await loadFaculty(facultyId)
      : (
          await pool.query(
            "SELECT id, name, code FROM organizations WHERE is_active = true ORDER BY created_at LIMIT 1",
          )
        ).rows[0];
    if (!faculty)
      return res
        .status(400)
        .json({ message: "دانشکدهٔ انتخاب‌شده معتبر یا فعال نیست." });
    const orgId = faculty.id;
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO registration_requests
         (organization_id, full_name, username, password_hash, national_id, major, term, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, full_name AS "fullName", username, national_id AS "nationalId", major, term, phone, status, created_at AS "createdAt"`,
      [orgId, fullName, username, passwordHash, nationalId, major, term, phone],
    );
    res.status(201).json(rows[0]);
  }),
);

app.use("/api", authenticate);
app.get(
  "/api/registrations",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", username, national_id AS "nationalId", major, term, phone, status, created_at AS "createdAt", reviewed_at AS "reviewedAt"
         FROM registration_requests
        WHERE organization_id = $1
        ORDER BY created_at DESC`,
      [req.user.org],
    );
    res.json(rows);
  }),
);

app.patch(
  "/api/registrations/:id/approve",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT * FROM registration_requests WHERE id = $1 AND organization_id = $2 AND status = 'pending'`,
        [req.params.id, req.user.org],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "درخواست یافت نشد یا قبلاً بررسی شده." });
      }
      const r = rows[0];
      const studentNumber = r.national_id || r.username;
      const studentRows = await client.query(
        `INSERT INTO students (organization_id, student_number, full_name, major, term, phone, status)
         VALUES ($1,$2,$3,$4,$5,$6,'active')
         ON CONFLICT (organization_id, student_number) DO UPDATE
           SET full_name=EXCLUDED.full_name, major=EXCLUDED.major, term=EXCLUDED.term, phone=EXCLUDED.phone, status='active', updated_at=now()
         RETURNING id`,
        [req.user.org, studentNumber, r.full_name, r.major, r.term, r.phone],
      );
      const studentId = studentRows.rows[0].id;
      const userRows = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, display_name, role, student_id, is_active)
         VALUES ($1,$2,$3,$4,'student',$5,true)
         ON CONFLICT (organization_id, email) DO UPDATE
           SET password_hash=EXCLUDED.password_hash, display_name=EXCLUDED.display_name, student_id=EXCLUDED.student_id, is_active=true, updated_at=now()
         RETURNING id`,
        [req.user.org, r.username, r.password_hash, r.full_name, studentId],
      );
      const userId = userRows.rows[0].id;
      await client.query(
        `UPDATE registration_requests
            SET status='approved', reviewed_at=now(), reviewed_by=$1, approved_student_id=$2, approved_user_id=$3
          WHERE id=$4`,
        [req.user.sub, studentId, userId, r.id],
      );
      await client.query("COMMIT");
      res.json({ ok: true, studentId, userId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.patch(
  "/api/registrations/:id/reject",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE registration_requests SET status='rejected', reviewed_at=now(), reviewed_by=$1
        WHERE id=$2 AND organization_id=$3 AND status='pending'`,
      [req.user.sub, req.params.id, req.user.org],
    );
    if (!rowCount) return res.status(404).json({ message: "درخواست یافت نشد یا قبلاً بررسی شده." });
    res.json({ ok: true });
  }),
);

app.post(
  "/api/tickets",
  validate(ticketSchema),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student)
      return res.status(404).json({ message: "حساب دانشجویی پیدا نشد." });
    const { rows } = await pool.query(
      `INSERT INTO support_tickets
         (organization_id, student_number, student_name, subject, message, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING id, student_number AS "studentNumber", student_name AS "studentName", subject, message, status, response, outcome, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [req.user.org, student.studentNumber, student.fullName, req.body.subject, req.body.message],
    );
    res.status(201).json(rows[0]);
  }),
);
app.get(
  "/api/tickets",
  asyncRoute(async (req, res) => {
    const isAdmin = req.user.role === "admin";
    const student = isAdmin
      ? null
      : await findStudentByUserId(req.user.sub, req.user.org);
    const params = [req.user.org];
    let sql = `SELECT id, student_number AS "studentNumber", student_name AS "studentName", subject, message, status, response, outcome, responded_at AS "respondedAt", created_at AS "createdAt", updated_at AS "updatedAt"
                FROM support_tickets
               WHERE organization_id = $1`;
    if (!isAdmin) {
      if (!student) return res.json([]);
      params.push(student.studentNumber);
      sql += ` AND student_number = $2`;
    }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }),
);
app.post(
  "/api/tickets/:id/respond",
  authorize("admin"),
  validate(ticketRespondSchema),
  asyncRoute(async (req, res) => {
    const { response, outcome } = req.body;
    const { rows } = await pool.query(
      `UPDATE support_tickets
          SET status = 'answered', response = $3, outcome = $4, responded_at = now(), updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND status = 'open'
        RETURNING id, student_number AS "studentNumber", student_name AS "studentName", subject, message, status, response, outcome, responded_at AS "respondedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [req.params.id, req.user.org, response, outcome],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ message: "درخواست یافت نشد یا قبلاً پاسخ داده شده است." });
    res.json(rows[0]);
  }),
);
app.post(
  "/api/tickets/:id/close",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE support_tickets
          SET status = 'closed', updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND status <> 'closed'
        RETURNING id, student_number AS "studentNumber", student_name AS "studentName", subject, message, status, response, outcome, responded_at AS "respondedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [req.params.id, req.user.org],
    );
    if (!rows[0])
      return res.status(404).json({ message: "درخواست یافت نشد." });
    res.json(rows[0]);
  }),
);

app.post(
  "/api/auth/switch-faculty",
  validate(z.object({ facultyId: id })),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND is_active = true",
      [req.user.sub],
    );
    const user = rows[0];
    if (!user)
      return res.status(401).json({ message: "ورود به سامانه لازم است." });
    if (!(await canAccessFaculty(user, req.body.facultyId)))
      return res.status(403).json({
        message:
          user.role === "teacher"
            ? "شما عضو دانشکدهٔ انتخاب‌شده نیستید."
            : "این حساب به دانشکدهٔ انتخاب‌شده تعلق ندارد.",
      });
    res.json(await authPayload(user, req.body.facultyId));
  }),
);

app.get(
  "/api/me",
  asyncRoute(async (req, res) => {
    // Look up by id only: a teacher's active faculty (req.user.org) may differ
    // from their home faculty, so filtering by organization would hide the row.
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND is_active = true",
      [req.user.sub],
    );
    if (!rows[0]) return res.json({ user: null });
    const faculty = await loadFaculty(req.user.org);
    const faculties = await listUserFaculties(rows[0]);
    res.json({ user: { ...publicUser(rows[0]), faculty, faculties } });
  }),
);
app.get(
  "/api/bootstrap",
  asyncRoute(async (req, res) => {
    const params = [req.user.org];
    const [students, courses, sessions, attendance, settings, faceImages, voiceSamples] =
      await Promise.all([
        pool.query(
          `SELECT id, student_number AS "studentNumber", full_name AS "fullName", major, term, phone, status FROM students WHERE organization_id=$1 ORDER BY full_name`,
          params,
        ),
        pool.query(
          `SELECT c.id, c.code, c.title, c.teacher_name AS "teacherName", c.room, c.weekday, to_char(c.start_time,'HH24:MI') AS "startTime", to_char(c.end_time,'HH24:MI') AS "endTime", COALESCE(array_agg(cs.student_id) FILTER (WHERE cs.student_id IS NOT NULL), '{}') AS "studentIds" FROM courses c LEFT JOIN course_students cs ON cs.course_id=c.id WHERE c.organization_id=$1 GROUP BY c.id ORDER BY c.title`,
          params,
        ),
        pool.query(
          `SELECT s.id, s.course_id AS "courseId", to_char(s.session_date,'YYYY-MM-DD') AS date, s.teacher_name AS "teacherName", to_char(s.start_time,'HH24:MI') AS "startTime", to_char(s.end_time,'HH24:MI') AS "endTime", s.grace_minutes AS "graceMinutes", s.open_before_minutes AS "openBeforeMinutes", s.close_after_minutes AS "closeAfterMinutes", s.status, s.live_status AS "liveStatus", s.started_at AS "startedAt", s.ended_at AS "endedAt", COALESCE(array_agg(ss.student_id) FILTER (WHERE ss.student_id IS NOT NULL), '{}') AS "studentIds" FROM class_sessions s LEFT JOIN session_students ss ON ss.session_id=s.id WHERE s.organization_id=$1 GROUP BY s.id ORDER BY s.session_date DESC, s.start_time DESC`,
          params,
        ),
        pool.query(
          `SELECT a.id, a.session_id AS "sessionId", a.student_id AS "studentId", a.status, a.method, a.checked_at AS "checkedAt", a.updated_at AS "updatedAt" FROM attendance_records a JOIN class_sessions s ON s.id=a.session_id WHERE s.organization_id=$1`,
          params,
        ),
        pool.query(
          `SELECT system_name AS "systemName", late_after_minutes AS "lateAfterMinutes", notifications_enabled AS "notificationsEnabled", face_recognition_enabled AS "faceRecognitionEnabled" FROM organization_settings WHERE organization_id=$1`,
          params,
        ),
        pool.query(
          `SELECT br.student_id AS "studentId", br.object_key AS "objectKey", br.created_at AS "createdAt"
             FROM biometric_references br
             JOIN students st ON st.id = br.student_id
            WHERE br.kind='face_image' AND st.organization_id=$1
            ORDER BY br.created_at`,
          params,
        ),
        pool.query(
          `SELECT br.student_id AS "studentId", br.features, br.feature_version AS "featureVersion", br.created_at AS "createdAt"
             FROM biometric_references br
             JOIN students st ON st.id = br.student_id
            WHERE br.kind='voice_sample' AND st.organization_id=$1 AND br.features IS NOT NULL
            ORDER BY br.created_at`,
          params,
        ),
      ]);
    res.json({
      students: students.rows,
      courses: courses.rows,
      sessions: sessions.rows,
      attendance: attendance.rows,
      settings: settings.rows[0] || null,
      faceImages: faceImages.rows,
      voiceSamples: voiceSamples.rows,
    });
  }),
);

app.get(
  "/api/students",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, student_number AS "studentNumber", full_name AS "fullName", major, term, phone, status FROM students WHERE organization_id=$1 ORDER BY full_name`,
      [req.user.org],
    );
    res.json(rows);
  }),
);
app.post(
  "/api/students",
  authorize("admin"),
  validate(studentSchema),
  asyncRoute(async (req, res) => {
    const s = req.body;
    const { rows } = await pool.query(
      `INSERT INTO students (organization_id,student_number,full_name,major,term,phone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, student_number AS "studentNumber", full_name AS "fullName", major,term,phone,status`,
      [
        req.user.org,
        s.studentNumber,
        s.fullName,
        s.major || null,
        s.term || null,
        s.phone || null,
        s.status,
      ],
    );
    res.status(201).json(rows[0]);
  }),
);
app.patch(
  "/api/students/:studentId",
  authorize("admin"),
  validate(studentSchema.partial()),
  asyncRoute(async (req, res) => {
    const fields = {
      studentNumber: "student_number",
      fullName: "full_name",
      major: "major",
      term: "term",
      phone: "phone",
      status: "status",
    };
    const changes = Object.entries(req.body);
    if (!changes.length)
      return res.status(422).json({ message: "تغییری ارسال نشده است." });
    const values = [req.user.org, req.params.studentId];
    const assignments = changes.map(([key, value], index) => {
      values.push(value || null);
      return `${fields[key]}=$${index + 3}`;
    });
    const { rows } = await pool.query(
      `UPDATE students SET ${assignments.join(", ")}, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING id, student_number AS "studentNumber", full_name AS "fullName", major,term,phone,status`,
      values,
    );
    if (!rows[0]) return res.sendStatus(404);
    res.json(rows[0]);
  }),
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function replaceStudentFacePhoto(studentId, organizationId, file) {
  if (!studentId || !UUID_RE.test(String(studentId))) {
    await fs.promises.unlink(file.path).catch(() => {});
    return null;
  }

  const { rows } = await pool.query(
    `SELECT id FROM students WHERE id = $1 AND organization_id = $2`,
    [studentId, organizationId],
  );
  if (!rows[0]) {
    await fs.promises.unlink(file.path).catch(() => {});
    return null;
  }

  const checksum = crypto
    .createHash("sha256")
    .update(await fs.promises.readFile(file.path))
    .digest("hex");

  const oldRefs = await pool.query(
    `SELECT object_key FROM biometric_references
      WHERE student_id = $1 AND kind = 'face_image'`,
    [studentId],
  );

  try {
    const result = await withTransaction(async (client) => {
      // Single reference photo per student: remove the previous one atomically.
      await client.query(
        `DELETE FROM biometric_references
          WHERE student_id = $1 AND kind = 'face_image'`,
        [studentId],
      );
      return client.query(
        `INSERT INTO biometric_references
         (student_id, kind, object_key, mime_type, checksum)
         VALUES ($1, 'face_image', $2, $3, $4)
         RETURNING id, student_id AS "studentId",
                   object_key AS "objectKey",
                   mime_type AS "mimeType",
                   created_at AS "createdAt"`,
        [studentId, file.filename, file.mimetype, checksum],
      );
    });

    for (const ref of oldRefs.rows) {
      await fs.promises
        .unlink(path.join(uploadsRoot, "students", ref.object_key))
        .catch(() => {});
    }

    return result.rows[0];
  } catch (error) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw error;
  }
}

app.post(
  "/api/students/:studentId/photos",
  authorize("admin", "teacher"),
  uploadStudentPhoto.single("photo"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "لطفاً یک تصویر انتخاب کنید.",
      });
    }

    const record = await replaceStudentFacePhoto(
      req.params.studentId,
      req.user.org,
      req.file,
    );

    if (!record) {
      return res.status(404).json({
        message: "دانشجو پیدا نشد.",
      });
    }

    return res.status(201).json(record);
  }),
);

// دانشجو (یا هر کاربر متصل به یک دانشجو) می‌تواند عکس پروفایل خودش را
// بارگذاری کند. همین عکس، هم آواتار و هم مرجع تشخیص چهره است.
app.post(
  "/api/me/photo",
  uploadStudentPhoto.single("photo"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "لطفاً یک تصویر انتخاب کنید." });
    }

    const { rows } = await pool.query(
      `SELECT student_id AS "studentId" FROM users
        WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [req.user.sub, req.user.org],
    );
    const studentId = rows[0]?.studentId;

    if (!studentId || !UUID_RE.test(String(studentId))) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({
        message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست؛ با مدیر سامانه تماس بگیرید.",
      });
    }

    const record = await replaceStudentFacePhoto(
      studentId,
      req.user.org,
      req.file,
    );

    if (!record) {
      return res.status(404).json({ message: "دانشجو پیدا نشد." });
    }

    const url = `/uploads/students/${record.objectKey}`;
    await pool.query(
      `UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2`,
      [url, req.user.sub],
    );

    return res.status(201).json({ ...record, url });
  }),
);
app.post(
  "/api/courses",
  authorize("admin", "teacher"),
  validate(courseSchema),
  asyncRoute(async (req, res) => {
    const c = req.body;
    const course = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO courses (organization_id,code,title,teacher_name,room,weekday,start_time,end_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, code, title`,
        [
          req.user.org,
          c.code,
          c.title,
          c.teacherName,
          c.room || null,
          c.weekday || null,
          c.startTime || null,
          c.endTime || null,
        ],
      );
      if (c.studentIds.length)
        await client.query(
          `INSERT INTO course_students (course_id,student_id) SELECT $1, unnest($2::uuid[]) WHERE EXISTS (SELECT 1 FROM students WHERE organization_id=$3 AND id=ANY($2::uuid[]))`,
          [rows[0].id, c.studentIds, req.user.org],
        );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "create",
        "course",
        rows[0].id,
      );
      return rows[0];
    });
    res.status(201).json(course);
  }),
);

app.patch(
  "/api/courses/:courseId",
  authorize("admin", "teacher"),
  validate(courseSchema.partial()),
  asyncRoute(async (req, res) => {
    const c = req.body;
    const fields = {
      code: "code",
      title: "title",
      teacherName: "teacher_name",
      room: "room",
      weekday: "weekday",
      startTime: "start_time",
      endTime: "end_time",
    };
    const changes = Object.entries(c).filter(([key]) => fields[key]);
    const course = await withTransaction(async (client) => {
      const values = [req.user.org, req.params.courseId];
      const assignments = changes.map(([key, value], index) => {
        values.push(value === "" ? null : value);
        return `${fields[key]}=$${index + 3}`;
      });
      if (!assignments.length)
        throw Object.assign(new Error("تغییری ارسال نشده است."), {
          status: 422,
        });
      const { rows } = await client.query(
        `UPDATE courses SET ${assignments.join(", ")}, updated_at=now()
          WHERE organization_id=$1 AND id=$2
          RETURNING id, code, title`,
        values,
      );
      if (!rows[0])
        throw Object.assign(new Error("درس پیدا نشد."), { status: 404 });
      if (Array.isArray(c.studentIds)) {
        await client.query("DELETE FROM course_students WHERE course_id=$1", [
          req.params.courseId,
        ]);
        if (c.studentIds.length)
          await client.query(
            `INSERT INTO course_students (course_id, student_id)
             SELECT $1, unnest($2::uuid[])`,
            [req.params.courseId, c.studentIds],
          );
      }
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "update",
        "course",
        req.params.courseId,
      );
      return rows[0];
    });
    res.json(course);
  }),
);

app.delete(
  "/api/courses/:courseId",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    // class_sessions.course_id is RESTRICT, so remove the course's sessions
    // (their roster and attendance rows cascade) before deleting the course.
    const deleted = await withTransaction(async (client) => {
      const found = await client.query(
        "SELECT id FROM courses WHERE organization_id=$1 AND id=$2",
        [req.user.org, req.params.courseId],
      );
      if (!found.rows[0]) return false;
      await client.query("DELETE FROM class_sessions WHERE course_id=$1", [
        req.params.courseId,
      ]);
      await client.query(
        "DELETE FROM courses WHERE organization_id=$1 AND id=$2",
        [req.user.org, req.params.courseId],
      );
      return true;
    });
    if (!deleted) return res.sendStatus(404);
    res.sendStatus(204);
  }),
);

app.post(
  "/api/students/:studentId/voice-samples",
  authorize("admin", "teacher"),
  validate(voiceSampleSchema),
  asyncRoute(async (req, res) => {
    const student = await pool.query(
      "SELECT id FROM students WHERE id=$1 AND organization_id=$2",
      [req.params.studentId, req.user.org],
    );
    if (!student.rows[0]) return res.sendStatus(404);
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO biometric_references
           (student_id, kind, object_key, mime_type, features, feature_version)
         VALUES ($1,'voice_sample','inline-features','application/json',$2,$3)
         RETURNING id, student_id AS "studentId", features, feature_version AS "featureVersion", created_at AS "createdAt"`,
        [req.params.studentId, JSON.stringify(req.body.features), req.body.featureVersion],
      );
      const stale = await client.query(
        `SELECT id FROM biometric_references
          WHERE student_id=$1 AND kind='voice_sample'
          ORDER BY created_at DESC OFFSET 3`,
        [req.params.studentId],
      );
      if (stale.rows.length)
        await client.query(
          "DELETE FROM biometric_references WHERE id = ANY($1::uuid[])",
          [stale.rows.map((row) => row.id)],
        );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "create",
        "voice_sample",
        rows[0].id,
      );
      return rows[0];
    });
    res.status(201).json(result);
  }),
);

app.put(
  "/api/settings",
  authorize("admin", "teacher"),
  validate(settingsSchema),
  asyncRoute(async (req, res) => {
    const s = req.body;
    const { rows } = await pool.query(
      `INSERT INTO organization_settings
         (organization_id, system_name, late_after_minutes, notifications_enabled, face_recognition_enabled)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id) DO UPDATE
       SET system_name=EXCLUDED.system_name,
           late_after_minutes=EXCLUDED.late_after_minutes,
           notifications_enabled=EXCLUDED.notifications_enabled,
           face_recognition_enabled=EXCLUDED.face_recognition_enabled,
           updated_at=now()
       RETURNING system_name AS "systemName", late_after_minutes AS "lateAfterMinutes",
                 notifications_enabled AS "notificationsEnabled",
                 face_recognition_enabled AS "faceRecognitionEnabled"`,
      [
        req.user.org,
        s.systemName,
        s.lateAfterMinutes,
        s.notificationsEnabled,
        s.faceRecognitionEnabled,
      ],
    );
    res.json(rows[0]);
  }),
);

app.post(
  "/api/sessions",
  authorize("admin", "teacher"),
  validate(sessionSchema),
  asyncRoute(async (req, res) => {
    const s = req.body;
    const session = await withTransaction(async (client) => {
      const ownership = await client.query(
        "SELECT id FROM courses WHERE id=$1 AND organization_id=$2",
        [s.courseId, req.user.org],
      );
      if (!ownership.rows[0])
        throw Object.assign(new Error("درس پیدا نشد."), { status: 404 });
      const { rows } = await client.query(
        `INSERT INTO class_sessions (organization_id,course_id,session_date,teacher_name,start_time,end_time,grace_minutes,open_before_minutes,close_after_minutes,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'started')
         ON CONFLICT (course_id, session_date) DO UPDATE
           SET teacher_name=EXCLUDED.teacher_name,
               start_time=EXCLUDED.start_time,
               end_time=EXCLUDED.end_time,
               grace_minutes=EXCLUDED.grace_minutes,
               open_before_minutes=EXCLUDED.open_before_minutes,
               close_after_minutes=EXCLUDED.close_after_minutes,
               status=CASE WHEN class_sessions.status='finalized' THEN class_sessions.status ELSE 'started' END,
               updated_at=now()
         RETURNING id, status`,
        [
          req.user.org,
          s.courseId,
          s.date,
          s.teacherName,
          s.startTime,
          s.endTime,
          s.graceMinutes,
          s.openBeforeMinutes,
          s.closeAfterMinutes,
        ],
      );
      await client.query(
        `INSERT INTO session_students (session_id,student_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [rows[0].id, s.studentIds],
      );
      await client.query(
        `INSERT INTO attendance_records (session_id,student_id,status,method)
         SELECT $1, unnest($2::uuid[]),'unmarked','system'
         ON CONFLICT (session_id, student_id) DO NOTHING`,
        [rows[0].id, s.studentIds],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "create",
        "session",
        rows[0].id,
      );
      return rows[0];
    });
    res.status(201).json(session);
  }),
);

app.patch(
  "/api/sessions/:sessionId",
  authorize("admin", "teacher"),
  validate(
    z.object({
      status: z.enum(["scheduled", "started", "finalized", "cancelled"]),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE class_sessions SET status=$1, updated_at=now()
        WHERE organization_id=$2 AND id=$3 RETURNING id, status`,
      [req.body.status, req.user.org, req.params.sessionId],
    );
    if (!rows[0]) return res.sendStatus(404);
    res.json(rows[0]);
  }),
);

app.post(
  "/api/sessions/:sessionId/finalize",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const session = await client.query(
        "SELECT id, status FROM class_sessions WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [req.params.sessionId, req.user.org],
      );
      if (!session.rows[0])
        throw Object.assign(new Error("جلسه پیدا نشد."), { status: 404 });

      const unmarked = await client.query(
        `SELECT id, status FROM attendance_records
          WHERE session_id=$1 AND status='unmarked'`,
        [req.params.sessionId],
      );
      for (const record of unmarked.rows) {
        await client.query(
          `UPDATE attendance_records
              SET status='absent', method='system', updated_at=now()
            WHERE id=$1`,
          [record.id],
        );
        await client.query(
          `INSERT INTO attendance_history
             (attendance_id, from_status, to_status, reason, method, changed_by)
           VALUES ($1,'unmarked','absent','پایان جلسه','system',$2)`,
          [record.id, req.user.sub],
        );
      }
      await client.query(
        "UPDATE class_sessions SET status='finalized', updated_at=now() WHERE id=$1",
        [req.params.sessionId],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "finalize",
        "session",
        req.params.sessionId,
        { absent: unmarked.rowCount },
      );
      return { id: req.params.sessionId, status: "finalized", absent: unmarked.rowCount };
    });
    res.json(result);
  }),
);

app.put(
  "/api/attendance",
  authorize("admin", "teacher"),
  validate(attendanceUpsertSchema),
  asyncRoute(async (req, res) => {
    const { sessionId, studentId, status, method, reason } = req.body;
    const record = await withTransaction(async (client) => {
      const session = await client.query(
        "SELECT id FROM class_sessions WHERE id=$1 AND organization_id=$2",
        [sessionId, req.user.org],
      );
      if (!session.rows[0])
        throw Object.assign(new Error("جلسه پیدا نشد."), { status: 404 });
      const student = await client.query(
        "SELECT id FROM students WHERE id=$1 AND organization_id=$2",
        [studentId, req.user.org],
      );
      if (!student.rows[0])
        throw Object.assign(new Error("دانشجو پیدا نشد."), { status: 404 });

      const existing = await client.query(
        "SELECT id, status FROM attendance_records WHERE session_id=$1 AND student_id=$2 FOR UPDATE",
        [sessionId, studentId],
      );

      let attendanceId = existing.rows[0]?.id;
      let previousStatus = existing.rows[0]?.status || null;
      if (attendanceId) {
        const { rows } = await client.query(
          `UPDATE attendance_records
              SET status=$1, method=$2, checked_at=CASE WHEN $1='unmarked' THEN NULL ELSE now() END,
                  created_by=$3, updated_at=now()
            WHERE id=$4
            RETURNING id, session_id AS "sessionId", student_id AS "studentId",
                      status, method, checked_at AS "checkedAt", updated_at AS "updatedAt"`,
          [status, method, req.user.sub, attendanceId],
        );
        if (rows[0]) attendanceId = rows[0].id;
      } else {
        const { rows } = await client.query(
          `INSERT INTO attendance_records (session_id, student_id, status, method, created_by)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, session_id AS "sessionId", student_id AS "studentId",
                     status, method, checked_at AS "checkedAt", updated_at AS "updatedAt"`,
          [sessionId, studentId, status, method, req.user.sub],
        );
        attendanceId = rows[0].id;
      }

      await client.query(
        `INSERT INTO session_students (session_id, student_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [sessionId, studentId],
      );
      await client.query(
        `INSERT INTO attendance_history
           (attendance_id, from_status, to_status, reason, method, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [attendanceId, previousStatus, status, reason || null, method, req.user.sub],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "update",
        "attendance",
        attendanceId,
        { status, method, sessionId, studentId },
      );
      const { rows } = await client.query(
        `SELECT id, session_id AS "sessionId", student_id AS "studentId",
                status, method, checked_at AS "checkedAt", updated_at AS "updatedAt"
           FROM attendance_records WHERE id=$1`,
        [attendanceId],
      );
      return rows[0];
    });
    res.json(record);
  }),
);

/* ------------------------- اثر انگشت (WebAuthn platform) ------------------------- */

app.post(
  "/api/fingerprint/credentials",
  authorize("admin", "teacher"),
  validate(z.object({ studentId: id.optional() })),
  asyncRoute(async (req, res) => {
    const organizationId = req.user.org;
    let studentId = req.body?.studentId;
    if (!studentId) {
      const { rows } = await pool.query(
        `SELECT student_id AS "studentId" FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true`,
        [req.user.sub, organizationId],
      );
      studentId = rows[0]?.studentId;
    }
    const resolvedStudentId = String(studentId || "");
    const studentCheck = await pool.query(
      `SELECT id, student_number AS "studentNumber", full_name AS "fullName"
         FROM students WHERE id = $1 AND organization_id = $2`,
      [resolvedStudentId, organizationId],
    );
    if (!studentCheck.rows[0]) {
      return res.status(404).json({ message: "دانشجویی برای ثبت اثر انگشت یافت نشد." });
    }
    const resolvedStudent = studentCheck.rows[0];
    const { rows: existing } = await pool.query(
      `SELECT credential_id AS "credentialId", transports FROM fingerprint_credentials
        WHERE student_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
      [resolvedStudentId, organizationId],
    );
    const options = await generateRegistrationOptions({
      rpID: webauthnRelyingParty.id,
      rpName: webauthnRelyingParty.name,
      userID: Buffer.from(resolvedStudentId, "utf8"),
      userName: resolvedStudent.studentNumber || resolvedStudentId,
      userDisplayName: resolvedStudent.fullName || resolvedStudentId,
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      excludeCredentials: existing.map((row) => ({
        id: row.credentialId,
        transports: row.transports || [],
      })),
    });
    await createWebAuthnChallenge({
      organizationId,
      userId: req.user.sub,
      studentId: resolvedStudentId,
      kind: "registration",
      sessionId: null,
    });
    res.json({ options, studentId: resolvedStudentId });
  }),
);

app.post(
  "/api/fingerprint/credentials/verify",
  authorize("admin", "teacher"),
  validate(fingerprintResponseSchemas.registration),
  asyncRoute(async (req, res) => {
    const organizationId = req.user.org;
    const challenge = await takeWebAuthnChallenge({
      organizationId,
      userId: req.user.sub,
      kind: "registration",
      sessionId: null,
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "درخواست ثبت اثر انگشت منقضی یا نامعتبر شد." });
    }
    const verification = await safeVerifyRegistration({
      response: req.body.response,
      expectedChallenge: challenge,
      expectedOrigin: webauthnOrigins,
      expectedRPID: webauthnRelyingParty.id,
      requireUserVerification: true,
    });
    if (!verification.verified) {
      return res.status(400).json({ message: "اثر انگشت با امنیت تأیید نشد." });
    }
    const credential = verification.registrationInfo?.credential;
    if (!credential) {
      return res.status(400).json({ message: "دادهٔ احراز اثر انگشت کامل نبود." });
    }
    const credentialId = String(credential.id || "");
    const publicKey = Buffer.isBuffer(credential.publicKey)
      ? credential.publicKey
      : Buffer.from(credential.publicKey || []);
    const requestedStudentId = String(req.body?.studentId || "");
    let ownerStudentId = requestedStudentId;
    if (!ownerStudentId) {
      const { rows: linked } = await pool.query(
        `SELECT student_id AS "studentId" FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true`,
        [req.user.sub, organizationId],
      );
      ownerStudentId = String(linked[0]?.studentId || "");
    }
    const ownerCheck = await pool.query(
      `SELECT id FROM students WHERE organization_id = $1 AND id = $2`,
      [organizationId, ownerStudentId],
    );
    const studentRef = ownerCheck.rows[0]?.id;
    await pool.query(
      `INSERT INTO fingerprint_credentials
         (organization_id, student_id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (organization_id, student_id, credential_id) DO NOTHING`,
      [
        organizationId,
        studentRef,
        req.user.sub,
        credentialId,
        publicKey,
        Number(credential.counter || 0),
        credential.transports || [],
        verification.registrationInfo?.credentialDeviceType || null,
        Boolean(verification.registrationInfo?.credentialBackedUp || false),
        verification.registrationInfo?.aaguid || null,
      ],
    );
    return res.json({ verified: true, credentialId, studentId: studentRef || null });
  }),
);

app.get(
  "/api/fingerprint/credentials",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const credentials = await listFingerprintCredentials(req.user.org, req.query.studentId);
    res.json({ credentials });
  }),
);

app.post(
  "/api/fingerprint/self/options",
  asyncRoute(async (req, res) => {
    const organizationId = req.user.org;
    const { rows } = await pool.query(
      `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS "fullName"
         FROM users u
         JOIN students st ON st.id = u.student_id::uuid
        WHERE u.id = $1 AND u.organization_id = $2 AND u.is_active = true`,
      [req.user.sub, organizationId],
    );
    const student = rows[0];
    if (!student) {
      return res.status(404).json({ message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست." });
    }
    const { rows: existing } = await pool.query(
      `SELECT credential_id AS "credentialId", transports FROM fingerprint_credentials
        WHERE student_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
      [student.id, organizationId],
    );
    const options = await generateRegistrationOptions({
      rpID: webauthnRelyingParty.id,
      rpName: webauthnRelyingParty.name,
      userID: Buffer.from(String(student.id), "utf8"),
      userName: student.studentNumber || String(student.id),
      userDisplayName: student.fullName || String(student.id),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      excludeCredentials: existing.map((row) => ({
        id: row.credentialId,
        transports: row.transports || [],
      })),
    });
    await createWebAuthnChallenge({
      organizationId,
      userId: req.user.sub,
      studentId: String(student.id),
      kind: "registration",
      sessionId: null,
    });
    res.json({ options, studentId: String(student.id) });
  }),
);

app.post(
  "/api/fingerprint/self/verify",
  asyncRoute(async (req, res) => {
    const organizationId = req.user.org;
    const challenge = await takeWebAuthnChallenge({
      organizationId,
      userId: req.user.sub,
      kind: "registration",
      sessionId: null,
    });
    if (!challenge) {
      return res.status(404).json({ message: "درخواست ثبت اثر انگشت منقضی یا نامعتبر شد." });
    }
    const verification = await safeVerifyRegistration({
      response: req.body?.response,
      expectedChallenge: challenge,
      expectedOrigin: webauthnOrigins,
      expectedRPID: webauthnRelyingParty.id,
      requireUserVerification: true,
    });
    if (!verification.verified) {
      return res.status(400).json({ message: "اثر انگشت با امنیت تأیید نشد." });
    }
    const credential = verification.registrationInfo?.credential;
    if (!credential) {
      return res.status(400).json({ message: "دادهٔ احراز اثر انگشت کامل نبود." });
    }
    const { rows: linked } = await pool.query(
      `SELECT student_id AS "studentId" FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [req.user.sub, organizationId],
    );
    const ownerStudentId = String(linked[0]?.studentId || "");
    const ownerCheck = await pool.query(
      `SELECT id FROM students WHERE organization_id = $1 AND id = $2`,
      [organizationId, ownerStudentId],
    );
    const studentRef = ownerCheck.rows[0]?.id;
    if (!studentRef) {
      return res.status(404).json({ message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست." });
    }
    const credentialId = String(credential.id || "");
    const publicKey = Buffer.isBuffer(credential.publicKey)
      ? credential.publicKey
      : Buffer.from(credential.publicKey || "");
    await pool.query(
      `INSERT INTO fingerprint_credentials
         (organization_id, student_id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (organization_id, student_id, credential_id) DO NOTHING`,
      [
        organizationId,
        studentRef,
        req.user.sub,
        credentialId,
        publicKey,
        Number(credential.counter || 0),
        credential.transports || [],
        verification.registrationInfo?.credentialDeviceType || null,
        Boolean(verification.registrationInfo?.credentialBackedUp || false),
        verification.registrationInfo?.aaguid || null,
      ],
    );
    return res.json({ verified: true, credentialId, studentId: studentRef || null });
  }),
);

app.get(
  "/api/fingerprint/self",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT fc.id, fc.student_id AS "studentId", fc.user_id AS "userId",
              fc.credential_id AS "credentialId", fc.counter, fc.transports,
              fc.device_label AS "deviceLabel", fc.created_at AS "createdAt", fc.last_used_at AS "lastUsedAt",
              fc.revoked_at AS "revokedAt"
         FROM fingerprint_credentials fc
        WHERE fc.organization_id = $2 AND fc.revoked_at IS NULL
          AND (
            fc.user_id = $1
            OR fc.student_id = (
              SELECT u.student_id::uuid FROM users u
               WHERE u.id = $1 AND u.organization_id = $2
            )
          )
        ORDER BY fc.created_at`,
      [req.user.sub, req.user.org],
    );
    const studentIds = [...new Set(rows.map((row) => String(row.studentId)).filter(Boolean))];
    let students = [];
    if (studentIds.length) {
      const { rows: found } = await pool.query(
        `SELECT id, student_number AS "studentNumber", full_name AS "fullName" FROM students WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [req.user.org, studentIds],
      );
      const byId = new Map(found.map((row) => [String(row.id), row]));
      students = studentIds.map((id) => byId.get(id)).filter(Boolean);
    }
    res.json({
      credentials: rows.map((row) => ({
        ...row,
        student: students.find((item) => String(item.id) === String(row.studentId)) || null,
      })),
    });
  }),
);

app.post(
  "/api/fingerprint/authenticate/options",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const organizationId = req.user.org;
    const { rows } = await pool.query(
      `SELECT fc.credential_id AS "credentialId", fc.student_id AS "studentId", fc.transports
         FROM fingerprint_credentials fc
        WHERE fc.organization_id = $1 AND fc.revoked_at IS NULL
        ORDER BY fc.created_at`,
      [organizationId],
    );
    const options = await generateAuthenticationOptions({
      rpID: webauthnRelyingParty.id,
      allowCredentials: rows.map((row) => ({
        id: row.credentialId,
        transports: row.transports || [],
      })),
      userVerification: "required",
      timeout: 60_000,
    });
    await createWebAuthnChallenge({
      organizationId,
      userId: req.user.sub,
      studentId: null,
      kind: "authentication",
      sessionId: null,
    });
    res.json({ options, credentials: rows });
  }),
);

app.post(
  "/api/fingerprint/authenticate/verify",
  authorize("admin", "teacher"),
  validate(fingerprintResponseSchemas.authentication),
  asyncRoute(async (req, res) => {
    const organizationId = req.user.org;
    const { response } = req.body || {};
    const challenge = await takeWebAuthnChallenge({
      organizationId,
      userId: req.user.sub,
      kind: "authentication",
      sessionId: null,
    });
    if (!challenge) {
      return res
        .status(404)
        .json({ message: "درخواست تأیید اثر انگشت منقضی یا نامعتبر شد." });
    }
    const credentialId = String(response?.id || response?.rawId || "");
    const { rows } = await pool.query(
      `SELECT id, student_id AS "studentId", credential_id AS "credentialId",
              public_key AS "publicKey", counter, transports
         FROM fingerprint_credentials
        WHERE credential_id = $1 AND organization_id = $2 AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [credentialId, organizationId],
    );
    const credentialRow = rows[0];
    if (!credentialRow) {
      return res
        .status(401)
        .json({ message: "اثر انگشت ثبت‌شدهٔ این سامانه برای تأیید حضور یافت نشد." });
    }
    const verification = await safeVerifyAuthentication({
      response,
      expectedChallenge: challenge,
      expectedOrigin: webauthnOrigins,
      expectedRPID: webauthnRelyingParty.id,
      credential: {
        id: credentialRow.credentialId,
        publicKey: credentialRow.publicKey,
        counter: credentialRow.counter,
        transports: credentialRow.transports || [],
      },
      requireUserVerification: true,
    });
    if (!verification.verified) {
      return res.status(401).json({ message: "اثر انگشت با امنیت تأیید نشد." });
    }
    await pool.query(
      `UPDATE fingerprint_credentials SET counter = $1, last_used_at = now() WHERE id = $2`,
      [Number(verification.authenticationInfo?.newCounter || 0), credentialRow.id],
    );
    const { rows: studentRows } = await pool.query(
      `SELECT id, student_number AS "studentNumber", full_name AS "fullName"
         FROM students WHERE organization_id = $1 AND id = $2`,
      [organizationId, credentialRow.studentId],
    );
    return res.json({ verified: true, credentialId, student: studentRows[0] || null });
  }),
);

app.delete(
  "/api/fingerprint/credentials/:credentialId",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE fingerprint_credentials SET revoked_at = now() WHERE credential_id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.credentialId, req.user.org],
    );
    if (!rows[0]) return res.sendStatus(404);
    return res.json({ revoked: true });
  }),
);

app.patch(
  "/api/attendance/:attendanceId",
  authorize("admin", "teacher"),
  validate(
    z.object({
      status: z.enum([
        "unmarked",
        "present",
        "late",
        "absent",
        "excused",
        "left_early",
      ]),
      method: z
        .enum([
          "manual",
          "face",
          "voice",
          "class_camera",
          "system",
          "fingerprint",
        ])
        .default("manual"),
      reason: z.string().trim().max(500).optional().default(""),
    }),
  ),
  asyncRoute(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT a.status FROM attendance_records a JOIN class_sessions s ON s.id=a.session_id WHERE a.id=$1 AND s.organization_id=$2 FOR UPDATE`,
        [req.params.attendanceId, req.user.org],
      );
      if (!existing.rows[0])
        throw Object.assign(new Error("رکورد حضور پیدا نشد."), { status: 404 });
      const { status, method, reason } = req.body;
      const { rows } = await client.query(
        `UPDATE attendance_records SET status=$1, method=$2, checked_at=CASE WHEN $1='unmarked' THEN NULL ELSE now() END, created_by=$3, updated_at=now() WHERE id=$4 RETURNING *`,
        [status, method, req.user.sub, req.params.attendanceId],
      );
      await client.query(
        `INSERT INTO attendance_history (attendance_id,from_status,to_status,reason,method,changed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          req.params.attendanceId,
          existing.rows[0].status,
          status,
          reason || null,
          method,
          req.user.sub,
        ],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "update",
        "attendance",
        req.params.attendanceId,
        { status, method },
      );
      return rows[0];
    });
    res.json(result);
  }),
);

app.post(
  "/api/migrations/browser-snapshot",
  authorize("admin"),
  validate(
    z.object({
      students: z
        .array(
          z.object({
            id: z.string().trim().min(1),
            name: z.string().trim().min(1),
            major: z.string().optional(),
            term: z.string().optional(),
            phone: z.string().optional(),
            status: z.string().optional(),
          }),
        )
        .max(5000)
        .default([]),
      courses: z
        .array(
          z.object({
            id: z.string().trim().min(1),
            title: z.string().trim().min(1),
            teacher: z.string().optional(),
            room: z.string().optional(),
            time: z.string().optional(),
            studentIds: z.array(z.string()).optional(),
          }),
        )
        .max(1000)
        .default([]),
      attendance: z.array(z.record(z.unknown())).max(20000).default([]),
      sessionHistory: z.record(z.record(z.unknown())).default({}),
      settings: z.record(z.unknown()).default({}),
    }),
  ),
  asyncRoute(async (req, res) => {
    const normalizeDigits = (value) =>
      String(value ?? "").replace(/[۰-۹٠-٩]/g, (digit) => {
        const persian = "۰۱۲۳۴۵۶۷۸۹";
        const arabic = "٠١٢٣٤٥٦٧٨٩";
        const index = persian.indexOf(digit);
        return String(index >= 0 ? index : arabic.indexOf(digit));
      });

    const parseCourseTime = (value) => {
      const normalized = normalizeDigits(value);
      const match = normalized.match(
        /(شنبه|یکشنبه|دوشنبه|سه.?شنبه|چهارشنبه|پنجشنبه|جمعه)[،,\s]+(\d{1,2}:\d{2})\s*(?:تا|-)\s*(\d{1,2}:\d{2})/,
      );
      if (!match) return {};
      const validTime = (time) => {
        const [hour, minute] = time.split(":").map(Number);
        return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
      };
      if (!validTime(match[2]) || !validTime(match[3])) return {};
      return {
        weekday: match[1],
        startTime: match[2].padStart(5, "0"),
        endTime: match[3].padStart(5, "0"),
      };
    };

    const validTimestamp = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    const validMethod = (value) =>
      ["face", "voice", "class_camera", "manual", "system", "fingerprint"].includes(value)
        ? value
        : "manual";

    const migrated = await withTransaction(async (client) => {
      const studentMap = new Map();
      const courseMap = new Map();
      const sessionMap = new Map();

      let attendanceCount = 0;
      let historyCount = 0;
      let skippedHistoryCount = 0;
      let unresolvedCount = 0;
      const unresolvedRecords = [];

      // 1. انتقال دانشجویان
      for (const student of req.body.students) {
        const { rows } = await client.query(
          `
        INSERT INTO students
          (organization_id, student_number, full_name, major, term, phone, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (organization_id, student_number)
        DO UPDATE SET
          full_name=EXCLUDED.full_name,
          major=EXCLUDED.major,
          term=EXCLUDED.term,
          phone=EXCLUDED.phone,
          status=EXCLUDED.status,
          updated_at=now()
        RETURNING id
      `,
          [
            req.user.org,
            String(student.id),
            student.name,
            student.major || null,
            student.term || null,
            student.phone || null,
            student.status === "غیرفعال" ? "inactive" : "active",
          ],
        );

        studentMap.set(String(student.id), rows[0].id);
      }

      // 2. انتقال درس‌ها و استخراج روز و ساعت
      for (const course of req.body.courses) {
        const schedule = parseCourseTime(course.time);

        const { rows } = await client.query(
          `
        INSERT INTO courses
          (organization_id, code, title, teacher_name, room, weekday, start_time, end_time)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (organization_id, code)
        DO UPDATE SET
          title=EXCLUDED.title,
          teacher_name=EXCLUDED.teacher_name,
          room=EXCLUDED.room,
          weekday=EXCLUDED.weekday,
          start_time=EXCLUDED.start_time,
          end_time=EXCLUDED.end_time,
          updated_at=now()
        RETURNING id
      `,
          [
            req.user.org,
            String(course.id),
            course.title,
            course.teacher || "استاد تعیین‌نشده",
            course.room || null,
            schedule.weekday || null,
            schedule.startTime || null,
            schedule.endTime || null,
          ],
        );

        const courseId = rows[0].id;
        courseMap.set(String(course.title), courseId);
        courseMap.set(String(course.id), courseId);

        const memberIds = (course.studentIds || [])
          .map((item) => studentMap.get(String(item)))
          .filter(Boolean);

        if (memberIds.length) {
          await client.query(
            `
          INSERT INTO course_students (course_id, student_id)
          SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
        `,
            [courseId, memberIds],
          );
        }
      }

      // 3. انتقال جلسات
      const sourceSessions = Object.values(req.body.sessionHistory).filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      );

      for (const source of sourceSessions) {
        const courseId = courseMap.get(String(source.course || ""));
        const date = String(source.date || "");

        if (!courseId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const course = req.body.courses.find(
          (item) => String(item.title) === String(source.course),
        );
        const schedule = parseCourseTime(course?.time);

        const startTime = normalizeDigits(
          source.startTime || schedule.startTime || "00:00",
        );
        const endTime = normalizeDigits(
          source.endTime || schedule.endTime || "23:59",
        );

        const { rows } = await client.query(
          `
        INSERT INTO class_sessions
          (organization_id, course_id, session_date, teacher_name,
           start_time, end_time, grace_minutes, open_before_minutes,
           close_after_minutes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (course_id, session_date)
        DO UPDATE SET
          teacher_name=EXCLUDED.teacher_name,
          start_time=EXCLUDED.start_time,
          end_time=EXCLUDED.end_time,
          grace_minutes=EXCLUDED.grace_minutes,
          open_before_minutes=EXCLUDED.open_before_minutes,
          close_after_minutes=EXCLUDED.close_after_minutes,
          status=EXCLUDED.status,
          updated_at=now()
        RETURNING id
      `,
          [
            req.user.org,
            courseId,
            date,
            source.teacher || course?.teacher || "استاد تعیین‌نشده",
            startTime,
            endTime,
            Number(source.graceMinutes ?? 10),
            Number(source.openBeforeMinutes ?? 15),
            Number(source.closeAfterMinutes ?? 30),
            source.finalized
              ? "finalized"
              : source.started
                ? "started"
                : "scheduled",
          ],
        );

        const sessionId = rows[0].id;
        const sessionKey = String(source.id || `${source.course}::${date}`);
        sessionMap.set(sessionKey, sessionId);
        sessionMap.set(`${source.course}::${date}`, sessionId);

        const memberIds = (source.studentIds || [])
          .map((item) => studentMap.get(String(item)))
          .filter(Boolean);

        if (memberIds.length) {
          await client.query(
            `
          INSERT INTO session_students (session_id, student_id)
          SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
        `,
            [sessionId, memberIds],
          );
        }
      }

      // 4. انتقال حضور و تاریخچه تغییر وضعیت
      for (const record of req.body.attendance) {
        const sourceStudentNumber = String(record.id || record.studentId || "");
        const studentId = studentMap.get(sourceStudentNumber);

        const sourceSessionKey = String(
          record.sessionId ||
            `${record.course || ""}::${record.sessionDate || ""}`,
        );
        const sessionId = sessionMap.get(sourceSessionKey);

        if (!studentId || !sessionId) {
          unresolvedCount += 1;
          unresolvedRecords.push({
            studentId: sourceStudentNumber || null,
            course: record.course || null,
            sessionDate: record.sessionDate || null,
            reason: !studentId
              ? "دانشجو پیدا نشد"
              : "جلسه یا تاریخ جلسه مشخص نیست",
          });
          continue;
        }

        const status = statusMap[record.status] || "unmarked";
        const method = validMethod(record.method);
        const historyItems = Array.isArray(record.history)
          ? record.history
          : [];

        const lastHistoryTime = historyItems.length
          ? validTimestamp(historyItems[historyItems.length - 1]?.changedAt)
          : null;

        const checkedAt =
          status === "unmarked"
            ? null
            : validTimestamp(record.checkedAt) ||
              validTimestamp(record.updatedAt) ||
              lastHistoryTime;

        const { rows: attendanceRows } = await client.query(
          `
        INSERT INTO attendance_records
          (session_id, student_id, status, method, checked_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,now())
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET
          status=EXCLUDED.status,
          method=EXCLUDED.method,
          checked_at=EXCLUDED.checked_at,
          updated_at=now()
        RETURNING id
      `,
          [sessionId, studentId, status, method, checkedAt],
        );

        const attendanceId = attendanceRows[0].id;
        attendanceCount += 1;

        // اگر رکورد حضور در فهرست دانشجویان جلسه نبود، ارتباط آن را نیز ثبت کن.
        await client.query(
          `
        INSERT INTO session_students (session_id, student_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
      `,
          [sessionId, studentId],
        );

        for (const item of historyItems) {
          const changedAt = validTimestamp(item.changedAt);
          const toStatus = statusMap[item.to] || item.to;
          const fromStatus = item.from
            ? statusMap[item.from] || item.from
            : null;

          if (!changedAt || !toStatus) {
            skippedHistoryCount += 1;
            continue;
          }

          const historyMethod = validMethod(item.method || record.method);

          const result = await client.query(
            `
          INSERT INTO attendance_history
            (attendance_id, from_status, to_status, reason, method, changed_by, changed_at)
          SELECT $1,$2,$3,$4,$5,NULL,$6
          WHERE NOT EXISTS (
            SELECT 1
            FROM attendance_history
            WHERE attendance_id=$1
              AND from_status IS NOT DISTINCT FROM $2
              AND to_status=$3
              AND reason IS NOT DISTINCT FROM $4
              AND method=$5
              AND changed_at=$6
          )
        `,
            [
              attendanceId,
              fromStatus,
              toStatus,
              item.reason || null,
              historyMethod,
              changedAt,
            ],
          );

          historyCount += result.rowCount;
        }
      }

      // 5. انتقال تنظیمات
      const settings = req.body.settings;

      if (Object.keys(settings).length) {
        const lateAfter = Number(settings.lateAfter ?? 10);
        const safeLateAfter = Number.isFinite(lateAfter)
          ? Math.max(0, Math.min(120, lateAfter))
          : 10;

        await client.query(
          `
        INSERT INTO organization_settings
          (organization_id, system_name, late_after_minutes,
           notifications_enabled, face_recognition_enabled)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (organization_id)
        DO UPDATE SET
          system_name=EXCLUDED.system_name,
          late_after_minutes=EXCLUDED.late_after_minutes,
          notifications_enabled=EXCLUDED.notifications_enabled,
          face_recognition_enabled=EXCLUDED.face_recognition_enabled,
          updated_at=now()
      `,
          [
            req.user.org,
            String(settings.name || "حضوربان").slice(0, 120),
            safeLateAfter,
            settings.notifications !== false,
            settings.faceRecognition !== false,
          ],
        );
      }

      await audit(
        client,
        req.user.org,
        req.user.sub,
        "import",
        "browser_snapshot",
        null,
        {
          students: studentMap.size,
          courses: req.body.courses.length,
          sessions: sessionMap.size,
          attendance: attendanceCount,
          history: historyCount,
          unresolved: unresolvedCount,
          skippedHistory: skippedHistoryCount,
        },
      );

      return {
        students: studentMap.size,
        courses: req.body.courses.length,
        sessions: sessionMap.size,
        attendance: attendanceCount,
        history: historyCount,
        unresolved: unresolvedCount,
        unresolvedRecords,
        skippedHistory: skippedHistoryCount,
      };
    });

    res.status(201).json(migrated);
  }),
);

/* ================= leave requests / objections / notifications / imports ================= */

const leaveProofsDir = path.join(uploadsRoot, "leave-proofs");
fs.mkdirSync(leaveProofsDir, { recursive: true });
const leaveProofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, leaveProofsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 10) || ".bin";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const uploadLeaveProof = multer({
  storage: leaveProofStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.mimetype))
      return cb(
        Object.assign(new Error("فقط تصویر یا فایل PDF مجاز است."), {
          status: 400,
        }),
      );
    cb(null, true);
  },
});

const leaveSchema = z.object({
  type: z.enum(["leave", "excuse"]),
  sessionId: z.string().uuid().optional().or(z.literal("")),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ شروع نامعتبر است."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ پایان نامعتبر است.")
    .optional()
    .or(z.literal("")),
  reason: z.string().trim().min(5).max(2000),
});
const reviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  adminNote: z.string().trim().max(2000).optional().default(""),
  applyToGroup: z.boolean().optional().default(false),
});
const groupLeaveSchema = z.object({
  studentIds: z.array(id).min(1).max(200),
  title: z.string().trim().max(160).optional().default(""),
  type: z.enum(["leave", "excuse"]),
  sessionId: z.string().uuid().optional().or(z.literal("")),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ شروع نامعتبر است."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ پایان نامعتبر است.")
    .optional()
    .or(z.literal("")),
  reason: z.string().trim().min(5).max(2000),
  approveNow: z.boolean().optional().default(true),
});
const objectionSchema = z.object({
  attendanceId: z.string().uuid(),
  reason: z.string().trim().min(5).max(2000),
});

async function notifyUsers(
  orgId,
  userIds,
  { type, title, message, link },
  client = pool,
) {
  if (!userIds.length) return;
  const params = [];
  const values = userIds.map((userId, index) => {
    const base = index * 6;
    params.push(orgId, userId, type, title, message, link || null);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
  });
  await client.query(
    `INSERT INTO notifications (organization_id, user_id, type, title, message, link) VALUES ${values.join(",")}`,
    params,
  );
}
async function adminUserIds(orgId) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE organization_id=$1 AND role='admin' AND is_active=true`,
    [orgId],
  );
  return rows.map((row) => row.id);
}
async function studentUserIds(orgId, studentId) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE organization_id=$1 AND student_id::text=$2 AND is_active=true`,
    [orgId, String(studentId)],
  );
  return rows.map((row) => row.id);
}

const leaveSelect = `SELECT lr.id, lr.student_id AS "studentId", lr.student_number AS "studentNumber",
  lr.student_name AS "studentName", lr.type, lr.session_id AS "sessionId",
  lr.start_date AS "startDate", lr.end_date AS "endDate", lr.reason,
  lr.proof_file AS "proofFile", lr.status, lr.admin_note AS "adminNote",
  lr.group_id AS "groupId", lr.group_title AS "groupTitle",
  lr.reviewed_at AS "reviewedAt", lr.created_at AS "createdAt",
  cs.session_date AS "sessionDate", c.title AS "courseTitle"
  FROM leave_requests lr
  LEFT JOIN class_sessions cs ON cs.id = lr.session_id
  LEFT JOIN courses c ON c.id = cs.course_id`;

async function applyExcusedForLeave(client, leave, orgId, reviewerId) {
  const params = [leave.studentId, orgId];
  let sql = `SELECT ar.id, ar.status FROM attendance_records ar
               JOIN class_sessions cs ON cs.id = ar.session_id
              WHERE ar.student_id=$1 AND cs.organization_id=$2 AND ar.status <> 'excused'`;
  if (leave.sessionId) {
    params.push(leave.sessionId);
    sql += ` AND ar.session_id=$3`;
  } else {
    params.push(leave.startDate, leave.endDate || leave.startDate);
    sql += ` AND cs.session_date BETWEEN $3 AND $4`;
  }
  const { rows: records } = await client.query(sql, params);
  for (const record of records) {
    await client.query(
      `UPDATE attendance_records SET status='excused', updated_at=now() WHERE id=$1`,
      [record.id],
    );
    await client.query(
      `INSERT INTO attendance_history (attendance_id, from_status, to_status, reason, method, changed_by)
       VALUES ($1,$2,'excused',$3,'system',$4)`,
      [
        record.id,
        record.status,
        `تایید درخواست ${leave.type === "leave" ? "مرخصی" : "توجیه"}`,
        reviewerId,
      ],
    );
  }
  return records.length;
}

app.post(
  "/api/leave-requests",
  uploadLeaveProof.single("proof"),
  validate(leaveSchema),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student)
      return res.status(404).json({ message: "حساب دانشجویی پیدا نشد." });
    const { type, sessionId, reason } = req.body;
    let startDate = req.body.startDate;
    let endDate = req.body.endDate || startDate;
    if (sessionId) {
      const { rows } = await pool.query(
        `SELECT session_date AS "date" FROM class_sessions WHERE id=$1 AND organization_id=$2`,
        [sessionId, req.user.org],
      );
      if (!rows[0])
        return res.status(404).json({ message: "جلسه یافت نشد." });
      const date = String(rows[0].date).slice(0, 10);
      startDate = date;
      endDate = date;
    }
    if (endDate < startDate)
      return res
        .status(400)
        .json({ message: "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد." });
    const proofFile = req.file
      ? `/uploads/leave-proofs/${req.file.filename}`
      : null;
    const { rows } = await pool.query(
      `INSERT INTO leave_requests
         (organization_id, student_id, student_number, student_name, type, session_id, start_date, end_date, reason, proof_file)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        req.user.org,
        student.id,
        student.studentNumber,
        student.fullName,
        type,
        sessionId || null,
        startDate,
        endDate,
        reason,
        proofFile,
      ],
    );
    await notifyUsers(req.user.org, await adminUserIds(req.user.org), {
      type: "leave",
      title: "درخواست جدید مرخصی/توجیه",
      message: `${student.fullName} یک درخواست ${
        type === "leave" ? "مرخصی" : "توجیه غیبت"
      } ثبت کرد.`,
      link: "leave-requests",
    });
    const { rows: created } = await pool.query(
      `${leaveSelect} WHERE lr.id=$1`,
      [rows[0].id],
    );
    res.status(201).json(created[0]);
  }),
);

app.post(
  "/api/leave-requests/bulk",
  authorize("admin"),
  validate(groupLeaveSchema),
  asyncRoute(async (req, res) => {
    const {
      studentIds,
      title,
      type,
      sessionId,
      reason,
      approveNow,
    } = req.body;
    let startDate = req.body.startDate;
    let endDate = req.body.endDate || startDate;
    let resolvedSessionId = sessionId || null;

    if (resolvedSessionId) {
      const { rows } = await pool.query(
        `SELECT to_char(session_date,'YYYY-MM-DD') AS date
           FROM class_sessions WHERE id=$1 AND organization_id=$2`,
        [resolvedSessionId, req.user.org],
      );
      if (!rows[0])
        return res.status(404).json({ message: "جلسه یافت نشد." });
      startDate = rows[0].date;
      endDate = rows[0].date;
    }
    if (endDate < startDate)
      return res
        .status(400)
        .json({ message: "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد." });

    const { rows: studentRows } = await pool.query(
      `SELECT id, student_number AS "studentNumber", full_name AS "fullName"
         FROM students
        WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND status='active'`,
      [req.user.org, studentIds],
    );
    if (!studentRows.length)
      return res
        .status(400)
        .json({ message: "هیچ دانشجوی فعالی برای این درخواست پیدا نشد." });

    const groupId = crypto.randomUUID();
    const groupTitle = title?.trim() || null;
    const result = await withTransaction(async (client) => {
      let affectedRecords = 0;
      for (const student of studentRows) {
        await client.query(
          `INSERT INTO leave_requests
             (organization_id, student_id, student_number, student_name, type, session_id,
              start_date, end_date, reason, status, group_id, group_title, reviewed_by, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            req.user.org,
            student.id,
            student.studentNumber,
            student.fullName,
            type,
            resolvedSessionId,
            startDate,
            endDate,
            reason,
            approveNow ? "approved" : "pending",
            groupId,
            groupTitle,
            approveNow ? req.user.sub : null,
            approveNow ? new Date() : null,
          ],
        );
        if (approveNow) {
          affectedRecords += await applyExcusedForLeave(
            client,
            {
              studentId: student.id,
              sessionId: resolvedSessionId,
              startDate,
              endDate,
              type,
            },
            req.user.org,
            req.user.sub,
          );
        }
        await notifyUsers(
          req.user.org,
          await studentUserIds(req.user.org, student.id),
          {
            type: "leave",
            title: approveNow
              ? "مرخصی گروهی برای شما ثبت شد"
              : "درخواست مرخصی گروهی ثبت شد",
            message: approveNow
              ? `مدیر سامانه برای شما ${
                  type === "leave" ? "مرخصی" : "توجیه غیبت"
                } ثبت کرد${groupTitle ? ` (${groupTitle})` : ""}.`
              : `درخواست ${
                  type === "leave" ? "مرخصی" : "توجیه غیبت"
                } گروهی برای شما ثبت شد و در انتظار بررسی است.`,
            link: "portal",
          },
          client,
        );
      }
      return { created: studentRows.length, affectedRecords };
    });

    const { rows: created } = await pool.query(
      `${leaveSelect} WHERE lr.group_id=$1 ORDER BY lr.created_at DESC`,
      [groupId],
    );
    res.status(201).json({
      groupId,
      created: result.created,
      affectedRecords: result.affectedRecords,
      requests: created,
    });
  }),
);

app.get(
  "/api/leave-requests",
  asyncRoute(async (req, res) => {
    const isAdmin = req.user.role === "admin";
    const params = [req.user.org];
    let sql = `${leaveSelect} WHERE lr.organization_id=$1`;
    if (!isAdmin) {
      const student = await findStudentByUserId(req.user.sub, req.user.org);
      if (!student) return res.json([]);
      params.push(student.id);
      sql += ` AND lr.student_id=$2`;
    }
    sql += ` ORDER BY lr.created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }),
);

app.post(
  "/api/leave-requests/:id/review",
  authorize("admin"),
  validate(reviewSchema),
  asyncRoute(async (req, res) => {
    const { status, adminNote, applyToGroup } = req.body;
    const { rows: targetRows } = await pool.query(
      `SELECT id, student_id AS "studentId", group_id AS "groupId",
              student_number AS "studentNumber", student_name AS "studentName",
              type, session_id AS "sessionId", start_date AS "startDate",
              end_date AS "endDate"
         FROM leave_requests
        WHERE id=$1 AND organization_id=$2 AND status='pending'`,
      [req.params.id, req.user.org],
    );
    const target = targetRows[0];
    if (!target)
      return res
        .status(404)
        .json({ message: "درخواست یافت نشد یا قبلاً بررسی شده است." });

    let pendingRows = [target];
    if (applyToGroup && target.groupId) {
      const { rows } = await pool.query(
        `SELECT id, student_id AS "studentId", group_id AS "groupId",
                student_number AS "studentNumber", student_name AS "studentName",
                type, session_id AS "sessionId", start_date AS "startDate",
                end_date AS "endDate"
           FROM leave_requests
          WHERE group_id=$1 AND organization_id=$2 AND status='pending'`,
        [target.groupId, req.user.org],
      );
      if (rows.length) pendingRows = rows;
    }

    let affectedTotal = 0;
    const reviewed = await withTransaction(async (client) => {
      const output = [];
      for (const leave of pendingRows) {
        const { rows } = await client.query(
          `UPDATE leave_requests
              SET status=$3, admin_note=$4, reviewed_by=$5, reviewed_at=now(), updated_at=now()
            WHERE id=$1 AND organization_id=$2 AND status='pending'
            RETURNING id, student_id AS "studentId", student_number AS "studentNumber",
                      student_name AS "studentName", type, session_id AS "sessionId",
                      start_date AS "startDate", end_date AS "endDate",
                      group_id AS "groupId", group_title AS "groupTitle"`,
          [leave.id, req.user.org, status, adminNote, req.user.sub],
        );
        if (!rows[0]) continue;
        if (status === "approved") {
          affectedTotal += await applyExcusedForLeave(
            client,
            rows[0],
            req.user.org,
            req.user.sub,
          );
        }
        output.push(rows[0]);
      }
      return output;
    });

    for (const leave of reviewed) {
      const affected =
        status === "approved" && reviewed.length === 1 ? affectedTotal : 0;
      await notifyUsers(
        req.user.org,
        await studentUserIds(req.user.org, leave.studentId),
        {
          type: "leave",
          title:
            status === "approved"
              ? "درخواست مرخصی تایید شد"
              : "درخواست مرخصی رد شد",
          message:
            status === "approved"
              ? `درخواست شما تایید شد${affected ? ` و ${affected} رکورد حضور به «موجه» تغییر کرد` : ""}.`
              : `درخواست شما رد شد${adminNote ? `: ${adminNote}` : "."}`,
          link: "portal",
        },
      );
    }

    const primary = reviewed[0] || target;
    res.json({
      ...primary,
      status,
      adminNote,
      affectedRecords: affectedTotal,
      reviewedCount: reviewed.length,
    });
  }),
);

const objectionSelect = `SELECT ao.id, ao.student_id AS "studentId", ao.attendance_id AS "attendanceId",
  ao.student_number AS "studentNumber", ao.student_name AS "studentName", ao.reason, ao.status,
  ao.admin_note AS "adminNote", ao.reviewed_at AS "reviewedAt", ao.created_at AS "createdAt",
  ar.status AS "recordStatus", ar.session_id AS "sessionId",
  cs.session_date AS "sessionDate", c.title AS "courseTitle"
  FROM attendance_objections ao
  JOIN attendance_records ar ON ar.id = ao.attendance_id
  JOIN class_sessions cs ON cs.id = ar.session_id
  LEFT JOIN courses c ON c.id = cs.course_id`;

app.post(
  "/api/attendance-objections",
  validate(objectionSchema),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student)
      return res.status(404).json({ message: "حساب دانشجویی پیدا نشد." });
    const { rows: recordRows } = await pool.query(
      `SELECT ar.id, ar.status FROM attendance_records ar
         JOIN class_sessions cs ON cs.id = ar.session_id
        WHERE ar.id=$1 AND ar.student_id=$2 AND cs.organization_id=$3`,
      [req.body.attendanceId, student.id, req.user.org],
    );
    if (!recordRows[0])
      return res.status(404).json({ message: "رکورد حضور یافت نشد." });
    if (recordRows[0].status === "present")
      return res
        .status(400)
        .json({ message: "وضعیت این رکورد در حال حاضر «حاضر» است." });
    const { rows: dupe } = await pool.query(
      `SELECT id FROM attendance_objections WHERE attendance_id=$1 AND status='pending'`,
      [req.body.attendanceId],
    );
    if (dupe[0])
      return res
        .status(409)
        .json({ message: "برای این رکورد اعتراض باز ثبت شده است." });
    const { rows } = await pool.query(
      `INSERT INTO attendance_objections
         (organization_id, student_id, attendance_id, student_number, student_name, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        req.user.org,
        student.id,
        req.body.attendanceId,
        student.studentNumber,
        student.fullName,
        req.body.reason,
      ],
    );
    await notifyUsers(req.user.org, await adminUserIds(req.user.org), {
      type: "objection",
      title: "اعتراض حضور جدید",
      message: `${student.fullName} به وضعیت حضور خود اعتراض کرد.`,
      link: "objections",
    });
    const { rows: created } = await pool.query(
      `${objectionSelect} WHERE ao.id=$1`,
      [rows[0].id],
    );
    res.status(201).json(created[0]);
  }),
);

app.get(
  "/api/attendance-objections",
  asyncRoute(async (req, res) => {
    const isAdmin = req.user.role === "admin";
    const params = [req.user.org];
    let sql = `${objectionSelect} WHERE ao.organization_id=$1`;
    if (!isAdmin) {
      const student = await findStudentByUserId(req.user.sub, req.user.org);
      if (!student) return res.json([]);
      params.push(student.id);
      sql += ` AND ao.student_id=$2`;
    }
    sql += ` ORDER BY ao.created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }),
);

app.post(
  "/api/attendance-objections/:id/review",
  authorize("admin"),
  validate(reviewSchema),
  asyncRoute(async (req, res) => {
    const { status, adminNote } = req.body;
    const { rows } = await pool.query(
      `UPDATE attendance_objections
          SET status=$3, admin_note=$4, reviewed_by=$5, reviewed_at=now(), updated_at=now()
        WHERE id=$1 AND organization_id=$2 AND status='pending'
        RETURNING id, student_id AS "studentId", attendance_id AS "attendanceId"`,
      [req.params.id, req.user.org, status, adminNote, req.user.sub],
    );
    const objection = rows[0];
    if (!objection)
      return res
        .status(404)
        .json({ message: "اعتراض یافت نشد یا قبلاً بررسی شده است." });

    if (status === "approved") {
      await withTransaction(async (client) => {
        const { rows: recordRows } = await client.query(
          `SELECT id, status FROM attendance_records WHERE id=$1`,
          [objection.attendanceId],
        );
        const record = recordRows[0];
        if (record && record.status !== "present") {
          await client.query(
            `UPDATE attendance_records SET status='present', updated_at=now() WHERE id=$1`,
            [record.id],
          );
          await client.query(
            `INSERT INTO attendance_history (attendance_id, from_status, to_status, reason, method, changed_by)
             VALUES ($1,$2,'present',$3,'system',$4)`,
            [
              record.id,
              record.status,
              "تایید اعتراض حضور توسط مدیر",
              req.user.sub,
            ],
          );
        }
      });
    }

    await notifyUsers(
      req.user.org,
      await studentUserIds(req.user.org, objection.studentId),
      {
        type: "objection",
        title:
          status === "approved"
            ? "اعتراض حضور تایید شد"
            : "اعتراض حضور رد شد",
        message:
          status === "approved"
            ? "وضعیت حضور شما اصلاح و به «حاضر» تغییر کرد."
            : `اعتراض شما رد شد${adminNote ? `: ${adminNote}` : "."}`,
        link: "portal",
      },
    );
    res.json({ ...objection, status, adminNote });
  }),
);

app.get(
  "/api/notifications",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, type, title, message, link, is_read AS "isRead", created_at AS "createdAt"
         FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40`,
      [req.user.sub],
    );
    res.json(rows);
  }),
);
app.get(
  "/api/notifications/unread-count",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=false`,
      [req.user.sub],
    );
    res.json({ count: rows[0]?.count || 0 });
  }),
);
app.post(
  "/api/notifications/:id/read",
  asyncRoute(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.sub],
    );
    res.json({ ok: true });
  }),
);
app.post(
  "/api/notifications/read-all",
  asyncRoute(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false`,
      [req.user.sub],
    );
    res.json({ ok: true });
  }),
);

app.post(
  "/api/import/students",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length)
      return res.status(400).json({ message: "فایل هیچ سطری ندارد." });
    if (rows.length > 2000)
      return res
        .status(400)
        .json({ message: "حداکثر ۲۰۰۰ سطر در هر ایمپورت مجاز است." });
    const result = { created: 0, errors: [] };
    await withTransaction(async (client) => {
      for (const [index, row] of rows.entries()) {
        const parsed = studentSchema.safeParse(row);
        if (!parsed.success) {
          result.errors.push({
            row: index + 1,
            message: "شماره دانشجویی یا نام کامل نامعتبر است.",
          });
          continue;
        }
        const data = parsed.data;
        try {
          await client.query(
            `INSERT INTO students (organization_id, student_number, full_name, major, term, phone, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              req.user.org,
              data.studentNumber,
              data.fullName,
              data.major,
              data.term,
              data.phone,
              data.status,
            ],
          );
          result.created += 1;
        } catch (error) {
          result.errors.push({
            row: index + 1,
            message:
              error.code === "23505"
                ? "شماره دانشجویی تکراری است."
                : "ثبت این سطر ناموفق بود.",
          });
        }
      }
    });
    res.status(201).json(result);
  }),
);

app.post(
  "/api/import/courses",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length)
      return res.status(400).json({ message: "فایل هیچ سطری ندارد." });
    if (rows.length > 500)
      return res
        .status(400)
        .json({ message: "حداکثر ۵۰۰ درس در هر ایمپورت مجاز است." });
    const result = { created: 0, errors: [] };
    await withTransaction(async (client) => {
      for (const [index, row] of rows.entries()) {
        const parsed = courseSchema.omit({ studentIds: true }).safeParse(row);
        if (!parsed.success) {
          result.errors.push({
            row: index + 1,
            message: "کد، عنوان یا نام استاد درس نامعتبر است.",
          });
          continue;
        }
        const data = parsed.data;
        try {
          await client.query(
            `INSERT INTO courses (organization_id, code, title, teacher_name, room, weekday, start_time, end_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              req.user.org,
              data.code,
              data.title,
              data.teacherName,
              data.room || null,
              data.weekday || null,
              data.startTime || null,
              data.endTime || null,
            ],
          );
          result.created += 1;
        } catch (error) {
          result.errors.push({
            row: index + 1,
            message:
              error.code === "23505"
                ? "کد یا عنوان درس تکراری است."
                : "ثبت این سطر ناموفق بود.",
          });
        }
      }
    });
    res.status(201).json(result);
  }),
);

/* ================= phase 2: analytics + live class ================= */

const analyticsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
  courseId: z.string().uuid().optional(),
});

function analyticsRange(input) {
  const to =
    input.to || new Date().toISOString().slice(0, 10);
  const from =
    input.from ||
    new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86400000)
      .toISOString()
      .slice(0, 10);
  return { from, to };
}

async function analyticsScope(req) {
  if (req.user.role !== "student") return { studentId: null };
  const student = await findStudentByUserId(req.user.sub, req.user.org);
  return { studentId: student?.id || "00000000-0000-0000-0000-000000000000" };
}

app.get(
  "/api/analytics/trend",
  validate(analyticsSchema, "query"),
  asyncRoute(async (req, res) => {
    const { from, to } = analyticsRange(req.query);
    const { studentId } = await analyticsScope(req);
    const granularity = req.query.granularity || "day";
    const params = [req.user.org, from, to];
    let scope = "";
    if (studentId) {
      params.push(studentId);
      scope += ` AND ar.student_id=$${params.length}`;
    }
    if (req.query.courseId) {
      params.push(req.query.courseId);
      scope += ` AND cs.course_id=$${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('${granularity}', cs.session_date),'YYYY-MM-DD') AS bucket,
              count(*)::int AS total,
              count(*) FILTER (WHERE ar.status='present')::int AS present,
              count(*) FILTER (WHERE ar.status='late')::int AS late,
              count(*) FILTER (WHERE ar.status='absent')::int AS absent,
              count(*) FILTER (WHERE ar.status='excused')::int AS excused,
              count(*) FILTER (WHERE ar.status='left_early')::int AS "leftEarly"
         FROM attendance_records ar
         JOIN class_sessions cs ON cs.id=ar.session_id
        WHERE cs.organization_id=$1 AND cs.session_date BETWEEN $2 AND $3${scope}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
    res.json({ from, to, granularity, rows });
  }),
);

app.get(
  "/api/analytics/courses",
  validate(
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    "query",
  ),
  asyncRoute(async (req, res) => {
    const { from, to } = analyticsRange(req.query);
    const { studentId } = await analyticsScope(req);
    const params = [req.user.org, from, to];
    let scope = "";
    if (studentId) {
      params.push(studentId);
      scope += ` AND ar.student_id=$${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.title,
              count(*)::int AS total,
              count(*) FILTER (WHERE ar.status='present')::int AS present,
              count(*) FILTER (WHERE ar.status='late')::int AS late,
              count(*) FILTER (WHERE ar.status='absent')::int AS absent,
              count(*) FILTER (WHERE ar.status='excused')::int AS excused,
              round(100.0 * count(*) FILTER (WHERE ar.status IN ('present','late'))
                    / greatest(count(*),1))::int AS rate
         FROM attendance_records ar
         JOIN class_sessions cs ON cs.id=ar.session_id
         JOIN courses c ON c.id=cs.course_id
        WHERE cs.organization_id=$1 AND cs.session_date BETWEEN $2 AND $3${scope}
        GROUP BY c.id, c.title ORDER BY rate DESC, c.title`,
      params,
    );
    res.json({ from, to, rows });
  }),
);

app.get(
  "/api/sessions/live",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT s.id, c.title AS "courseTitle", c.code AS "courseCode",
              to_char(s.session_date,'YYYY-MM-DD') AS date,
              to_char(s.start_time,'HH24:MI') AS "startTime",
              to_char(s.end_time,'HH24:MI') AS "endTime",
              s.teacher_name AS "teacherName", s.status,
              s.live_status AS "liveStatus", s.started_at AS "startedAt",
              s.ended_at AS "endedAt",
              count(ar.id)::int AS total,
              count(ar.id) FILTER (WHERE ar.status='present')::int AS present,
              count(ar.id) FILTER (WHERE ar.status='late')::int AS late,
              count(ar.id) FILTER (WHERE ar.status='absent')::int AS absent,
              count(ar.id) FILTER (WHERE ar.status='excused')::int AS excused,
              count(ar.id) FILTER (WHERE ar.status='unmarked')::int AS unmarked
         FROM class_sessions s
         JOIN courses c ON c.id=s.course_id
         LEFT JOIN attendance_records ar ON ar.session_id=s.id
        WHERE s.organization_id=$1 AND s.session_date=$2
        GROUP BY s.id, c.id
        ORDER BY s.start_time`,
      [req.user.org, date],
    );
    res.json(rows);
  }),
);

app.get(
  "/api/sessions/:sessionId/live",
  asyncRoute(async (req, res) => {
    const { rows: sessionRows } = await pool.query(
      `SELECT s.id, s.course_id AS "courseId", c.title AS "courseTitle",
              c.code AS "courseCode",
              to_char(s.session_date,'YYYY-MM-DD') AS date,
              to_char(s.start_time,'HH24:MI') AS "startTime",
              to_char(s.end_time,'HH24:MI') AS "endTime",
              s.teacher_name AS "teacherName", s.status,
              s.live_status AS "liveStatus", s.started_at AS "startedAt",
              s.ended_at AS "endedAt"
         FROM class_sessions s
         JOIN courses c ON c.id=s.course_id
        WHERE s.id=$1 AND s.organization_id=$2`,
      [req.params.sessionId, req.user.org],
    );
    const session = sessionRows[0];
    if (!session) return res.status(404).json({ message: "جلسه یافت نشد." });

    const params = [req.params.sessionId];
    let scope = "";
    if (req.user.role === "student") {
      const student = await findStudentByUserId(req.user.sub, req.user.org);
      if (!student)
        return res.status(404).json({ message: "حساب دانشجویی پیدا نشد." });
      params.push(student.id);
      scope = ` AND ar.student_id=$2`;
    }
    const { rows: students } = await pool.query(
      `SELECT ar.id AS "attendanceId", st.id AS "studentId",
              st.student_number AS "studentNumber", st.full_name AS "fullName",
              ar.status, ar.method, ar.checked_at AS "checkedAt"
         FROM attendance_records ar
         JOIN students st ON st.id=ar.student_id
        WHERE ar.session_id=$1${scope}
        ORDER BY st.full_name`,
      params,
    );
    res.json({ ...session, students });
  }),
);

app.post(
  "/api/sessions/:sessionId/live/start",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE class_sessions
          SET live_status='live', started_at=COALESCE(started_at, now()),
              ended_at=NULL,
              status=CASE WHEN status='finalized' THEN status ELSE 'started' END,
              updated_at=now()
        WHERE id=$1 AND organization_id=$2
        RETURNING id, live_status AS "liveStatus", started_at AS "startedAt"`,
      [req.params.sessionId, req.user.org],
    );
    if (!rows[0]) return res.status(404).json({ message: "جلسه یافت نشد." });
    res.json(rows[0]);
  }),
);

app.post(
  "/api/sessions/:sessionId/live/end",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE class_sessions
          SET live_status='ended', ended_at=now(), updated_at=now()
        WHERE id=$1 AND organization_id=$2
        RETURNING id, live_status AS "liveStatus", ended_at AS "endedAt"`,
      [req.params.sessionId, req.user.org],
    );
    if (!rows[0]) return res.status(404).json({ message: "جلسه یافت نشد." });
    res.json(rows[0]);
  }),
);

app.use((error, _req, res, _next) => {
  const status =
    error instanceof multer.MulterError
      ? 400
      : error.status || (error.code === "23505" ? 409 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({
    message:
      status === 409
        ? "رکورد تکراری است."
        : error.status
          ? error.message
          : "خطای غیرمنتظره در سرور رخ داد.",
  });
});
app.listen(port, () => console.log(`Hozorban API listening on ${port}`));

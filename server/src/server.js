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
import {
  examAnswersSchema,
  examInputSchema,
  examScheduleSchema,
  gradeAnswers,
  orderByAttempt,
  scoreVisible,
} from "./examGrading.js";
import {
  FACULTY_ADMIN_LEVELS,
  PLATFORM_LEVELS,
  platformLevelAllows,
} from "./platformAccess.js";
import {
  STAFF_ROLE_LABELS,
  STAFF_ROLES,
  normalizeStaffRole,
  permissionForRequest,
  permissionsForRole,
  staffRoleAllows,
} from "./permissions.js";
import {
  DEFAULT_FACE_MAX_DISTANCE,
  DEFAULT_FACE_MIN_MARGIN,
  FACE_DESCRIPTOR_MODEL,
  FACE_FEATURE_VERSION,
  FACE_METHODS,
  MAX_REFERENCE_PHOTOS,
  evaluateFaceAttendance,
  validateFaceEnrollment,
  verifyDescriptorClaim,
} from "./faceVerification.js";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { sendPasswordEmail } from "./mail.js";
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
// Brute-force protection is mounted only on the login endpoint and only
// counts failed attempts; successful sign-ins and other /api/auth routes
// (change-password, switch-faculty, login-history) must not exhaust it.
app.use(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
  }),
);
// The platform login is a separate surface; give it the same brute-force guard.
app.use(
  "/api/platform/auth/login",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
  }),
);

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const IMPERSONATION_TTL_MINUTES = 60;

function tokenFor(user, organizationId = user.organization_id) {
  return jwt.sign(
    { sub: user.id, org: organizationId, role: user.role },
    jwtSecret,
    { expiresIn: "8h", issuer: "hozorban-api", audience: "hozorban-web" },
  );
}
function tokenForPlatform(user) {
  return jwt.sign(
    {
      sub: user.id,
      org: user.organization_id,
      role: "admin",
      plat: user.platform_level,
    },
    jwtSecret,
    { expiresIn: "8h", issuer: "hozorban-api", audience: "hozorban-web" },
  );
}
// Short lived, faculty-scoped token.  The platform token stays in the browser
// and is never accepted by /api/platform/*, so "entering" a faculty cannot be
// used to escalate back into the control plane.
function tokenForImpersonation(platformUser, organizationId, sessionId) {
  return jwt.sign(
    {
      sub: platformUser.id,
      org: organizationId,
      role: "admin",
      adminLevel: "owner",
      imp: { sid: sessionId, by: platformUser.id },
    },
    jwtSecret,
    {
      expiresIn: `${IMPERSONATION_TTL_MINUTES}m`,
      issuer: "hozorban-api",
      audience: "hozorban-web",
    },
  );
}
function authorize(...allowed) {
  return (req, res, next) => {
    // A platform token is only allowed to use the platform API.  To touch
    // faculty data the admin must start an impersonation session first.
    if (req.user.plat && !req.user.imp)
      return res.status(403).json({
        message: "برای دسترسی به دادهٔ دانشکده ابتدا از پنل سامانه وارد یکی از دانشکده‌ها شوید.",
      });
    return allowed.includes(req.user.role)
      ? next()
      : res.status(403).json({ message: "دسترسی کافی نیست." });
  };
}
function requirePlatform(minLevel = "auditor") {
  return (req, res, next) => {
    if (!req.user.plat)
      return res.status(403).json({ message: "این بخش فقط برای مدیران سامانه است." });
    if (!platformLevelAllows(req.user.plat, minLevel))
      return res.status(403).json({ message: "سطح دسترسی شما برای این عملیات کافی نیست." });
    return next();
  };
}
async function authenticate(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token)
    return res.status(401).json({ message: "ورود به سامانه لازم است." });
  try {
    req.user = jwt.verify(token, jwtSecret, {
      issuer: "hozorban-api",
      audience: "hozorban-web",
    });
  } catch {
    return res.status(401).json({ message: "نشست معتبر نیست." });
  }

  try {
    const { rows: orgRows } = await pool.query(
      "SELECT id, kind, is_active FROM organizations WHERE id = $1",
      [req.user.org],
    );
    const organization = orgRows[0];
    if (!organization || !organization.is_active)
      return res
        .status(401)
        .json({ message: "دانشکدهٔ انتخابی غیرفعال است؛ با مدیر سامانه تماس بگیرید." });

    // Tokens issued by "enter faculty" carry a session id.  Re-check the
    // session (and the platform account) on every request so access can be
    // revoked immediately.
    if (req.user.imp?.sid) {
      const { rows } = await pool.query(
        `SELECT i.id
           FROM admin_impersonations i
           JOIN users u ON u.id = i.platform_user_id
          WHERE i.id = $1
            AND i.organization_id = $2
            AND i.ended_at IS NULL
            AND i.expires_at > now()
            AND u.is_active = true
            AND u.platform_level IS NOT NULL`,
        [req.user.imp.sid, req.user.org],
      );
      if (!rows[0])
        return res.status(401).json({
          message: "نشست ورود به دانشکده پایان یافته است؛ دوباره از پنل سامانه وارد شوید.",
        });
      req.user.impersonating = true;
      req.user.platformActorId = req.user.imp.by;
      req.user.adminLevel = "owner";
      return next();
    }

    // Platform (control plane) token: trust only the database, not the claim.
    if (req.user.plat) {
      const { rows } = await pool.query(
        `SELECT u.platform_level, u.must_change_password
           FROM users u
           JOIN organizations o ON o.id = u.organization_id
          WHERE u.id = $1 AND u.is_active = true
            AND o.kind = 'platform'
            AND u.platform_level IS NOT NULL`,
        [req.user.sub],
      );
      if (!rows[0])
        return res
          .status(401)
          .json({ message: "دسترسی مدیر سامانه معتبر نیست." });
      req.user.plat = rows[0].platform_level;
      const currentPath = req.originalUrl.split("?")[0];
      if (
        rows[0].must_change_password &&
        currentPath !== "/api/auth/change-password"
      )
        return res.status(403).json({
          message: "برای ادامه ابتدا رمز عبور اولیهٔ حساب سامانه را تغییر دهید.",
        });
      return next();
    }

    // Staff can be removed from a faculty, and any account can be deactivated,
    // while an old token is still valid. Re-check on every request so revocation
    // is immediate. Students are included here so a temporary password really
    // forces a change before the panel (and its API) opens.
    const { rows } = await pool.query(
      `SELECT u.must_change_password, u.role, u.admin_level
         FROM users u
        WHERE u.id = $1 AND u.is_active = true AND u.role = $3
          AND (u.organization_id = $2 OR EXISTS (
                SELECT 1 FROM user_faculties uf
                 WHERE uf.user_id = u.id AND uf.organization_id = $2))`,
      [req.user.sub, req.user.org, req.user.role],
    );
    if (!rows[0])
      return res
        .status(401)
        .json({ message: "دسترسی شما به این دانشکده معتبر نیست." });
    req.user.adminLevel =
      rows[0].admin_level || (rows[0].role === "admin" ? "owner" : null);
    // A temporary password may only be used to reach the change-password
    // endpoint. Everything else stays blocked until a new password is set.
    const currentPath = req.originalUrl.split("?")[0];
    if (
      rows[0].must_change_password &&
      currentPath !== "/api/auth/change-password"
    )
      return res.status(403).json({
        message: "برای ادامه ابتدا رمز عبور اولیه را تغییر دهید.",
      });
  } catch (error) {
    return next(error);
  }
  return next();
}

// Faculty staff permissions: the role is resolved on every request (so a
// changed role takes effect immediately) and checked against the endpoint's
// declared permission. Unknown endpoints are denied for non-owners, which makes
// the default fail-closed instead of leaking a forgotten route.
function enforceFacultyAdminLevel(req, res, next) {
  if (req.user.role !== "admin" || (req.user.plat && !req.user.imp)) return next();
  const level = normalizeStaffRole(req.user.adminLevel);
  if (level === "owner") return next();
  const path = req.originalUrl.split("?")[0];
  const permission = permissionForRequest(req.method, path);
  if (permission === null) return next();
  if (permission === "unmapped" || !staffRoleAllows(level, permission)) {
    return res.status(403).json({
      message:
        `این بخش برای سطح دسترسی «${STAFF_ROLE_LABELS[level]}» باز نیست. ` +
        "در صورت نیاز با مدیر دانشکده هماهنگ کنید.",
    });
  }
  return next();
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

async function listFingerprintCredentials(organizationId, studentId = null, teacherUserId = null) {
  const conditions = [
    "fc.organization_id = $1",
    "fc.revoked_at IS NULL",
  ];
  const params = [organizationId];
  if (studentId) {
    params.push(studentId);
    conditions.push(`fc.student_id = $${params.length}`);
  }
  if (teacherUserId) {
    params.push(teacherUserId);
    conditions.push(`(
      EXISTS (
        SELECT 1 FROM course_students cs
          JOIN courses c ON c.id = cs.course_id
         WHERE cs.student_id = fc.student_id
           AND c.organization_id = $1 AND c.teacher_user_id = $${params.length}
      )
      OR EXISTS (
        SELECT 1 FROM session_students ss
          JOIN class_sessions s ON s.id = ss.session_id
          JOIN courses c ON c.id = s.course_id
         WHERE ss.student_id = fc.student_id
           AND s.organization_id = $1 AND c.teacher_user_id = $${params.length}
      )
    )`);
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
  // users.student_id is normally the students.id UUID, but older demo accounts
  // stored the student number there. Support both formats so student-scoped
  // features (exams, live sessions, profile photo) work for every account.
  const { rows } = await pool.query(
    `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS "fullName"
       FROM users u
       JOIN students st
         ON st.organization_id = u.organization_id
        AND (
          st.student_number = u.student_id
          OR (
            u.student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND st.id = u.student_id::uuid
          )
        )
      WHERE u.id = $1 AND u.organization_id = $2 AND u.is_active = true
      LIMIT 1`,
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
    mustChangePassword: row.must_change_password === true,
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

/* ----------------------- teacher course ownership ----------------------- */
// A teacher may only touch courses they own. Admins keep faculty-wide access.
function isTeacher(req) {
  return req.user.role === "teacher";
}

async function teacherOwnsSession(req, sessionId) {
  if (!isTeacher(req)) return true;
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM class_sessions s
       JOIN courses c ON c.id = s.course_id
      WHERE s.id = $1 AND s.organization_id = $2 AND c.teacher_user_id = $3`,
    [sessionId, req.user.org, req.user.sub],
  );
  return rowCount > 0;
}

// Students a teacher may see/act on: enrolled in one of their courses or in one
// of their sessions. Admins keep faculty-wide access.
async function teacherOwnsStudent(req, studentId) {
  if (!isTeacher(req)) return true;
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM students st
      WHERE st.id = $1 AND st.organization_id = $2
        AND (
          EXISTS (
            SELECT 1 FROM course_students cs
              JOIN courses c ON c.id = cs.course_id
             WHERE cs.student_id = st.id
               AND c.organization_id = $2 AND c.teacher_user_id = $3
          )
          OR EXISTS (
            SELECT 1 FROM session_students ss
              JOIN class_sessions s ON s.id = ss.session_id
              JOIN courses c ON c.id = s.course_id
             WHERE ss.student_id = st.id
               AND s.organization_id = $2 AND c.teacher_user_id = $3
          )
        )`,
    [studentId, req.user.org, req.user.sub],
  );
  return rowCount > 0;
}

// Resolve the teacher a course belongs to. Teachers always own what they create;
// admins may pick any active teacher of the faculty (or leave it unassigned).
async function resolveCourseTeacher(req, teacherId, teacherName) {
  if (isTeacher(req)) {
    const { rows } = await pool.query(
      "SELECT id, display_name FROM users WHERE id = $1",
      [req.user.sub],
    );
    return {
      id: req.user.sub,
      name: rows[0]?.display_name || teacherName || "",
    };
  }
  if (!teacherId) return { id: null, name: teacherName || "" };
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name AS name
       FROM users u
      WHERE u.id = $1 AND u.role = 'teacher' AND u.is_active = true
        AND (u.organization_id = $2 OR EXISTS (
              SELECT 1 FROM user_faculties uf
               WHERE uf.user_id = u.id AND uf.organization_id = $2))`,
    [teacherId, req.user.org],
  );
  if (!rows[0])
    throw Object.assign(
      new Error("استاد انتخاب‌شده در این دانشکده فعال نیست."),
      { status: 422 },
    );
  return { id: rows[0].id, name: rows[0].name };
}

async function authPayload(user, organizationId = user.organization_id) {
  const faculty = await loadFaculty(organizationId);
  const faculties = await listUserFaculties(user);
  return {
    token: tokenFor(user, organizationId),
    user: { ...publicUser(user), ...staffFields(user), faculty, faculties },
  };
}

// The client needs the role and the exact permission list so navigation and
// buttons can match what the API will allow.
function staffFields(row) {
  if (row.role !== "admin") return {};
  const staffRole = normalizeStaffRole(row.admin_level);
  return {
    staffRole,
    staffRoleLabel: STAFF_ROLE_LABELS[staffRole],
    permissions: permissionsForRole(staffRole),
  };
}

// Readable one-time password for a teacher created by a faculty admin. The
// admin never chooses it; it is shown once in the UI and only the hash is stored.
function generateTemporaryPassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(length);
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[bytes[index] % alphabet.length];
  }
  return value;
}

// A student logs in with the student number, so that number is the username.
// users.email still has to be unique per faculty; when the faculty does not
// collect a real address an internal placeholder keeps the constraint happy.
function studentAccountEmail(studentNumber) {
  const slug = String(studentNumber)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return `${slug || `student-${crypto.randomUUID().slice(0, 8)}`}@students.local`;
}

async function platformOrganization() {
  const { rows } = await pool.query(
    "SELECT id, name FROM organizations WHERE kind = 'platform' LIMIT 1",
  );
  return rows[0] || null;
}

// One shared creator for faculty admins and platform admins.  The password is
// only ever returned once; the database keeps a bcrypt hash and password
// history, exactly like the teacher/student provisioning flows.
async function createAdminAccount(
  client,
  { organizationId, fullName, email, level, platformLevel = null, createdBy = null },
) {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const { rows } = await client.query(
    `INSERT INTO users
       (organization_id, email, password_hash, display_name, role, is_active,
        must_change_password, admin_level, platform_level, password_last_changed)
     VALUES ($1, lower($2), $3, $4, 'admin', true, true, $5, $6, now())
     RETURNING id, email, display_name AS "fullName", admin_level AS "adminLevel",
               platform_level AS "platformLevel"`,
    [organizationId, email, passwordHash, fullName, level, platformLevel],
  );
  await client.query(
    `INSERT INTO password_history (user_id, password_hash, created_at)
     VALUES ($1, $2, now())`,
    [rows[0].id, passwordHash],
  );
  return {
    ...rows[0],
    createdBy,
    temporaryPassword,
  };
}

// Staff emails are the login identifier, so they must be unique across the
// whole platform.  Student placeholder addresses live in their own faculty and
// are excluded on purpose (the same student number may exist twice).
async function staffEmailTaken(client, email, exceptUserId = null) {
  const { rows } = await client.query(
    `SELECT id FROM users
      WHERE lower(email) = lower($1)
        AND role <> 'student'
        AND ($2::uuid IS NULL OR id <> $2)
      LIMIT 1`,
    [email, exceptUserId],
  );
  return rows[0] || null;
}

function facultyDisplayName(row) {
  return row?.name || "دانشکده";
}


// Shared predicate: does this students row (aliased `st`) already have a login?
const STUDENT_HAS_ACCOUNT_SQL = `EXISTS (
  SELECT 1 FROM users u
   WHERE u.organization_id = st.organization_id
     AND u.role = 'student'
     AND u.is_active = true
     AND u.student_id IN (st.student_number, st.id::text)
)`;

async function createStudentAccount(
  client,
  { organizationId, student, email = "" },
) {
  const username = student.student_number;
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const loginEmail =
    String(email || "").trim().toLowerCase() || studentAccountEmail(username);
  const { rows } = await client.query(
    `INSERT INTO users
       (organization_id, email, password_hash, display_name, role, student_id,
        is_active, must_change_password, password_last_changed)
     VALUES ($1,$2,$3,$4,'student',$5,true,true,now())
     RETURNING id, email`,
    [organizationId, loginEmail, passwordHash, student.full_name, student.id],
  );
  await client.query(
    `INSERT INTO password_history (user_id, password_hash, created_at)
     VALUES ($1,$2,now())`,
    [rows[0].id, passwordHash],
  );
  return {
    userId: rows[0].id,
    studentId: student.id,
    fullName: student.full_name,
    studentNumber: username,
    username,
    email: rows[0].email,
    temporaryPassword,
  };
}

// Teachers may only provision accounts for students enrolled in their own
// courses (or in a session of one of their courses).
async function teacherCanManageStudent(client, teacherUserId, organizationId, studentId) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM course_students cs
       JOIN courses c ON c.id = cs.course_id
      WHERE cs.student_id = $1 AND c.organization_id = $2
        AND c.teacher_user_id = $3
      UNION ALL
     SELECT 1 FROM session_students ss
       JOIN class_sessions s ON s.id = ss.session_id
       JOIN courses c ON c.id = s.course_id
      WHERE ss.student_id = $1 AND s.organization_id = $2
        AND c.teacher_user_id = $3
      LIMIT 1`,
    [studentId, organizationId, teacherUserId],
  );
  return rowCount > 0;
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
  teacherId: z.string().uuid().nullable().optional(),
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
  faceVerification: z
    .object({
      distance: z.number().finite().min(0).max(2),
      margin: z.number().finite().min(0).max(2).nullable().optional(),
      threshold: z.number().finite().min(0).max(2).nullable().optional(),
      liveness: z
        .enum(["blink", "motion", "teacher_confirm", "none_provided"])
        .optional(),
      frameCount: z.number().int().min(0).max(600).optional(),
      deviceId: z.string().trim().max(200).optional(),
      referenceId: z.string().uuid().optional(),
      // Phase 3+: the live descriptor lets the server re-verify the match.
      descriptor: z.array(z.number().finite()).length(128).optional(),
    })
    .optional(),
});
const settingsSchema = z.object({
  systemName: z.string().trim().min(1).max(120),
  lateAfterMinutes: z.number().int().min(0).max(120),
  notificationsEnabled: z.boolean().default(true),
  faceRecognitionEnabled: z.boolean().default(true),
  faceMatchDistance: z.number().min(0.3).max(0.7).default(0.54),
  faceMatchMargin: z.number().min(0).max(0.2).default(0.035),
  faceMinFrames: z.number().int().min(1).max(10).default(3),
  faceLivenessRequired: z.boolean().default(true),
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
      "SELECT id, name, code FROM organizations WHERE is_active = true AND kind = 'faculty' ORDER BY name",
    );
    res.json({ faculties: rows });
  }),
);

/* ------------------------- platform (super admin) ------------------------- */

app.post(
  "/api/platform/auth/login",
  validate(
    z.object({
      identifier: z.string().trim().min(3).max(254),
      password: z.string().min(8).max(128),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { identifier, password } = req.body;
    const { rows } = await pool.query(
      `SELECT u.*, o.kind AS organization_kind
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower($1)
          AND u.is_active = true
          AND o.is_active = true
          AND o.kind = 'platform'
          AND u.platform_level IS NOT NULL
        LIMIT 1`,
      [identifier],
    );
    const user = rows[0];
    if (!user) {
      return res
        .status(401)
        .json({ message: "نام کاربری یا رمز عبور مدیر سامانه نادرست است." });
    }
    if (user.account_locked_until && user.account_locked_until > new Date()) {
      const seconds = Math.ceil((user.account_locked_until - new Date()) / 1000);
      return res.status(423).json({
        message: `حساب مدیر سامانه موقتاً قفل است. لطفاً ${Math.ceil(seconds / 60)} دقیقه دیگر تلاش کنید.`,
      });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      await pool.query(
        `UPDATE users
            SET failed_login_attempts = $2,
                last_failed_login = now(),
                account_locked_until =
                  CASE WHEN $2 >= 5 THEN now() + interval '5 minutes' ELSE account_locked_until END
          WHERE id = $1`,
        [user.id, attempts],
      );
      return res
        .status(401)
        .json({ message: "نام کاربری یا رمز عبور مدیر سامانه نادرست است." });
    }

    await pool.query(
      `UPDATE users
          SET failed_login_attempts = 0,
              last_failed_login = NULL,
              account_locked_until = NULL,
              password_last_changed = COALESCE(password_last_changed, now())
        WHERE id = $1`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO login_history (user_id, organization_id, ip_address, user_agent, successful)
       VALUES ($1, $2, $3, $4, true)`,
      [user.id, user.organization_id, req.ip, req.get("user-agent") || null],
    );

    res.json({
      token: tokenForPlatform(user),
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        platformLevel: user.platform_level,
        mustChangePassword: user.must_change_password === true,
        organization: { id: user.organization_id, name: "پنل سامانه" },
      },
    });
  }),
);

// A student signs in with the student number the faculty assigned, while staff
// keep signing in with an email. Both resolve to the same users row, so no
// separate username column is needed: students.student_number is the username.
const LOGIN_IDENTIFIER_MATCH = `(
  lower(u.email) = lower($1)
  OR (
    u.role = 'student'
    AND EXISTS (
      SELECT 1 FROM students st
       WHERE st.organization_id = u.organization_id
         AND st.student_number = $1
         AND u.student_id IN (st.student_number, st.id::text)
    )
  )
)`;

app.post(
  "/api/auth/login",
  validate(
    z
      .object({
        identifier: z.string().trim().min(3).max(254).optional(),
        // Older clients still post the identifier as `email`.
        email: z.string().trim().min(3).max(254).optional(),
        password: z.string().min(8).max(128),
        facultyId: z.string().uuid().optional(),
      })
      .refine((body) => Boolean((body.identifier || body.email || "").trim()), {
        message: "نام کاربری یا ایمیل را وارد کنید.",
        path: ["identifier"],
      }),
  ),
  asyncRoute(async (req, res) => {
    const identifier = (req.body.identifier || req.body.email || "").trim();
    const { password, facultyId } = req.body;
    const result = await pool.query(
      `SELECT u.* FROM users u
         JOIN organizations o
           ON o.id = u.organization_id
          AND o.kind = 'faculty'
          AND o.is_active = true
        WHERE u.is_active = true
          AND ($2::uuid IS NULL OR u.organization_id = $2)
          AND ${LOGIN_IDENTIFIER_MATCH}
        ORDER BY u.created_at`,
      [identifier, facultyId || null],
    );
    let user = null;
    for (const candidate of result.rows) {
      if (await bcrypt.compare(password, candidate.password_hash)) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      // Increment failed attempts for any account matching this identifier.
      const { rowCount } = await pool.query(
        `UPDATE users u
            SET failed_login_attempts = failed_login_attempts + 1,
                last_failed_login = now()
           FROM organizations o
          WHERE o.id = u.organization_id
            AND o.kind = 'faculty'
            AND o.is_active = true
            AND u.is_active = true
            AND ($2::uuid IS NULL OR u.organization_id = $2)
            AND ${LOGIN_IDENTIFIER_MATCH}
          RETURNING u.id, u.email`,
        [identifier, facultyId || null],
      );
      if (rowCount > 0) {
        const { rows: lockedRows } = await pool.query(
          `SELECT u.id FROM users u
             JOIN organizations o ON o.id = u.organization_id
            WHERE o.kind = 'faculty'
              AND o.is_active = true
              AND u.is_active = true
              AND u.failed_login_attempts >= 5
              AND ($2::uuid IS NULL OR u.organization_id = $2)
              AND ${LOGIN_IDENTIFIER_MATCH}`,
          [identifier, facultyId || null],
        );
        for (const lock of lockedRows) {
          await pool.query(
            `UPDATE users SET account_locked_until = now() + interval '5 minutes' WHERE id = $1`,
            [lock.id],
          );
        }
      }
      return res
        .status(401)
        .json({ message: "نام کاربری یا رمز عبور نادرست است." });
    }

    // Lockout check: if account is locked, deny login
    if (user.account_locked_until && user.account_locked_until > new Date()) {
      const remainingMs = user.account_locked_until - new Date();
      const remainingSec = Math.ceil(remainingMs / 1000);
      return res
        .status(423)
        .json({
          message:
            remainingSec > 60
              ? `حساب شما به دلیل تلاش‌های ناموفق موقت قفل شده است. لطفاً بعد از ${Math.ceil(remainingSec / 60)} دقیقه دوباره تلاش کنید.`
              : `حساب شما به دلیل تلاش‌های ناموفق موقت قفل شده است. لطفاً بعد از ${remainingSec} ثانیه دوباره تلاش کنید.`,
        });
    }

    // Successful login: reset failed attempts and record login history
    await pool.query(
      `UPDATE users SET failed_login_attempts = 0,
                         last_failed_login = NULL,
                         account_locked_until = NULL,
                         password_last_changed = COALESCE(password_last_changed, now())
        WHERE id = $1`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO login_history (user_id, organization_id, ip_address, user_agent, successful)
       VALUES ($1, $2, $3, $4, true)`,
      [user.id, user.organization_id, req.ip, req.get("user-agent") || null],
    );

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
// The control plane and the faculty plane share one JWT implementation but not
// one surface: a platform token may only call /api/platform/*, and a faculty
// token may never call it.
app.use("/api", (req, res, next) => {
  const path = req.originalUrl.split("?")[0];
  if (
    req.user.plat &&
    !req.user.imp &&
    !path.startsWith("/api/platform") &&
    !path.startsWith("/api/auth/")
  )
    return res.status(403).json({
      message: "برای دسترسی به دادهٔ دانشکده ابتدا از پنل سامانه وارد یکی از دانشکده‌ها شوید.",
    });
  return next();
});
app.use("/api", enforceFacultyAdminLevel);

// Leaving an impersonation session is the only endpoint that a faculty-scoped
// platform token may call outside the faculty data set.
app.post(
  "/api/auth/exit-impersonation",
  asyncRoute(async (req, res) => {
    if (!req.user.imp?.sid)
      return res
        .status(400)
        .json({ message: "نشست ورود به دانشکده فعال نیست." });
    const { rows } = await pool.query(
      `UPDATE admin_impersonations
          SET ended_at = now(), ended_by = $2, ended_reason = 'manual'
        WHERE id = $1 AND ended_at IS NULL
        RETURNING organization_id`,
      [req.user.imp.sid, req.user.sub],
    );
    if (rows[0]) {
      await audit(
        pool,
        rows[0].organization_id,
        req.user.sub,
        "platform.impersonation.end",
        "faculty",
        rows[0].organization_id,
        { reason: "manual" },
      );
    }
    res.json({ ok: true });
  }),
);

/* --------------------------- platform endpoints --------------------------- */

const FACULTY_SELECT = `
  o.id, o.name, o.code, o.slug,
  o.is_active AS "isActive", o.archived_at AS "archivedAt",
  o.contact_name AS "contactName", o.contact_email AS "contactEmail",
  o.contact_phone AS "contactPhone", o.created_at AS "createdAt"
`;
const FACULTY_STATS_SELECT = `
  (SELECT count(*)::int FROM students s WHERE s.organization_id = o.id) AS "students",
  (SELECT count(*)::int FROM users u WHERE u.organization_id = o.id AND u.role = 'teacher' AND u.is_active) AS "teachers",
  (SELECT count(*)::int FROM users u WHERE u.organization_id = o.id AND u.role = 'admin' AND u.is_active) AS "admins",
  (SELECT count(*)::int FROM courses c WHERE c.organization_id = o.id) AS "courses",
  (SELECT count(*)::int FROM exams e WHERE e.organization_id = o.id) AS "exams",
  (SELECT max(al.created_at) FROM audit_logs al WHERE al.organization_id = o.id) AS "lastActivity"
`;

async function loadFacultyForPlatform(client, facultyId) {
  const { rows } = await client.query(
    `SELECT ${FACULTY_SELECT}, ${FACULTY_STATS_SELECT}
       FROM organizations o
      WHERE o.id = $1 AND o.kind = 'faculty'`,
    [facultyId],
  );
  return rows[0] || null;
}

async function facultyAdmins(facultyId) {
  const { rows } = await pool.query(
    `SELECT u.id,
            u.display_name AS "fullName",
            u.email,
            u.is_active AS "isActive",
            COALESCE(u.admin_level, 'owner') AS "level",
            u.must_change_password AS "mustChangePassword",
            u.created_at AS "createdAt",
            (SELECT max(lh.login_time) FROM login_history lh
              WHERE lh.user_id = u.id AND lh.successful = true) AS "lastLoginAt"
       FROM users u
      WHERE u.organization_id = $1 AND u.role = 'admin'
      ORDER BY u.created_at`,
    [facultyId],
  );
  return rows;
}

const facultyAdminLevels = FACULTY_ADMIN_LEVELS;
const platformLevels = PLATFORM_LEVELS;
const facultyContactShape = {
  slug: z.string().trim().max(60).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z
    .union([z.literal(""), z.string().trim().email().max(254)])
    .optional(),
  contactPhone: z.string().trim().max(40).optional(),
};
const facultyCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, "کد دانشکده فقط می‌تواند شامل حرف، رقم، خط تیره و زیرخط باشد.");

app.get(
  "/api/platform/me",
  requirePlatform("auditor"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, email, display_name AS "name", platform_level AS "platformLevel"
         FROM users WHERE id = $1`,
      [req.user.sub],
    );
    res.json({ user: rows[0] || null });
  }),
);

app.get(
  "/api/platform/overview",
  requirePlatform("auditor"),
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM organizations WHERE kind = 'faculty') AS "faculties",
         (SELECT count(*)::int FROM organizations WHERE kind = 'faculty' AND is_active) AS "activeFaculties",
         (SELECT count(*)::int FROM students) AS "students",
         (SELECT count(*)::int FROM users WHERE role = 'teacher' AND is_active) AS "teachers",
         (SELECT count(*)::int FROM users WHERE role = 'admin' AND is_active AND platform_level IS NULL) AS "facultyAdmins",
         (SELECT count(*)::int FROM courses) AS "courses",
         (SELECT count(*)::int FROM exams) AS "exams"`,
    );
    const { rows: recent } = await pool.query(
      `SELECT al.id, al.action, al.created_at AS "createdAt",
              o.name AS "organizationName", u.display_name AS "actorName"
         FROM audit_logs al
         JOIN organizations o ON o.id = al.organization_id
         LEFT JOIN users u ON u.id = al.actor_id
        WHERE o.kind = 'faculty'
        ORDER BY al.created_at DESC
        LIMIT 8`,
    );
    res.json({ stats: rows[0], recentActivity: recent });
  }),
);

app.get(
  "/api/platform/faculties",
  requirePlatform("auditor"),
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT ${FACULTY_SELECT}, ${FACULTY_STATS_SELECT}
         FROM organizations o
        WHERE o.kind = 'faculty'
        ORDER BY o.created_at DESC`,
    );
    res.json({ faculties: rows });
  }),
);

app.post(
  "/api/platform/faculties",
  requirePlatform("operator"),
  validate(
    z.object({
      name: z.string().trim().min(2).max(120),
      code: facultyCodeSchema,
      ...facultyContactShape,
      adminFullName: z.string().trim().min(2).max(120),
      adminEmail: z.string().trim().email().max(254),
      adminLevel: z.enum(facultyAdminLevels).default("owner"),
    }),
  ),
  asyncRoute(async (req, res) => {
    const {
      name,
      code,
      slug,
      contactName,
      contactEmail,
      contactPhone,
      adminFullName,
      adminEmail,
      adminLevel,
    } = req.body;
    const normalizedCode = code.toUpperCase();
    const conflict = await pool.query(
      `SELECT name, code FROM organizations
        WHERE kind = 'faculty'
          AND (lower(name) = lower($1) OR lower(code) = lower($2))
        LIMIT 1`,
      [name, normalizedCode],
    );
    if (conflict.rows[0])
      return res.status(409).json({
        message:
          conflict.rows[0].name?.toLowerCase() === name.toLowerCase()
            ? "دانشکده‌ای با این نام از قبل وجود دارد."
            : "این کد دانشکده قبلاً استفاده شده است.",
      });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (await staffEmailTaken(client, adminEmail)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "این ایمیل قبلاً برای حساب دیگری در سامانه ثبت شده است.",
        });
      }
      const createdFaculty = await client.query(
        `INSERT INTO organizations
           (name, code, kind, slug, contact_name, contact_email, contact_phone, created_by)
         VALUES ($1,$2,'faculty',$3,$4,$5,$6,$7)
         RETURNING id, name, code, slug`,
        [
          name,
          normalizedCode,
          (slug || normalizedCode).toLowerCase(),
          contactName || null,
          contactEmail || null,
          contactPhone || null,
          req.user.sub,
        ],
      );
      const facultyId = createdFaculty.rows[0].id;
      const account = await createAdminAccount(client, {
        organizationId: facultyId,
        fullName: adminFullName,
        email: adminEmail,
        level: adminLevel,
        createdBy: req.user.sub,
      });
      await client.query(
        `INSERT INTO organization_settings (organization_id) VALUES ($1)
         ON CONFLICT (organization_id) DO NOTHING`,
        [facultyId],
      );
      await audit(
        client,
        facultyId,
        req.user.sub,
        "platform.faculty.create",
        "faculty",
        facultyId,
        { name, code: normalizedCode, scope: "platform" },
      );
      await audit(
        client,
        facultyId,
        req.user.sub,
        "platform.faculty.admin.create",
        "admin",
        account.id,
        { email: adminEmail, level: adminLevel, scope: "platform" },
      );
      await client.query("COMMIT");
      const faculty = await loadFacultyForPlatform(pool, facultyId);
      res.status(201).json({
        faculty,
        admin: {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          level: account.adminLevel,
        },
        account: {
          username: account.email,
          temporaryPassword: account.temporaryPassword,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return res
          .status(409)
          .json({ message: "دانشکده یا حساب هم‌زمان توسط مدیر دیگری ساخته شد." });
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.get(
  "/api/platform/faculties/:id",
  requirePlatform("auditor"),
  asyncRoute(async (req, res) => {
    const faculty = await loadFacultyForPlatform(pool, req.params.id);
    if (!faculty)
      return res.status(404).json({ message: "دانشکده یافت نشد." });
    const admins = await facultyAdmins(faculty.id);
    const { rows: sessions } = await pool.query(
      `SELECT i.id, i.started_at AS "startedAt", i.expires_at AS "expiresAt",
              i.reason, u.display_name AS "platformName"
         FROM admin_impersonations i
         JOIN users u ON u.id = i.platform_user_id
        WHERE i.organization_id = $1 AND i.ended_at IS NULL AND i.expires_at > now()
        ORDER BY i.started_at DESC`,
      [faculty.id],
    );
    res.json({ faculty, admins, activeSessions: sessions });
  }),
);

app.patch(
  "/api/platform/faculties/:id",
  requirePlatform("operator"),
  validate(
    z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        code: facultyCodeSchema.optional(),
        ...facultyContactShape,
        isActive: z.boolean().optional(),
      })
      .partial(),
  ),
  asyncRoute(async (req, res) => {
    const existing = await loadFacultyForPlatform(pool, req.params.id);
    if (!existing)
      return res.status(404).json({ message: "دانشکده یافت نشد." });
    const body = req.body;
    const name = body.name ?? existing.name;
    const code = (body.code ?? existing.code ?? "").toUpperCase();
    if (body.name || body.code) {
      const conflict = await pool.query(
        `SELECT id, name, code FROM organizations
          WHERE kind = 'faculty' AND id <> $3
            AND (lower(name) = lower($1) OR lower(code) = lower($2))
          LIMIT 1`,
        [name, code, existing.id],
      );
      if (conflict.rows[0])
        return res.status(409).json({
          message:
            conflict.rows[0].name?.toLowerCase() === name.toLowerCase()
              ? "دانشکده‌ای با این نام از قبل وجود دارد."
              : "این کد دانشکده قبلاً استفاده شده است.",
        });
    }
    const isActive = body.isActive ?? existing.isActive;
    const { rows } = await pool.query(
      `UPDATE organizations
          SET name = $2,
              code = $3,
              slug = $4,
              contact_name = $5,
              contact_email = $6,
              contact_phone = $7,
              is_active = $8,
              archived_at = CASE
                WHEN $8 = true THEN NULL
                WHEN archived_at IS NULL THEN now()
                ELSE archived_at
              END
        WHERE id = $1 AND kind = 'faculty'
        RETURNING id`,
      [
        existing.id,
        name,
        code,
        (body.slug ?? existing.slug ?? code).toLowerCase(),
        body.contactName ?? existing.contactName,
        body.contactEmail ?? existing.contactEmail,
        body.contactPhone ?? existing.contactPhone,
        isActive,
      ],
    );
    if (!isActive) {
      await pool.query(
        `UPDATE admin_impersonations
            SET ended_at = now(), ended_reason = 'faculty_deactivated'
          WHERE organization_id = $1 AND ended_at IS NULL`,
        [existing.id],
      );
    }
    await audit(
      pool,
      existing.id,
      req.user.sub,
      "platform.faculty.update",
      "faculty",
      existing.id,
      { scope: "platform", changes: body, isActive },
    );
    res.json({ faculty: await loadFacultyForPlatform(pool, rows[0].id) });
  }),
);

app.post(
  "/api/platform/faculties/:id/archive",
  requirePlatform("operator"),
  asyncRoute(async (req, res) => {
    const existing = await loadFacultyForPlatform(pool, req.params.id);
    if (!existing)
      return res.status(404).json({ message: "دانشکده یافت نشد." });
    await pool.query(
      `UPDATE organizations
          SET is_active = false, archived_at = COALESCE(archived_at, now())
        WHERE id = $1 AND kind = 'faculty'`,
      [existing.id],
    );
    await pool.query(
      `UPDATE admin_impersonations
          SET ended_at = now(), ended_reason = 'faculty_archived'
        WHERE organization_id = $1 AND ended_at IS NULL`,
      [existing.id],
    );
    await audit(
      pool,
      existing.id,
      req.user.sub,
      "platform.faculty.archive",
      "faculty",
      existing.id,
      { scope: "platform" },
    );
    res.json({ faculty: await loadFacultyForPlatform(pool, existing.id) });
  }),
);

app.post(
  "/api/platform/faculties/:id/admin",
  requirePlatform("operator"),
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(254),
      level: z.enum(facultyAdminLevels).default("owner"),
    }),
  ),
  asyncRoute(async (req, res) => {
    const faculty = await loadFacultyForPlatform(pool, req.params.id);
    if (!faculty)
      return res.status(404).json({ message: "دانشکده یافت نشد." });
    if (!faculty.isActive)
      return res
        .status(409)
        .json({ message: "دانشکده غیرفعال است؛ ابتدا آن را فعال کنید." });
    const { fullName, email, level } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (await staffEmailTaken(client, email)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "این ایمیل قبلاً برای حساب دیگری در سامانه ثبت شده است.",
        });
      }
      const account = await createAdminAccount(client, {
        organizationId: faculty.id,
        fullName,
        email,
        level,
        createdBy: req.user.sub,
      });
      await audit(
        client,
        faculty.id,
        req.user.sub,
        "platform.faculty.admin.create",
        "admin",
        account.id,
        { email, level, scope: "platform" },
      );
      await client.query("COMMIT");
      try {
        await notifyUsers(faculty.id, [account.id], {
          type: "system",
          title: "دسترسی مدیریت دانشکده",
          message: `حساب شما با سطح «${level}» در دانشکدهٔ «${faculty.name}» ساخته شد. رمز موقت را از مدیر سامانه دریافت کنید.`,
          link: "dashboard",
        });
      } catch (notifyError) {
        console.warn("[platform] admin notification failed:", notifyError.message);
      }
      res.status(201).json({
        admin: {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          level: account.adminLevel,
          isActive: true,
        },
        account: {
          username: account.email,
          temporaryPassword: account.temporaryPassword,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return res
          .status(409)
          .json({ message: "این ایمیل هم‌زمان ثبت شده است؛ صفحه را بروزرسانی کنید." });
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.patch(
  "/api/platform/faculties/:id/admins/:userId",
  requirePlatform("operator"),
  validate(
    z
      .object({
        level: z.enum(facultyAdminLevels).optional(),
        isActive: z.boolean().optional(),
      })
      .refine((body) => body.level !== undefined || body.isActive !== undefined, {
        message: "هیچ تغییری ارسال نشده است.",
      }),
  ),
  asyncRoute(async (req, res) => {
    const faculty = await loadFacultyForPlatform(pool, req.params.id);
    if (!faculty)
      return res.status(404).json({ message: "دانشکده یافت نشد." });
    const { rows } = await pool.query(
      `SELECT id, display_name AS "fullName", email, is_active AS "isActive",
              COALESCE(admin_level, 'owner') AS "level"
         FROM users
        WHERE id = $1 AND organization_id = $2 AND role = 'admin'`,
      [req.params.userId, faculty.id],
    );
    const target = rows[0];
    if (!target)
      return res.status(404).json({ message: "مدیر دانشکده یافت نشد." });

    const nextLevel = req.body.level ?? target.level;
    const nextActive = req.body.isActive ?? target.isActive;
    const losingOwner =
      target.level === "owner" && (nextLevel !== "owner" || nextActive === false);
    if (losingOwner) {
      const { rows: owners } = await pool.query(
        `SELECT count(*)::int AS count FROM users
          WHERE organization_id = $1 AND role = 'admin' AND is_active = true
            AND COALESCE(admin_level, 'owner') = 'owner'`,
        [faculty.id],
      );
      if (owners[0].count <= 1)
        return res.status(409).json({
          message: "دانشکده باید حداقل یک مدیر ارشد فعال داشته باشد.",
        });
    }

    const updated = await pool.query(
      `UPDATE users
          SET admin_level = $3, is_active = $4, updated_at = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING id, display_name AS "fullName", email, is_active AS "isActive",
                  admin_level AS "level"`,
      [target.id, faculty.id, nextLevel, nextActive],
    );
    if (!nextActive) {
      await pool.query(
        `UPDATE admin_impersonations
            SET ended_at = now(), ended_reason = 'admin_deactivated'
          WHERE organization_id = $1 AND platform_user_id = $2 AND ended_at IS NULL`,
        [faculty.id, target.id],
      );
    }
    await audit(
      pool,
      faculty.id,
      req.user.sub,
      "platform.faculty.admin.update",
      "admin",
      target.id,
      { level: nextLevel, isActive: nextActive, scope: "platform" },
    );
    res.json({ admin: updated.rows[0] });
  }),
);

app.post(
  "/api/platform/faculties/:id/admins/:userId/reset-password",
  requirePlatform("operator"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, email FROM users
        WHERE id = $1 AND organization_id = $2 AND role = 'admin'`,
      [req.params.userId, req.params.id],
    );
    const target = rows[0];
    if (!target)
      return res.status(404).json({ message: "مدیر دانشکده یافت نشد." });
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await pool.query(
      `UPDATE users
          SET password_hash = $2, must_change_password = true,
              password_last_changed = now(), failed_login_attempts = 0,
              account_locked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [target.id, passwordHash],
    );
    await pool.query(
      `INSERT INTO password_history (user_id, password_hash, created_at)
       VALUES ($1,$2,now())`,
      [target.id, passwordHash],
    );
    await audit(
      pool,
      req.params.id,
      req.user.sub,
      "platform.faculty.admin.reset_password",
      "admin",
      target.id,
      { scope: "platform" },
    );
    res.json({ username: target.email, temporaryPassword });
  }),
);

app.post(
  "/api/platform/faculties/:id/enter",
  requirePlatform("operator"),
  validate(
    z.object({
      reason: z.string().trim().min(5, "دلیل ورود باید حداقل ۵ کاراکتر باشد.").max(500),
    }),
  ),
  asyncRoute(async (req, res) => {
    const faculty = await loadFacultyForPlatform(pool, req.params.id);
    if (!faculty)
      return res.status(404).json({ message: "دانشکده یافت نشد." });
    if (!faculty.isActive || faculty.archivedAt)
      return res
        .status(409)
        .json({ message: "این دانشکده غیرفعال یا آرشیو شده است." });

    const { rows: meRows } = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND is_active = true",
      [req.user.sub],
    );
    const platformUser = meRows[0];
    if (!platformUser)
      return res.status(401).json({ message: "حساب مدیر سامانه معتبر نیست." });

    const { rows: sessionRows } = await pool.query(
      `INSERT INTO admin_impersonations
         (platform_user_id, organization_id, reason, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))
       RETURNING id, expires_at AS "expiresAt"`,
      [platformUser.id, faculty.id, req.body.reason, IMPERSONATION_TTL_MINUTES],
    );
    const session = sessionRows[0];

    await audit(
      pool,
      faculty.id,
      platformUser.id,
      "platform.impersonation.start",
      "faculty",
      faculty.id,
      { reason: req.body.reason, sessionId: session.id, scope: "platform" },
    );
    try {
      const admins = await adminUserIds(faculty.id);
      await notifyUsers(faculty.id, admins, {
        type: "system",
        title: "ورود مدیر سامانه",
        message: `مدیر سامانه با دسترسی مدیر وارد پنل «${faculty.name}» شد. دلیل: ${req.body.reason}`,
        link: "dashboard",
      });
    } catch (notifyError) {
      console.warn("[platform] impersonation notification failed:", notifyError.message);
    }

    res.status(201).json({
      token: tokenForImpersonation(platformUser, faculty.id, session.id),
      user: {
        ...publicUser(platformUser),
        faculty: { id: faculty.id, name: faculty.name, code: faculty.code },
        faculties: [{ id: faculty.id, name: faculty.name, code: faculty.code }],
        impersonated: true,
        impersonation: {
          sid: session.id,
          facultyId: faculty.id,
          facultyName: faculty.name,
          expiresAt: session.expiresAt,
          reason: req.body.reason,
        },
      },
      impersonation: {
        sid: session.id,
        facultyId: faculty.id,
        facultyName: faculty.name,
        expiresAt: session.expiresAt,
        reason: req.body.reason,
      },
    });
  }),
);

app.get(
  "/api/platform/impersonations",
  requirePlatform("auditor"),
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT i.id, i.reason, i.started_at AS "startedAt", i.expires_at AS "expiresAt",
              o.id AS "facultyId", o.name AS "facultyName",
              u.id AS "platformUserId", u.display_name AS "platformName"
         FROM admin_impersonations i
         JOIN organizations o ON o.id = i.organization_id
         JOIN users u ON u.id = i.platform_user_id
        WHERE i.ended_at IS NULL AND i.expires_at > now()
        ORDER BY i.started_at DESC`,
    );
    res.json({ sessions: rows });
  }),
);

app.delete(
  "/api/platform/impersonations/:sid",
  requirePlatform("operator"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE admin_impersonations
          SET ended_at = now(), ended_by = $2, ended_reason = 'revoked'
        WHERE id = $1 AND ended_at IS NULL
        RETURNING organization_id`,
      [req.params.sid, req.user.sub],
    );
    if (!rows[0])
      return res.status(404).json({ message: "نشست فعال یافت نشد." });
    await audit(
      pool,
      rows[0].organization_id,
      req.user.sub,
      "platform.impersonation.revoke",
      "faculty",
      rows[0].organization_id,
      { sessionId: req.params.sid, scope: "platform" },
    );
    res.json({ ok: true });
  }),
);

app.get(
  "/api/platform/admins",
  requirePlatform("auditor"),
  asyncRoute(async (_req, res) => {
    const platform = await platformOrganization();
    if (!platform) return res.json({ admins: [] });
    const { rows } = await pool.query(
      `SELECT u.id, u.display_name AS "fullName", u.email,
              u.platform_level AS "level", u.is_active AS "isActive",
              u.must_change_password AS "mustChangePassword",
              u.created_at AS "createdAt",
              (SELECT max(lh.login_time) FROM login_history lh
                WHERE lh.user_id = u.id AND lh.successful = true) AS "lastLoginAt"
         FROM users u
        WHERE u.organization_id = $1 AND u.platform_level IS NOT NULL
        ORDER BY u.created_at`,
      [platform.id],
    );
    res.json({ admins: rows });
  }),
);

app.post(
  "/api/platform/admins",
  requirePlatform("owner"),
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(254),
      level: z.enum(platformLevels).default("operator"),
    }),
  ),
  asyncRoute(async (req, res) => {
    const platform = await platformOrganization();
    if (!platform)
      return res.status(500).json({ message: "سازمان پنل سامانه یافت نشد." });
    const { fullName, email, level } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (await staffEmailTaken(client, email)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "این ایمیل قبلاً برای حساب دیگری در سامانه ثبت شده است.",
        });
      }
      const account = await createAdminAccount(client, {
        organizationId: platform.id,
        fullName,
        email,
        level: "owner",
        platformLevel: level,
        createdBy: req.user.sub,
      });
      await audit(
        client,
        platform.id,
        req.user.sub,
        "platform.admin.create",
        "platform_admin",
        account.id,
        { email, level, scope: "platform" },
      );
      await client.query("COMMIT");
      res.status(201).json({
        admin: {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          level: account.platformLevel,
          isActive: true,
        },
        account: {
          username: account.email,
          temporaryPassword: account.temporaryPassword,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return res
          .status(409)
          .json({ message: "این ایمیل هم‌زمان ثبت شده است؛ صفحه را بروزرسانی کنید." });
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.patch(
  "/api/platform/admins/:userId",
  requirePlatform("owner"),
  validate(
    z
      .object({
        level: z.enum(platformLevels).optional(),
        isActive: z.boolean().optional(),
      })
      .refine((body) => body.level !== undefined || body.isActive !== undefined, {
        message: "هیچ تغییری ارسال نشده است.",
      }),
  ),
  asyncRoute(async (req, res) => {
    const platform = await platformOrganization();
    const { rows } = await pool.query(
      `SELECT id, email, platform_level AS "level", is_active AS "isActive"
         FROM users
        WHERE id = $1 AND organization_id = $2 AND platform_level IS NOT NULL`,
      [req.params.userId, platform?.id],
    );
    const target = rows[0];
    if (!target)
      return res.status(404).json({ message: "مدیر سامانه یافت نشد." });
    if (target.id === req.user.sub && req.body.isActive === false)
      return res
        .status(400)
        .json({ message: "امکان غیرفعال‌سازی حساب خودتان وجود ندارد." });

    const nextLevel = req.body.level ?? target.level;
    const nextActive = req.body.isActive ?? target.isActive;
    if (target.level === "owner" && (nextLevel !== "owner" || !nextActive)) {
      const { rows: owners } = await pool.query(
        `SELECT count(*)::int AS count FROM users
          WHERE organization_id = $1 AND platform_level = 'owner' AND is_active = true`,
        [platform.id],
      );
      if (owners[0].count <= 1)
        return res.status(409).json({
          message: "سامانه باید حداقل یک مدیر ارشد فعال داشته باشد.",
        });
    }
    const updated = await pool.query(
      `UPDATE users
          SET platform_level = $2, is_active = $3, updated_at = now()
        WHERE id = $1 AND platform_level IS NOT NULL
        RETURNING id, display_name AS "fullName", email,
                  platform_level AS "level", is_active AS "isActive"`,
      [target.id, nextLevel, nextActive],
    );
    await audit(
      pool,
      platform.id,
      req.user.sub,
      "platform.admin.update",
      "platform_admin",
      target.id,
      { level: nextLevel, isActive: nextActive, scope: "platform" },
    );
    res.json({ admin: updated.rows[0] });
  }),
);

app.post(
  "/api/platform/admins/:userId/reset-password",
  requirePlatform("owner"),
  asyncRoute(async (req, res) => {
    const platform = await platformOrganization();
    const { rows } = await pool.query(
      `SELECT id, email FROM users
        WHERE id = $1 AND organization_id = $2 AND platform_level IS NOT NULL`,
      [req.params.userId, platform?.id],
    );
    const target = rows[0];
    if (!target)
      return res.status(404).json({ message: "مدیر سامانه یافت نشد." });
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await pool.query(
      `UPDATE users
          SET password_hash = $2, must_change_password = true,
              password_last_changed = now(), failed_login_attempts = 0,
              account_locked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [target.id, passwordHash],
    );
    await pool.query(
      `INSERT INTO password_history (user_id, password_hash, created_at)
       VALUES ($1,$2,now())`,
      [target.id, passwordHash],
    );
    await audit(
      pool,
      platform.id,
      req.user.sub,
      "platform.admin.reset_password",
      "platform_admin",
      target.id,
      { scope: "platform" },
    );
    res.json({ username: target.email, temporaryPassword });
  }),
);

app.get(
  "/api/platform/audit",
  requirePlatform("auditor"),
  validate(
    z.object({
      organizationId: id.optional(),
      action: z.string().trim().max(80).optional(),
      actorId: id.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    "query",
  ),
  asyncRoute(async (req, res) => {
    const { organizationId, action, actorId, limit, offset } = req.query;
    const params = [];
    const conditions = ["o.kind = 'faculty'"];
    if (organizationId) {
      params.push(organizationId);
      conditions.push(`al.organization_id = $${params.length}`);
    }
    if (action) {
      params.push(`%${action}%`);
      conditions.push(`al.action ILIKE $${params.length}`);
    }
    if (actorId) {
      params.push(actorId);
      conditions.push(`al.actor_id = $${params.length}`);
    }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT al.id, al.action, al.entity_type AS "entityType", al.entity_id AS "entityId",
              al.metadata, al.created_at AS "createdAt",
              o.id AS "organizationId", o.name AS "organizationName",
              u.id AS "actorId", u.display_name AS "actorName", u.email AS "actorEmail",
              (u.platform_level IS NOT NULL) AS "platformActor"
         FROM audit_logs al
         JOIN organizations o ON o.id = al.organization_id
         LEFT JOIN users u ON u.id = al.actor_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY al.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ items: rows });
  }),
);

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
      await audit(client, req.user.org, req.user.sub, "approve", "registration", r.id, {
        fullName: r.full_name,
        username: r.username,
      });
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
    await audit(pool, req.user.org, req.user.sub, "reject", "registration", req.params.id, {});
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

app.post(
  "/api/auth/change-password",
  validate(
    z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z
        .string()
        .min(8, "رمز عبور جدید باید حداقل ۸ کاراکتر باشد.")
        .max(128),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND is_active = true",
      [req.user.sub],
    );
    const user = rows[0];
    if (!user)
      return res.status(401).json({ message: "ورود به سامانه لازم است." });
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid)
      return res.status(400).json({ message: "رمز عبور فعلی درست نیست." });
    const reused = await bcrypt.compare(newPassword, user.password_hash);
    if (reused)
      return res
        .status(400)
        .json({ message: "رمز عبور جدید باید با رمز فعلی متفاوت باشد." });

    // Prevent reuse of the last N passwords for this account.
    const historyLimit = Number(process.env.PASSWORD_HISTORY_LIMIT || 5);
    const { rows: history } = await pool.query(
      "SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [user.id, historyLimit],
    );
    for (const entry of history) {
      const matches = await bcrypt.compare(newPassword, entry.password_hash);
      if (matches) {
        return res
          .status(400)
          .json({ message: "رمز عبور جدید نباید با رمزهای قبلی یکسان باشد." });
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await pool.query(
      `UPDATE users
          SET password_hash = $1,
              must_change_password = false,
              password_last_changed = now(),
              updated_at = now()
        WHERE id = $2
        RETURNING *`,
      [passwordHash, user.id],
    );
    await pool.query(
      "INSERT INTO password_history (user_id, password_hash, created_at) VALUES ($1, $2, now())",
      [user.id, passwordHash],
    );
    res.json({
      ok: true,
      user: { ...publicUser(updated.rows[0]), ...staffFields(updated.rows[0]) },
    });
  }),
);

app.get(
  "/api/auth/login-history",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, ip_address, user_agent, login_time, successful
         FROM login_history
        WHERE user_id = $1
        ORDER BY login_time DESC
        LIMIT 20`,
      [req.user.sub],
    );
    res.json({ history: rows });
  }),
);

// Admin activity feed: who did what, scoped to the current faculty. Uses the
// existing audit_logs table (courses, sessions, attendance, teacher
// management, registration review, ...).
app.get(
  "/api/admin/activity",
  authorize("admin"),
  validate(
    z.object({
      entityType: z.string().trim().min(1).max(60).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
    "query",
  ),
  asyncRoute(async (req, res) => {
    const { entityType, limit } = req.query;
    const params = [req.user.org];
    let where = "al.organization_id = $1";
    if (entityType) {
      params.push(entityType);
      where += ` AND al.entity_type = $${params.length}`;
    }
    params.push(limit ?? 100);
    const { rows } = await pool.query(
      `SELECT al.id, al.action, al.entity_type AS "entityType", al.entity_id AS "entityId",
              al.metadata, al.created_at AS "createdAt",
              au.display_name AS "actorName", au.email AS "actorEmail"
         FROM audit_logs al
         LEFT JOIN users au ON au.id = al.actor_id
        WHERE ${where}
        ORDER BY al.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    res.json({ activity: rows });
  }),
);

app.get(
  "/api/teachers",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id,
              u.display_name AS "fullName",
              u.email,
              u.is_active AS "isActive",
              (u.organization_id = $1) AS "isHome",
              (SELECT count(*)::int
                 FROM user_faculties uf2
                WHERE uf2.user_id = u.id AND uf2.organization_id <> $1) AS "otherFaculties",
              u.created_at AS "createdAt",
              uf.created_at AS "addedAt",
              au.display_name AS "addedByName",
              au.email AS "addedByEmail"
         FROM users u
         LEFT JOIN user_faculties uf
                ON uf.user_id = u.id AND uf.organization_id = $1
         LEFT JOIN users au ON au.id = uf.added_by
        WHERE u.role = 'teacher'
          AND (u.organization_id = $1 OR EXISTS (
                SELECT 1 FROM user_faculties uf3
                 WHERE uf3.user_id = u.id AND uf3.organization_id = $1))
        ORDER BY (u.organization_id = $1) DESC, u.display_name`,
      [req.user.org],
    );
    res.json(rows);
  }),
);

app.get(
  "/api/teachers/lookup",
  authorize("admin"),
  validate(
    z.object({ email: z.string().trim().email().max(254) }),
    "query",
  ),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id,
              u.display_name AS "fullName",
              u.email,
              u.is_active AS "isActive",
              (u.organization_id = $2) AS "isHome",
              EXISTS (
                SELECT 1 FROM user_faculties uf
                 WHERE uf.user_id = u.id AND uf.organization_id = $2
              ) AS "isMember",
              o.name AS "homeFaculty"
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower($1) AND u.role = 'teacher'
        ORDER BY u.created_at
        LIMIT 1`,
      [req.query.email, req.user.org],
    );
    res.json({ teacher: rows[0] || null });
  }),
);

app.post(
  "/api/teachers",
  authorize("admin"),
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(254),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { fullName, email } = req.body;
    const existing = await pool.query(
      "SELECT role FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [email],
    );
    if (existing.rows[0]) {
      return res.status(409).json({
        message:
          existing.rows[0].role === "teacher"
            ? "این ایمیل قبلاً برای یک استاد ثبت شده است؛ از «افزودن استاد موجود» استفاده کنید."
            : "این ایمیل قبلاً برای حساب دیگری در سامانه ثبت شده است.",
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, display_name, role, is_active, must_change_password)
         VALUES ($1,$2,$3,$4,'teacher',true,true)
         RETURNING id, display_name AS "fullName", email, is_active AS "isActive", created_at AS "createdAt"`,
        [req.user.org, email, passwordHash, fullName],
      );
      await client.query(
        `INSERT INTO user_faculties (user_id, organization_id, added_by)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [created.rows[0].id, req.user.org, req.user.sub],
      );
      await client.query(
        `INSERT INTO password_history (user_id, password_hash, created_at)
         VALUES ($1, $2, now())`,
        [created.rows[0].id, passwordHash],
      );
      await audit(client, req.user.org, req.user.sub, "create", "teacher", created.rows[0].id, {
        email,
        fullName,
      });
      await client.query("COMMIT");
      try {
        const faculty = await loadFaculty(req.user.org);
        await notifyUsers(req.user.org, [created.rows[0].id], {
          type: "membership",
          title: "عضویت در دانشکده",
          message: `حساب شما با نقش «استاد» در دانشکدهٔ «${faculty?.name ?? ""}» فعال شد.`,
          link: "dashboard",
        });
      } catch (notifyError) {
        console.warn("[teachers] welcome notification failed:", notifyError.message);
      }
      res.status(201).json({
        teacher: {
          ...created.rows[0],
          isHome: true,
          otherFaculties: 0,
        },
        temporaryPassword,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({
          message: "این ایمیل هم‌زمان توسط مدیر دیگری ثبت شده است؛ صفحه را بروزرسانی کنید.",
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/api/teachers/add-existing",
  authorize("admin"),
  validate(z.object({ email: z.string().trim().email().max(254) })),
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, display_name AS "fullName", email, organization_id, is_active
         FROM users
        WHERE lower(email) = lower($1) AND role = 'teacher'
        ORDER BY created_at
        LIMIT 1`,
      [req.body.email],
    );
    const teacher = rows[0];
    if (!teacher)
      return res.status(404).json({
        message: "استادی با این ایمیل یافت نشد؛ از گزینهٔ «استاد جدید» استفاده کنید.",
      });
    if (!teacher.is_active)
      return res.status(409).json({ message: "حساب این استاد غیرفعال است." });
    if (teacher.organization_id === req.user.org)
      return res.status(409).json({ message: "این استاد از قبل در دانشکدهٔ شماست." });

    const inserted = await pool.query(
      `INSERT INTO user_faculties (user_id, organization_id, added_by)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [teacher.id, req.user.org, req.user.sub],
    );
    if (!inserted.rowCount)
      return res
        .status(409)
        .json({ message: "این استاد از قبل عضو این دانشکده است." });

    await audit(pool, req.user.org, req.user.sub, "attach", "teacher", teacher.id, {
      email: teacher.email,
      fullName: teacher.fullName,
    });
    try {
      const faculty = await loadFaculty(req.user.org);
      await notifyUsers(req.user.org, [teacher.id], {
        type: "membership",
        title: "عضویت در دانشکدهٔ جدید",
        message: `شما به‌عنوان استاد به دانشکدهٔ «${faculty?.name ?? ""}» افزوده شدید.`,
        link: "dashboard",
      });
    } catch (notifyError) {
      console.warn("[teachers] membership notification failed:", notifyError.message);
    }

    res.status(201).json({
      teacher: {
        id: teacher.id,
        fullName: teacher.fullName,
        email: teacher.email,
        isActive: true,
        isHome: false,
        otherFaculties: 0,
      },
    });
  }),
);

app.post(
  "/api/teachers/:userId/reset-password",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const parsed = id.safeParse(req.params.userId);
    if (!parsed.success)
      return res.status(400).json({ message: "شناسهٔ استاد معتبر نیست." });
    const { rows } = await pool.query(
      `SELECT id, display_name AS "fullName", email, organization_id, is_active
         FROM users
        WHERE id = $1 AND role = 'teacher'`,
      [parsed.data],
    );
    const teacher = rows[0];
    if (!teacher)
      return res.status(404).json({ message: "استاد یافت نشد." });
    if (teacher.organization_id !== req.user.org)
      return res.status(409).json({
        message:
          "فقط مدیر دانشکدهٔ اصلی استاد می‌تواند رمز عبور او را بازنشانی کند.",
      });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const passwordResult = await pool.query(
      `INSERT INTO password_history (user_id, password_hash, created_at)
        VALUES ($1, $2, now())`,
      [teacher.id, passwordHash],
    );
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = true, password_last_changed = now() WHERE id = $2`,
      [passwordHash, teacher.id],
    );
    await audit(pool, req.user.org, req.user.sub, "reset_password", "teacher", teacher.id, {
      email: teacher.email,
      fullName: teacher.fullName,
    });
    const emailResult = await sendPasswordEmail(
      teacher.email,
      temporaryPassword,
      teacher.fullName,
    );
    if (!emailResult.ok) {
      console.warn("[reset-password] email failed, password reset applied:", emailResult.error);
    }
    res.status(200).json({
      teacher: {
        id: teacher.id,
        fullName: teacher.fullName,
        email: teacher.email,
        isActive: true,
      },
      temporaryPassword,
      message: "رمز موقت برای این استاد ارسال شد و باید تغییر رمز شود.",
    });
  }),
);

app.delete(
  "/api/teachers/:userId",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    const parsed = id.safeParse(req.params.userId);
    if (!parsed.success)
      return res.status(400).json({ message: "شناسهٔ استاد معتبر نیست." });
    const { rows } = await pool.query(
      "SELECT id, organization_id FROM users WHERE id = $1 AND role = 'teacher'",
      [parsed.data],
    );
    const teacher = rows[0];
    if (!teacher)
      return res.status(404).json({ message: "استاد یافت نشد." });
    if (teacher.organization_id === req.user.org)
      return res.status(409).json({
        message:
          "این استاد دانشکدهٔ اصلی شماست و حذف عضویت آن مجاز نیست؛ در صورت نیاز حساب را غیرفعال کنید.",
      });

    const removed = await pool.query(
      `DELETE FROM user_faculties
        WHERE user_id = $1 AND organization_id = $2`,
      [teacher.id, req.user.org],
    );
    if (!removed.rowCount)
      return res
        .status(404)
        .json({ message: "این استاد عضو دانشکدهٔ شما نیست." });
    await audit(pool, req.user.org, req.user.sub, "detach", "teacher", teacher.id, {});
    res.status(204).end();
  }),
);

app.patch(
  "/api/teachers/:userId/status",
  authorize("admin"),
  validate(z.object({ isActive: z.boolean() })),
  asyncRoute(async (req, res) => {
    const parsed = id.safeParse(req.params.userId);
    if (!parsed.success)
      return res.status(400).json({ message: "شناسهٔ استاد معتبر نیست." });
    const { rows } = await pool.query(
      "SELECT id, organization_id FROM users WHERE id = $1 AND role = 'teacher'",
      [parsed.data],
    );
    const teacher = rows[0];
    if (!teacher)
      return res.status(404).json({ message: "استاد یافت نشد." });
    if (teacher.organization_id !== req.user.org)
      return res.status(403).json({
        message:
          "فقط مدیر دانشکدهٔ اصلی استاد می‌تواند وضعیت حساب او را تغییر دهد.",
      });

    if (!req.body.isActive) {
      const others = await pool.query(
        `SELECT count(*)::int AS count
           FROM user_faculties
          WHERE user_id = $1 AND organization_id <> $2`,
        [teacher.id, req.user.org],
      );
      if (others.rows[0].count > 0)
        return res.status(409).json({
          message:
            "این استاد در دانشکده‌های دیگر عضو است؛ ابتدا عضویت‌های دیگر حذف شوند.",
        });
    }

    await pool.query(
      "UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2",
      [req.body.isActive, teacher.id],
    );
    await audit(
      pool,
      req.user.org,
      req.user.sub,
      req.body.isActive ? "activate" : "deactivate",
      "teacher",
      teacher.id,
      {},
    );
    res.json({ ok: true, isActive: req.body.isActive });
  }),
);

/* ---------------------------------------------------------------------------
 * Faculty staff and their access level (dean only).
 * The permission middleware already restricts these routes to `staff.manage`,
 * which only the dean holds; the extra check below keeps that guarantee local
 * to the handlers as well.
 * ------------------------------------------------------------------------ */
const staffRoleEnum = z.enum(STAFF_ROLES);

function requireDean(req, res) {
  if (normalizeStaffRole(req.user.adminLevel) !== "owner") {
    res.status(403).json({
      message: "تعیین سطح دسترسی کارمندان فقط برای مدیر دانشکده مجاز است.",
    });
    return false;
  }
  return true;
}

async function countActiveDeans(organizationId, exceptUserId = null) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM users
      WHERE organization_id = $1 AND role = 'admin' AND is_active = true
        AND platform_level IS NULL
        AND COALESCE(admin_level, 'owner') = 'owner'
        AND ($2::uuid IS NULL OR id <> $2)`,
    [organizationId, exceptUserId],
  );
  return rows[0]?.count || 0;
}

async function loadStaffMember(organizationId, userId) {
  const { rows } = await pool.query(
    `SELECT id, display_name AS "fullName", email, is_active AS "isActive",
            COALESCE(admin_level, 'owner') AS "level",
            must_change_password AS "mustChangePassword",
            created_at AS "createdAt",
            (SELECT max(lh.login_time) FROM login_history lh
              WHERE lh.user_id = users.id AND lh.successful = true) AS "lastLoginAt"
       FROM users
      WHERE id = $1 AND organization_id = $2 AND role = 'admin'
        AND platform_level IS NULL`,
    [userId, organizationId],
  );
  return rows[0] || null;
}

app.get(
  "/api/staff",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    if (!requireDean(req, res)) return;
    const { rows } = await pool.query(
      `SELECT id, display_name AS "fullName", email, is_active AS "isActive",
              COALESCE(admin_level, 'owner') AS "level",
              must_change_password AS "mustChangePassword",
              created_at AS "createdAt",
              (SELECT max(lh.login_time) FROM login_history lh
                WHERE lh.user_id = users.id AND lh.successful = true) AS "lastLoginAt"
         FROM users
        WHERE organization_id = $1 AND role = 'admin' AND platform_level IS NULL
        ORDER BY (COALESCE(admin_level, 'owner') <> 'owner'), created_at`,
      [req.user.org],
    );
    res.json({
      staff: rows.map((row) => ({
        ...row,
        roleLabel: STAFF_ROLE_LABELS[normalizeStaffRole(row.level)],
        isSelf: row.id === req.user.sub,
      })),
      roles: STAFF_ROLES.map((value) => ({ value, label: STAFF_ROLE_LABELS[value] })),
    });
  }),
);

app.post(
  "/api/staff",
  authorize("admin"),
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(254),
      level: staffRoleEnum.default("operator"),
    }),
  ),
  asyncRoute(async (req, res) => {
    if (!requireDean(req, res)) return;
    const { fullName, email, level } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (await staffEmailTaken(client, email)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "این ایمیل قبلاً برای حساب دیگری در سامانه ثبت شده است.",
        });
      }
      const account = await createAdminAccount(client, {
        organizationId: req.user.org,
        fullName,
        email,
        level,
        createdBy: req.user.sub,
      });
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "staff.create",
        "admin",
        account.id,
        { email, level },
      );
      await client.query("COMMIT");
      const faculty = await loadFaculty(req.user.org);
      try {
        await notifyUsers(req.user.org, [account.id], {
          type: "system",
          title: "سطح دسترسی در دانشکده",
          message: `حساب شما با نقش «${STAFF_ROLE_LABELS[level]}» در دانشکدهٔ «${faculty?.name || ""}» ساخته شد.`,
          link: "dashboard",
        });
      } catch (notifyError) {
        console.warn("[staff] notification failed:", notifyError.message);
      }
      sendPasswordEmail(account.email, account.temporaryPassword, fullName)
        .then((sent) => {
          if (!sent?.ok)
            console.warn("[staff] password email failed:", sent?.error);
        })
        .catch((mailError) =>
          console.warn("[staff] password email failed:", mailError.message),
        );
      res.status(201).json({
        staff: {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          level,
          roleLabel: STAFF_ROLE_LABELS[level],
          isActive: true,
        },
        account: {
          username: account.email,
          temporaryPassword: account.temporaryPassword,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return res.status(409).json({
          message: "این ایمیل هم‌زمان ثبت شده است؛ صفحه را بروزرسانی کنید.",
        });
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.patch(
  "/api/staff/:userId",
  authorize("admin"),
  validate(
    z
      .object({
        level: staffRoleEnum.optional(),
        isActive: z.boolean().optional(),
      })
      .refine((body) => body.level !== undefined || body.isActive !== undefined, {
        message: "هیچ تغییری ارسال نشده است.",
      }),
  ),
  asyncRoute(async (req, res) => {
    if (!requireDean(req, res)) return;
    const parsed = id.safeParse(req.params.userId);
    if (!parsed.success)
      return res.status(400).json({ message: "شناسهٔ کارمند معتبر نیست." });
    const target = await loadStaffMember(req.user.org, parsed.data);
    if (!target)
      return res.status(404).json({ message: "کارمند یافت نشد." });
    if (target.id === req.user.sub && req.body.isActive === false)
      return res.status(409).json({
        message: "غیرفعال‌کردن حساب خودتان مجاز نیست.",
      });

    const nextLevel = normalizeStaffRole(req.body.level ?? target.level);
    const nextActive = req.body.isActive ?? target.isActive;
    const losingDean =
      normalizeStaffRole(target.level) === "owner" &&
      (nextLevel !== "owner" || nextActive === false);
    if (losingDean && (await countActiveDeans(req.user.org, target.id)) === 0)
      return res.status(409).json({
        message: "دانشکده باید حداقل یک مدیر دانشکدهٔ فعال داشته باشد.",
      });

    const { rows } = await pool.query(
      `UPDATE users
          SET admin_level = $3, is_active = $4, updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND role = 'admin'
          AND platform_level IS NULL
        RETURNING id, display_name AS "fullName", email, is_active AS "isActive",
                  COALESCE(admin_level, 'owner') AS "level"`,
      [target.id, req.user.org, nextLevel, nextActive],
    );
    await audit(
      pool,
      req.user.org,
      req.user.sub,
      "staff.update",
      "admin",
      target.id,
      { level: nextLevel, isActive: nextActive },
    );
    res.json({
      staff: {
        ...rows[0],
        roleLabel: STAFF_ROLE_LABELS[nextLevel],
        isSelf: target.id === req.user.sub,
      },
    });
  }),
);

app.post(
  "/api/staff/:userId/reset-password",
  authorize("admin"),
  asyncRoute(async (req, res) => {
    if (!requireDean(req, res)) return;
    const parsed = id.safeParse(req.params.userId);
    if (!parsed.success)
      return res.status(400).json({ message: "شناسهٔ کارمند معتبر نیست." });
    const target = await loadStaffMember(req.user.org, parsed.data);
    if (!target) return res.status(404).json({ message: "کارمند یافت نشد." });
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await pool.query(
      `UPDATE users
          SET password_hash = $2, must_change_password = true,
              password_last_changed = now(), failed_login_attempts = 0,
              account_locked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [target.id, passwordHash],
    );
    await pool.query(
      `INSERT INTO password_history (user_id, password_hash, created_at)
       VALUES ($1,$2,now())`,
      [target.id, passwordHash],
    );
    await audit(
      pool,
      req.user.org,
      req.user.sub,
      "staff.reset_password",
      "admin",
      target.id,
      {},
    );
    sendPasswordEmail(target.email, temporaryPassword, target.fullName)
      .then((sent) => {
        if (!sent?.ok)
          console.warn("[staff] password email failed:", sent?.error);
      })
      .catch((mailError) =>
        console.warn("[staff] password email failed:", mailError.message),
      );
    res.json({ username: target.email, temporaryPassword });
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
    res.json({ user: { ...publicUser(rows[0]), ...staffFields(rows[0]), faculty, faculties } });
  }),
);
app.get(
  "/api/bootstrap",
  asyncRoute(async (req, res) => {
    const params = [req.user.org];
    const teacher = req.user.role === "teacher";
    if (teacher) params.push(req.user.sub);
    // Teachers only receive their own courses, sessions, attendance and the
    // students enrolled in them. Admins keep the whole faculty.
    const courseScope = teacher ? " AND c.teacher_user_id=$2" : "";
    const sessionScope = teacher
      ? " AND s.course_id IN (SELECT id FROM courses WHERE organization_id=$1 AND teacher_user_id=$2)"
      : "";
    const studentScope = teacher
      ? ` AND st.id IN (
            SELECT cs.student_id
              FROM course_students cs
              JOIN courses c ON c.id = cs.course_id
             WHERE c.organization_id = $1 AND c.teacher_user_id = $2
            UNION
            SELECT ss.student_id
              FROM session_students ss
              JOIN class_sessions s ON s.id = ss.session_id
              JOIN courses c ON c.id = s.course_id
             WHERE s.organization_id = $1 AND c.teacher_user_id = $2
          )`
      : "";
    const staffCan = (permission) =>
      req.user.role !== "admin" ||
      staffRoleAllows(req.user.adminLevel, permission);
    const [students, courses, sessions, attendance, settings, faceImages, voiceSamples] =
      await Promise.all([
        pool.query(
          `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS "fullName", st.major, st.term, st.phone, st.status,
                  ${STUDENT_HAS_ACCOUNT_SQL} AS "hasAccount"
             FROM students st WHERE st.organization_id=$1${studentScope} ORDER BY st.full_name`,
          params,
        ),
        pool.query(
          `SELECT c.id, c.code, c.title, c.teacher_name AS "teacherName", c.teacher_user_id AS "teacherUserId", c.room, c.weekday, to_char(c.start_time,'HH24:MI') AS "startTime", to_char(c.end_time,'HH24:MI') AS "endTime", COALESCE(array_agg(cs.student_id) FILTER (WHERE cs.student_id IS NOT NULL), '{}') AS "studentIds" FROM courses c LEFT JOIN course_students cs ON cs.course_id=c.id WHERE c.organization_id=$1${courseScope} GROUP BY c.id ORDER BY c.title`,
          params,
        ),
        pool.query(
          `SELECT s.id, s.course_id AS "courseId", to_char(s.session_date,'YYYY-MM-DD') AS date, s.teacher_name AS "teacherName", to_char(s.start_time,'HH24:MI') AS "startTime", to_char(s.end_time,'HH24:MI') AS "endTime", s.grace_minutes AS "graceMinutes", s.open_before_minutes AS "openBeforeMinutes", s.close_after_minutes AS "closeAfterMinutes", s.status, s.live_status AS "liveStatus", s.started_at AS "startedAt", s.ended_at AS "endedAt", COALESCE(array_agg(ss.student_id) FILTER (WHERE ss.student_id IS NOT NULL), '{}') AS "studentIds" FROM class_sessions s LEFT JOIN session_students ss ON ss.session_id=s.id WHERE s.organization_id=$1${sessionScope} GROUP BY s.id ORDER BY s.session_date DESC, s.start_time DESC`,
          params,
        ),
        pool.query(
          `SELECT a.id, a.session_id AS "sessionId", a.student_id AS "studentId", a.status, a.method, a.checked_at AS "checkedAt", a.updated_at AS "updatedAt" FROM attendance_records a JOIN class_sessions s ON s.id=a.session_id WHERE s.organization_id=$1${sessionScope}`,
          params,
        ),
        pool.query(
          `SELECT system_name AS "systemName", late_after_minutes AS "lateAfterMinutes", notifications_enabled AS "notificationsEnabled", face_recognition_enabled AS "faceRecognitionEnabled",
                  face_match_distance AS "faceMatchDistance", face_match_margin AS "faceMatchMargin",
                  face_min_frames AS "faceMinFrames", face_liveness_required AS "faceLivenessRequired"
             FROM organization_settings WHERE organization_id=$1`,
          [req.user.org],
        ),
        staffCan("attendance.face.view")
          ? pool.query(
          `SELECT br.id,
                  br.student_id AS "studentId",
                  br.object_key AS "objectKey",
                  br.features AS "descriptor",
                  br.checksum,
                  br.feature_version AS "featureVersion",
                  br.descriptor_model AS "descriptorModel",
                  br.quality,
                  br.created_at AS "createdAt"
             FROM biometric_references br
             JOIN students st ON st.id = br.student_id
            WHERE br.kind='face_image' AND st.organization_id=$1${studentScope}
            ORDER BY br.created_at DESC`,
          params,
            )
          : Promise.resolve({ rows: [] }),
        staffCan("attendance.voice.view")
          ? pool.query(
          `SELECT br.student_id AS "studentId", br.features, br.feature_version AS "featureVersion", br.created_at AS "createdAt"
             FROM biometric_references br
             JOIN students st ON st.id = br.student_id
            WHERE br.kind='voice_sample' AND st.organization_id=$1 AND br.features IS NOT NULL${studentScope}
            ORDER BY br.created_at`,
          params,
            )
          : Promise.resolve({ rows: [] }),
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
    const params = [req.user.org];
    let scope = "";
    if (isTeacher(req)) {
      params.push(req.user.sub);
      scope = ` AND st.id IN (
        SELECT cs.student_id FROM course_students cs
          JOIN courses c ON c.id = cs.course_id
         WHERE c.organization_id = $1 AND c.teacher_user_id = $2
        UNION
        SELECT ss.student_id FROM session_students ss
          JOIN class_sessions s ON s.id = ss.session_id
          JOIN courses c ON c.id = s.course_id
         WHERE s.organization_id = $1 AND c.teacher_user_id = $2
      )`;
    }
    const { rows } = await pool.query(
      `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS "fullName", st.major, st.term, st.phone, st.status,
              ${STUDENT_HAS_ACCOUNT_SQL} AS "hasAccount",
              (SELECT u.email FROM users u
                WHERE u.organization_id = st.organization_id
                  AND u.role = 'student' AND u.is_active = true
                  AND u.student_id IN (st.student_number, st.id::text)
                LIMIT 1) AS "accountEmail"
         FROM students st WHERE st.organization_id=$1${scope} ORDER BY st.full_name`,
      params,
    );
    res.json(rows);
  }),
);
app.post(
  "/api/students",
  authorize("admin", "teacher"),
  validate(
    studentSchema.extend({
      email: z.string().trim().max(254).optional().default(""),
    }),
  ),
  asyncRoute(async (req, res) => {
    const s = req.body;
    const email = String(s.email || "").trim();
    if (email && !z.string().email().safeParse(email).success) {
      return res.status(422).json({ message: "قالب ایمیل دانشجو معتبر نیست." });
    }

    const client = await pool.connect();
    let student;
    let account;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
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
      student = rows[0];
      // Adding a student without a login was the root cause of "the exam never
      // reached the student". Provision the account in the same transaction so
      // a student row can never exist without a way to sign in.
      account = await createStudentAccount(client, {
        organizationId: req.user.org,
        student: {
          id: student.id,
          student_number: s.studentNumber,
          full_name: s.fullName,
        },
        email,
      });
      await audit(client, req.user.org, req.user.sub, "create", "student", student.id, {
        studentNumber: s.studentNumber,
        fullName: s.fullName,
        username: account.username,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({
          message:
            "این شماره دانشجویی یا ایمیل قبلاً ثبت شده است؛ صفحه را به‌روزرسانی کنید.",
        });
      }
      throw error;
    } finally {
      client.release();
    }

    try {
      await notifyUsers(req.user.org, [account.userId], {
        type: "account",
        title: "حساب کاربری شما ساخته شد",
        message:
          "نام کاربری شما شماره دانشجویی‌تان است. با رمز موقتی که استاد یا مدیر به شما داده وارد شوید و آن را تغییر دهید.",
        link: "profile",
      });
    } catch (notifyError) {
      console.warn("[students] welcome notification failed:", notifyError.message);
    }

    res.status(201).json({
      ...student,
      hasAccount: true,
      account: {
        username: account.username,
        email: account.email,
        temporaryPassword: account.temporaryPassword,
        mustChangePassword: true,
      },
    });
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
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE students SET ${assignments.join(", ")}, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING id, student_number AS "studentNumber", full_name AS "fullName", major,term,phone,status`,
        values,
      );
      if (!rows[0]) return null;
      // Keep the login in step with the student record: a renamed student number
      // must still resolve the username, and deactivating a student must lock
      // the account instead of leaving a working login behind.
      if (req.body.studentNumber) {
        await client.query(
          `UPDATE users SET student_id = $1, updated_at = now()
            WHERE organization_id = $2 AND role = 'student' AND student_id = $3`,
          [req.body.studentNumber, req.user.org, req.params.studentId],
        );
      }
      if (req.body.status) {
        await client.query(
          `UPDATE users SET is_active = ($1 = 'active'), updated_at = now()
            WHERE organization_id = $2 AND role = 'student'
              AND student_id IN ($3, $4)`,
          [
            req.body.status,
            req.user.org,
            rows[0].studentNumber,
            req.params.studentId,
          ],
        );
      }
      return rows[0];
    });
    if (!updated) return res.sendStatus(404);
    res.json(updated);
  }),
);

// Create the missing login for an existing student (used to backfill students
// that were added before accounts were provisioned automatically).
app.post(
  "/api/students/:studentId/account",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const studentId = req.params.studentId;
    if (!UUID_RE.test(studentId)) {
      return res.status(400).json({ message: "شناسهٔ دانشجو معتبر نیست." });
    }
    if (
      isTeacher(req) &&
      !(await teacherCanManageStudent(pool, req.user.sub, req.user.org, studentId))
    ) {
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
    }
    const { rows } = await pool.query(
      `SELECT id, student_number, full_name FROM students
        WHERE id = $1 AND organization_id = $2`,
      [studentId, req.user.org],
    );
    const student = rows[0];
    if (!student) return res.status(404).json({ message: "دانشجو پیدا نشد." });

    const existing = await pool.query(
      `SELECT 1 FROM users
        WHERE organization_id = $1 AND role = 'student'
          AND student_id IN ($2, $3)
        LIMIT 1`,
      [req.user.org, student.student_number, student.id],
    );
    if (existing.rowCount) {
      return res
        .status(409)
        .json({ message: "این دانشجو از قبل حساب کاربری دارد." });
    }

    const account = await withTransaction(async (client) => {
      const created = await createStudentAccount(client, {
        organizationId: req.user.org,
        student: { id: student.id, student_number: student.student_number, full_name: student.full_name },
      });
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "provision_account",
        "student",
        student.id,
        { studentNumber: student.student_number, username: created.username },
      );
      return created;
    });

    try {
      await notifyUsers(req.user.org, [account.userId], {
        type: "account",
        title: "حساب کاربری شما ساخته شد",
        message:
          "نام کاربری شما شماره دانشجویی‌تان است. با رمز موقتی که دریافت کرده‌اید وارد شوید و آن را تغییر دهید.",
        link: "profile",
      });
    } catch (notifyError) {
      console.warn("[students] welcome notification failed:", notifyError.message);
    }

    res.status(201).json({
      account: {
        studentId: account.studentId,
        fullName: account.fullName,
        username: account.username,
        email: account.email,
        temporaryPassword: account.temporaryPassword,
        mustChangePassword: true,
      },
    });
  }),
);

// Backfill: create logins for every active student that has none. Credentials
// are returned exactly once so the faculty can print or hand them out.
app.post(
  "/api/students/provision-missing",
  authorize("admin", "teacher"),
  validate(z.object({ courseId: z.string().uuid().optional().nullable() })),
  asyncRoute(async (req, res) => {
    const courseId = req.body.courseId || null;
    const params = [req.user.org];
    const conditions = [
      "st.organization_id = $1",
      "st.status = 'active'",
      `NOT ${STUDENT_HAS_ACCOUNT_SQL}`,
    ];

    if (isTeacher(req)) {
      params.push(req.user.sub);
      conditions.push(`st.id IN (
        SELECT cs.student_id FROM course_students cs
          JOIN courses c ON c.id = cs.course_id
         WHERE c.organization_id = $1 AND c.teacher_user_id = $${params.length})`);
    }

    if (courseId) {
      const owned = await pool.query(
        `SELECT 1 FROM courses
          WHERE id = $1 AND organization_id = $2
            ${isTeacher(req) ? "AND teacher_user_id = $3" : ""}`,
        isTeacher(req)
          ? [courseId, req.user.org, req.user.sub]
          : [courseId, req.user.org],
      );
      if (!owned.rowCount) {
        return res.status(403).json({ message: "این درس به شما تخصیص نیافته است." });
      }
      params.push(courseId);
      conditions.push(
        `st.id IN (SELECT student_id FROM course_students WHERE course_id = $${params.length})`,
      );
    }

    const { rows: missing } = await pool.query(
      `SELECT st.id, st.student_number, st.full_name FROM students st
        WHERE ${conditions.join(" AND ")}
        ORDER BY st.full_name
        LIMIT 500`,
      params,
    );
    if (!missing.length) {
      return res.json({ created: 0, accounts: [] });
    }

    const accounts = await withTransaction(async (client) => {
      const created = [];
      for (const student of missing) {
        created.push(
          await createStudentAccount(client, {
            organizationId: req.user.org,
            student,
          }),
        );
      }
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "provision_accounts",
        "student",
        courseId || req.user.org,
        { count: created.length, courseId },
      );
      return created;
    });

    try {
      await notifyUsers(
        req.user.org,
        accounts.map((account) => account.userId),
        {
          type: "account",
          title: "حساب کاربری شما ساخته شد",
          message:
            "نام کاربری شما شماره دانشجویی‌تان است. با رمز موقتی که دریافت کرده‌اید وارد شوید و آن را تغییر دهید.",
          link: "profile",
        },
      );
    } catch (notifyError) {
      console.warn("[students] bulk welcome notification failed:", notifyError.message);
    }

    res.status(201).json({
      created: accounts.length,
      accounts: accounts.map((account) => ({
        studentId: account.studentId,
        fullName: account.fullName,
        username: account.username,
        email: account.email,
        temporaryPassword: account.temporaryPassword,
      })),
    });
  }),
);

app.post(
  "/api/students/:studentId/reset-password",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const studentId = req.params.studentId;
    if (!UUID_RE.test(studentId)) {
      return res.status(400).json({ message: "شناسهٔ دانشجو معتبر نیست." });
    }
    if (
      isTeacher(req) &&
      !(await teacherCanManageStudent(pool, req.user.sub, req.user.org, studentId))
    ) {
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
    }
    const { rows } = await pool.query(
      `SELECT st.id, st.student_number, st.full_name, u.id AS "userId", u.email
         FROM students st
         JOIN users u ON u.organization_id = st.organization_id
           AND u.role = 'student' AND u.is_active = true
           AND u.student_id IN (st.student_number, st.id::text)
        WHERE st.id = $1 AND st.organization_id = $2
        LIMIT 1`,
      [studentId, req.user.org],
    );
    const student = rows[0];
    if (!student) {
      return res
        .status(404)
        .json({ message: "برای این دانشجو حساب کاربری فعالی پیدا نشد." });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO password_history (user_id, password_hash, created_at)
         VALUES ($1,$2,now())`,
        [student.userId, passwordHash],
      );
      await client.query(
        `UPDATE users
            SET password_hash = $1, must_change_password = true,
                failed_login_attempts = 0, account_locked_until = NULL,
                password_last_changed = now(), updated_at = now()
          WHERE id = $2`,
        [passwordHash, student.userId],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "reset_password",
        "student",
        student.id,
        { studentNumber: student.student_number, username: student.student_number },
      );
    });

    res.json({
      student: {
        id: student.id,
        fullName: student.full_name,
        username: student.student_number,
      },
      temporaryPassword,
    });
  }),
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Multipart fields arrive as strings; a broken descriptor is treated as a
// missing one only when the field is absent entirely.
function readFaceEnrollmentFields(body) {
  const parse = (value) => {
    if (value == null || value === "") return null;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  return {
    descriptor: parse(body?.descriptor),
    quality: parse(body?.quality),
    mode: body?.mode === "replace" ? "replace" : "append",
  };
}

async function addStudentFacePhoto(
  studentId,
  organizationId,
  file,
  { descriptor = null, quality = null, mode = "append" } = {},
) {
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

  try {
    const result = await withTransaction(async (client) => {
      let removed = [];
      if (mode === "replace") {
        const previous = await client.query(
          `DELETE FROM biometric_references
            WHERE student_id = $1 AND kind = 'face_image'
            RETURNING id, object_key`,
          [studentId],
        );
        removed = previous.rows;
      }

      const inserted = await client.query(
        `INSERT INTO biometric_references
           (student_id, kind, object_key, mime_type, checksum,
            features, feature_version, descriptor_model, quality)
         VALUES ($1, 'face_image', $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, student_id AS "studentId",
                   object_key AS "objectKey",
                   mime_type AS "mimeType",
                   features AS "descriptor",
                   feature_version AS "featureVersion",
                   descriptor_model AS "descriptorModel",
                   quality,
                   created_at AS "createdAt"`,
        [
          studentId,
          file.filename,
          file.mimetype,
          checksum,
          descriptor ? JSON.stringify(descriptor) : null,
          descriptor ? FACE_FEATURE_VERSION : null,
          descriptor ? FACE_DESCRIPTOR_MODEL : null,
          quality ? JSON.stringify(quality) : null,
        ],
      );

      // Keep a small gallery: the oldest references beyond the limit are
      // removed together with their files after the transaction commits.
      const overflow = await client.query(
        `SELECT id, object_key FROM biometric_references
          WHERE student_id = $1 AND kind = 'face_image'
          ORDER BY created_at DESC, id DESC
          OFFSET $2`,
        [studentId, MAX_REFERENCE_PHOTOS],
      );
      if (overflow.rows.length) {
        await client.query(
          `DELETE FROM biometric_references WHERE id = ANY($1::uuid[])`,
          [overflow.rows.map((row) => row.id)],
        );
      }

      return { record: inserted.rows[0], deleted: [...removed, ...overflow.rows] };
    });

    for (const ref of result.deleted) {
      await fs.promises
        .unlink(path.join(uploadsRoot, "students", ref.object_key))
        .catch(() => {});
    }

    return result.record;
  } catch (error) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw error;
  }
}

// Shared by both upload routes. Returns null when enrollment metadata is
// absent (legacy avatar upload) or an error object when it is unusable.
function resolveEnrollment(body) {
  const fields = readFaceEnrollmentFields(body);
  if (fields.descriptor === undefined || fields.quality === undefined) {
    return {
      error: {
        status: 422,
        message:
          "اطلاعات چهره در درخواست معتبر نیست. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.",
      },
    };
  }
  if (fields.descriptor === null) {
    return { fields, enrollment: null };
  }
  const enrollment = validateFaceEnrollment(fields);
  if (!enrollment.ok) {
    return {
      fields,
      error: { status: 422, message: enrollment.message, reason: enrollment.reason },
    };
  }
  return { fields, enrollment };
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
    if (!(await teacherOwnsStudent(req, req.params.studentId))) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
    }

    const { fields, enrollment, error } = resolveEnrollment(req.body);
    if (error) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res
        .status(error.status)
        .json({ message: error.message, reason: error.reason });
    }

    const record = await addStudentFacePhoto(
      req.params.studentId,
      req.user.org,
      req.file,
      {
        descriptor: enrollment?.descriptor ?? null,
        quality: enrollment?.quality ?? null,
        mode: fields.mode,
      },
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

    // عکس پروفایل خود دانشجو؛ همین عکس مرجع تشخیص چهره هم هست.
    // For the student's own avatar we replace the gallery so the avatar and the
    // reference stay identical, matching the previous behaviour.
    const { enrollment, error } = resolveEnrollment(req.body);
    if (error) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res
        .status(error.status)
        .json({ message: error.message, reason: error.reason });
    }

    const record = await addStudentFacePhoto(
      studentId,
      req.user.org,
      req.file,
      {
        descriptor: enrollment?.descriptor ?? null,
        quality: enrollment?.quality ?? null,
        mode: "replace",
      },
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
    const teacher = await resolveCourseTeacher(req, c.teacherId, c.teacherName);
    const course = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO courses (organization_id,code,title,teacher_name,teacher_user_id,room,weekday,start_time,end_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, code, title`,
        [
          req.user.org,
          c.code,
          c.title,
          teacher.name,
          teacher.id,
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
        { code: c.code, title: c.title },
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
    const c = { ...req.body };
    // Teachers can only edit their own courses and cannot reassign them. Admins
    // may pick the owning teacher from the faculty's teacher list.
    if (isTeacher(req)) {
      const teacher = await resolveCourseTeacher(req, null, c.teacherName);
      c.teacherId = teacher.id;
      c.teacherName = teacher.name;
    } else if (c.teacherId !== undefined && c.teacherId !== null) {
      const teacher = await resolveCourseTeacher(req, c.teacherId, c.teacherName);
      c.teacherName = teacher.name;
      c.teacherId = teacher.id;
    }
    const fields = {
      code: "code",
      title: "title",
      teacherName: "teacher_name",
      teacherId: "teacher_user_id",
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
      let ownership = "";
      if (isTeacher(req)) {
        values.push(req.user.sub);
        ownership = ` AND teacher_user_id=$${values.length}`;
      }
      const { rows } = await client.query(
        `UPDATE courses SET ${assignments.join(", ")}, updated_at=now()
          WHERE organization_id=$1 AND id=$2${ownership}
          RETURNING id, code, title`,
        values,
      );
      if (!rows[0])
        throw Object.assign(
          new Error(
            isTeacher(req)
              ? "این درس به شما تخصیص نیافته است."
              : "درس پیدا نشد.",
          ),
          { status: isTeacher(req) ? 403 : 404 },
        );
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
        // Students added to / removed from the course must immediately be
        // reflected in draft and open exams so nobody misses the window.
        await refreshCourseExamStudents(client, req.params.courseId);
      }
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "update",
        "course",
        req.params.courseId,
        {
          fields: changes.map(([key]) => key),
          ...(c.title ? { title: c.title } : {}),
          ...(c.code ? { code: c.code } : {}),
        },
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
    if (!(await teacherOwnsStudent(req, req.params.studentId)))
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
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
         (organization_id, system_name, late_after_minutes, notifications_enabled,
          face_recognition_enabled, face_match_distance, face_match_margin,
          face_min_frames, face_liveness_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (organization_id) DO UPDATE
       SET system_name=EXCLUDED.system_name,
           late_after_minutes=EXCLUDED.late_after_minutes,
           notifications_enabled=EXCLUDED.notifications_enabled,
           face_recognition_enabled=EXCLUDED.face_recognition_enabled,
           face_match_distance=EXCLUDED.face_match_distance,
           face_match_margin=EXCLUDED.face_match_margin,
           face_min_frames=EXCLUDED.face_min_frames,
           face_liveness_required=EXCLUDED.face_liveness_required,
           updated_at=now()
       RETURNING system_name AS "systemName", late_after_minutes AS "lateAfterMinutes",
                 notifications_enabled AS "notificationsEnabled",
                 face_recognition_enabled AS "faceRecognitionEnabled",
                 face_match_distance AS "faceMatchDistance",
                 face_match_margin AS "faceMatchMargin",
                 face_min_frames AS "faceMinFrames",
                 face_liveness_required AS "faceLivenessRequired"`,
      [
        req.user.org,
        s.systemName,
        s.lateAfterMinutes,
        s.notificationsEnabled,
        s.faceRecognitionEnabled,
        s.faceMatchDistance,
        s.faceMatchMargin,
        s.faceMinFrames,
        s.faceLivenessRequired,
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
        isTeacher(req)
          ? "SELECT id FROM courses WHERE id=$1 AND organization_id=$2 AND teacher_user_id=$3"
          : "SELECT id FROM courses WHERE id=$1 AND organization_id=$2",
        isTeacher(req)
          ? [s.courseId, req.user.org, req.user.sub]
          : [s.courseId, req.user.org],
      );
      if (!ownership.rows[0])
        throw Object.assign(
          new Error(
            isTeacher(req)
              ? "این درس به شما تخصیص نیافته است."
              : "درس پیدا نشد.",
          ),
          { status: isTeacher(req) ? 403 : 404 },
        );
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
        { courseId: s.courseId, date: s.date },
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
    const params = [req.body.status, req.user.org, req.params.sessionId];
    let scope = "";
    if (isTeacher(req)) {
      params.push(req.user.sub);
      scope = ` AND EXISTS (
        SELECT 1 FROM courses c
         WHERE c.id = class_sessions.course_id AND c.teacher_user_id = $4
      )`;
    }
    const { rows } = await pool.query(
      `UPDATE class_sessions SET status=$1, updated_at=now()
        WHERE organization_id=$2 AND id=$3${scope} RETURNING id, status`,
      params,
    );
    if (!rows[0]) return res.sendStatus(isTeacher(req) ? 403 : 404);
    res.json(rows[0]);
  }),
);

app.post(
  "/api/sessions/:sessionId/finalize",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const session = await client.query(
        isTeacher(req)
          ? `SELECT s.id, s.status
               FROM class_sessions s
               JOIN courses c ON c.id = s.course_id
              WHERE s.id=$1 AND s.organization_id=$2 AND c.teacher_user_id=$3
              FOR UPDATE OF s`
          : "SELECT id, status FROM class_sessions WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        isTeacher(req)
          ? [req.params.sessionId, req.user.org, req.user.sub]
          : [req.params.sessionId, req.user.org],
      );
      if (!session.rows[0])
        throw Object.assign(
          new Error(
            isTeacher(req)
              ? "این جلسه به شما تخصیص نیافته است."
              : "جلسه پیدا نشد.",
          ),
          { status: isTeacher(req) ? 403 : 404 },
        );

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
    const { sessionId, studentId, status, method, reason, faceVerification } =
      req.body;

    // Face attendance is only accepted when the client supplies a plausible
    // verification payload and the faculty has the feature enabled.
    const faceDecision = evaluateFaceAttendance({
      method,
      verification: faceVerification,
      settings: (
        await pool.query(
          `SELECT face_recognition_enabled AS "faceRecognitionEnabled",
                  face_match_distance AS "faceMatchDistance",
                  face_match_margin AS "faceMatchMargin",
                  face_min_frames AS "faceMinFrames",
                  face_liveness_required AS "faceLivenessRequired"
             FROM organization_settings WHERE organization_id=$1`,
          [req.user.org],
        )
      ).rows[0],
      maxDistance: DEFAULT_FACE_MAX_DISTANCE,
      minMargin: DEFAULT_FACE_MIN_MARGIN,
    });

    if (!faceDecision.ok) {
      await pool
        .query(
          `INSERT INTO face_recognition_events
             (organization_id, session_id, student_id, actor_user_id, method,
              decision, reason, distance, margin, threshold, liveness,
              frame_count, device_id, reference_id, detail)
           VALUES ($1,$2,$3,$4,$5,'rejected',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            req.user.org,
            sessionId,
            studentId,
            req.user.sub,
            method,
            faceDecision.reason,
            Number.isFinite(faceDecision.distance) ? faceDecision.distance : null,
            Number.isFinite(faceDecision.margin) ? faceDecision.margin : null,
            null,
            faceDecision.liveness || null,
            faceDecision.frameCount ?? null,
            faceDecision.deviceId || null,
            null,
            JSON.stringify({ reason: faceDecision.reason }),
          ],
        )
        .catch(() => {});
      return res
        .status(422)
        .json({ message: faceDecision.message, reason: faceDecision.reason });
    }

    // Shared writer for the Phase 3+ rejection paths below.
    async function logFaceRejection(reason, extra = {}) {
      await pool
        .query(
          `INSERT INTO face_recognition_events
             (organization_id, session_id, student_id, actor_user_id, method,
              decision, reason, distance, margin, threshold, liveness,
              frame_count, device_id, reference_id, detail)
           VALUES ($1,$2,$3,$4,$5,'rejected',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            req.user.org,
            sessionId,
            studentId,
            req.user.sub,
            method,
            reason,
            extra.distance ?? null,
            extra.margin ?? null,
            extra.threshold ?? null,
            extra.liveness ?? null,
            extra.frameCount ?? null,
            extra.deviceId ?? null,
            extra.referenceId ?? null,
            JSON.stringify({ reason, ...extra }),
          ],
        )
        .catch(() => {});
    }

    // Phase 3+ (A): the browser cannot be taken on its word. When it sends the
    // live descriptor, the server re-normalizes and re-scores it against the
    // student's stored gallery and rejects forged or drifting claims.
    if (faceVerification?.descriptor) {
      const stored = await pool.query(
        `SELECT features FROM biometric_references
          WHERE student_id=$1 AND kind='face_image'
            AND features IS NOT NULL AND jsonb_array_length(features)=128`,
        [studentId],
      );
      const claim = verifyDescriptorClaim({
        liveDescriptor: faceVerification.descriptor,
        storedDescriptors: stored.rows.map((row) => row.features),
        claimedDistance: faceVerification.distance,
        maxDistance: faceDecision.threshold,
      });
      if (!claim.ok) {
        await logFaceRejection(claim.reason, {
          distance: faceVerification.distance,
          margin: faceVerification.margin ?? null,
          threshold: faceDecision.threshold ?? null,
          liveness: faceDecision.liveness ?? null,
          frameCount: faceDecision.frameCount ?? null,
          deviceId: faceDecision.deviceId ?? null,
          referenceId: faceDecision.referenceId ?? null,
          serverDistance: claim.serverDistance,
        });
        return res.status(422).json({
          message:
            "شواهد تطبیق چهره با عکس مرجع همخوانی ندارد. دوباره مقابل دوربین قرار بگیرید.",
          reason: claim.reason,
        });
      }
    }

    // Phase 3+ (D): a replayed verification payload must not re-write or
    // re-log attendance. Legitimate clients never re-mark within 5 seconds
    // (the UI already de-duplicates per session).
    if (FACE_METHODS.has(method)) {
      const recent = await pool.query(
        `SELECT id FROM face_recognition_events
          WHERE session_id=$1 AND student_id=$2 AND decision='accepted'
            AND created_at > now() - interval '5 seconds'
          LIMIT 1`,
        [sessionId, studentId],
      );
      if (recent.rows[0]) {
        await logFaceRejection("replay", {
          distance: faceVerification?.distance ?? null,
          deviceId: faceDecision.deviceId ?? null,
        });
        return res.status(429).json({
          message: "این حضور چند لحظه قبل ثبت شده است.",
          reason: "replay",
        });
      }
    }

    const record = await withTransaction(async (client) => {
      const session = await client.query(
        isTeacher(req)
          ? `SELECT s.id
               FROM class_sessions s
               JOIN courses c ON c.id = s.course_id
              WHERE s.id=$1 AND s.organization_id=$2 AND c.teacher_user_id=$3`
          : "SELECT id FROM class_sessions WHERE id=$1 AND organization_id=$2",
        isTeacher(req)
          ? [sessionId, req.user.org, req.user.sub]
          : [sessionId, req.user.org],
      );
      if (!session.rows[0])
        throw Object.assign(
          new Error(
            isTeacher(req)
              ? "این جلسه به شما تخصیص نیافته است."
              : "جلسه پیدا نشد.",
          ),
          { status: isTeacher(req) ? 403 : 404 },
        );
      const student = await client.query(
        "SELECT id FROM students WHERE id=$1 AND organization_id=$2",
        [studentId, req.user.org],
      );
      if (!student.rows[0])
        throw Object.assign(new Error("دانشجو پیدا نشد."), { status: 404 });
      if (!(await teacherOwnsStudent(req, studentId)))
        throw Object.assign(
          new Error("این دانشجو در درس‌های شما ثبت نشده است."),
          { status: 403 },
        );

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

      if (faceDecision.applicable) {
        let referenceId = faceDecision.referenceId;
        if (referenceId) {
          const reference = await client.query(
            `SELECT id FROM biometric_references
              WHERE id=$1 AND student_id=$2 AND kind='face_image'`,
            [referenceId, studentId],
          );
          if (!reference.rows[0]) referenceId = null;
        }
        await client.query(
          `INSERT INTO face_recognition_events
             (organization_id, session_id, student_id, actor_user_id, method,
              decision, distance, margin, threshold, liveness, frame_count,
              device_id, reference_id, detail)
           VALUES ($1,$2,$3,$4,$5,'accepted',$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            req.user.org,
            sessionId,
            studentId,
            req.user.sub,
            method,
            faceDecision.distance,
            faceDecision.margin,
            faceDecision.threshold,
            faceDecision.liveness,
            faceDecision.frameCount || null,
            faceDecision.deviceId,
            referenceId,
            JSON.stringify({ status }),
          ],
        );
      }

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

// Read model for the face-recognition audit trail. Admins see the whole
// faculty; teachers only see sessions they own.
app.get(
  "/api/face-recognition/events",
  authorize("admin", "teacher"),
  validate(
    z.object({
      sessionId: id.optional(),
      studentId: id.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    "query",
  ),
  asyncRoute(async (req, res) => {
    const params = [req.user.org];
    const filters = [];
    if (req.query.sessionId) {
      params.push(req.query.sessionId);
      filters.push(`e.session_id = $${params.length}`);
    }
    if (req.query.studentId) {
      params.push(req.query.studentId);
      filters.push(`e.student_id = $${params.length}`);
    }
    if (isTeacher(req)) {
      params.push(req.user.sub);
      filters.push(
        `e.session_id IN (
           SELECT s.id FROM class_sessions s
             JOIN courses c ON c.id = s.course_id
            WHERE c.organization_id = $1 AND c.teacher_user_id = $${params.length}
         )`,
      );
    }
    params.push(req.query.limit);
    const { rows } = await pool.query(
      `SELECT e.id, e.session_id AS "sessionId", e.student_id AS "studentId",
              st.full_name AS "studentName", e.method, e.decision, e.reason,
              e.distance, e.margin, e.threshold, e.liveness,
              e.frame_count AS "frameCount", e.device_id AS "deviceId",
              e.created_at AS "createdAt"
         FROM face_recognition_events e
         LEFT JOIN students st ON st.id = e.student_id
        WHERE e.organization_id = $1
          ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
        ORDER BY e.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    res.json({ events: rows });
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
    if (!(await teacherOwnsStudent(req, resolvedStudentId))) {
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
    }
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
    if (!(await teacherOwnsStudent(req, ownerStudentId)))
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
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
    if (req.query.studentId && !(await teacherOwnsStudent(req, req.query.studentId)))
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
    const credentials = await listFingerprintCredentials(
      req.user.org,
      req.query.studentId,
      isTeacher(req) ? req.user.sub : null,
    );
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
    const params = [organizationId];
    let scope = "";
    if (isTeacher(req)) {
      params.push(req.user.sub);
      scope = ` AND fc.student_id IN (
        SELECT cs.student_id FROM course_students cs
          JOIN courses c ON c.id = cs.course_id
         WHERE c.organization_id = $1 AND c.teacher_user_id = $2
        UNION
        SELECT ss.student_id FROM session_students ss
          JOIN class_sessions s ON s.id = ss.session_id
          JOIN courses c ON c.id = s.course_id
         WHERE s.organization_id = $1 AND c.teacher_user_id = $2
      )`;
    }
    const { rows } = await pool.query(
      `SELECT fc.credential_id AS "credentialId", fc.student_id AS "studentId", fc.transports
         FROM fingerprint_credentials fc
        WHERE fc.organization_id = $1 AND fc.revoked_at IS NULL${scope}
        ORDER BY fc.created_at`,
      params,
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
    if (!(await teacherOwnsStudent(req, credentialRow.studentId))) {
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
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
      `SELECT id, student_id AS "studentId" FROM fingerprint_credentials
        WHERE credential_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
      [req.params.credentialId, req.user.org],
    );
    if (!rows[0]) return res.sendStatus(404);
    if (!(await teacherOwnsStudent(req, rows[0].studentId)))
      return res
        .status(403)
        .json({ message: "این دانشجو در درس‌های شما ثبت نشده است." });
    await pool.query(
      `UPDATE fingerprint_credentials SET revoked_at = now() WHERE id = $1`,
      [rows[0].id],
    );
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
        isTeacher(req)
          ? `SELECT a.status
               FROM attendance_records a
               JOIN class_sessions s ON s.id = a.session_id
               JOIN courses c ON c.id = s.course_id
              WHERE a.id=$1 AND s.organization_id=$2 AND c.teacher_user_id=$3
              FOR UPDATE OF a`
          : `SELECT a.status FROM attendance_records a JOIN class_sessions s ON s.id=a.session_id WHERE a.id=$1 AND s.organization_id=$2 FOR UPDATE`,
        isTeacher(req)
          ? [req.params.attendanceId, req.user.org, req.user.sub]
          : [req.params.attendanceId, req.user.org],
      );
      if (!existing.rows[0])
        throw Object.assign(
          new Error(
            isTeacher(req)
              ? "این رکورد حضور مربوط به درس‌های شما نیست."
              : "رکورد حضور پیدا نشد.",
          ),
          { status: isTeacher(req) ? 403 : 404 },
        );
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
    const result = { created: 0, errors: [], accounts: [] };
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
          const inserted = await client.query(
            `INSERT INTO students (organization_id, student_number, full_name, major, term, phone, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id`,
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
          // Imported students get a login too, otherwise they can never sign in
          // to see their exams and attendance.
          const account = await createStudentAccount(client, {
            organizationId: req.user.org,
            student: {
              id: inserted.rows[0].id,
              student_number: data.studentNumber,
              full_name: data.fullName,
            },
          });
          result.accounts.push({
            fullName: account.fullName,
            username: account.username,
            temporaryPassword: account.temporaryPassword,
          });
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
          const owner = await client.query(
            `SELECT u.id
               FROM users u
              WHERE u.role = 'teacher' AND u.organization_id = $1
                AND lower(btrim(u.display_name)) = lower(btrim($2))
              LIMIT 2`,
            [req.user.org, data.teacherName],
          );
          const teacherUserId = owner.rows.length === 1 ? owner.rows[0].id : null;
          await client.query(
            `INSERT INTO courses (organization_id, code, title, teacher_name, teacher_user_id, room, weekday, start_time, end_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              req.user.org,
              data.code,
              data.title,
              data.teacherName,
              teacherUserId,
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
  if (req.user.role === "teacher") return { studentId: null, teacherUserId: req.user.sub };
  if (req.user.role !== "student") return { studentId: null, teacherUserId: null };
  const student = await findStudentByUserId(req.user.sub, req.user.org);
  return {
    studentId: student?.id || "00000000-0000-0000-0000-000000000000",
    teacherUserId: null,
  };
}

app.get(
  "/api/analytics/trend",
  validate(analyticsSchema, "query"),
  asyncRoute(async (req, res) => {
    const { from, to } = analyticsRange(req.query);
    const { studentId, teacherUserId } = await analyticsScope(req);
    const granularity = req.query.granularity || "day";
    const params = [req.user.org, from, to];
    let scope = "";
    if (studentId) {
      params.push(studentId);
      scope += ` AND ar.student_id=$${params.length}`;
    }
    if (teacherUserId) {
      params.push(teacherUserId);
      scope += ` AND c.teacher_user_id=$${params.length}`;
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
         JOIN courses c ON c.id=cs.course_id
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
    const { studentId, teacherUserId } = await analyticsScope(req);
    const params = [req.user.org, from, to];
    let scope = "";
    if (studentId) {
      params.push(studentId);
      scope += ` AND ar.student_id=$${params.length}`;
    }
    if (teacherUserId) {
      params.push(teacherUserId);
      scope += ` AND c.teacher_user_id=$${params.length}`;
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
    const params = [req.user.org, date];
    let scope = "";
    if (isTeacher(req)) {
      params.push(req.user.sub);
      scope = " AND c.teacher_user_id=$3";
    }
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
        WHERE s.organization_id=$1 AND s.session_date=$2${scope}
        GROUP BY s.id, c.id
        ORDER BY s.start_time`,
      params,
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
    if (isTeacher(req) && !(await teacherOwnsSession(req, req.params.sessionId)))
      return res
        .status(403)
        .json({ message: "این جلسه به شما تخصیص نیافته است." });

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
    if (!(await teacherOwnsSession(req, req.params.sessionId)))
      return res
        .status(403)
        .json({ message: "این جلسه به شما تخصیص نیافته است." });
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
    if (!(await teacherOwnsSession(req, req.params.sessionId)))
      return res
        .status(403)
        .json({ message: "این جلسه به شما تخصیص نیافته است." });
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

/* ============================== exams ============================== */

function examError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function loadExamForManagement(req, examId, client = pool) {
  const { rows } = await client.query(
    `SELECT e.*, c.title AS "courseTitle", c.code AS "courseCode",
            c.teacher_user_id AS "courseTeacherId",
            COALESCE(u.display_name, c.teacher_name) AS "teacherName"
       FROM exams e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN users u ON u.id = COALESCE(e.created_by, c.teacher_user_id)
      WHERE e.id = $1 AND e.organization_id = $2`,
    [examId, req.user.org],
  );
  const exam = rows[0];
  if (!exam) throw examError(404, "آزمون پیدا نشد.");
  if (
    isTeacher(req) &&
    String(exam.courseTeacherId) !== String(req.user.sub)
  ) {
    throw examError(403, "این آزمون به شما تخصیص نیافته است.");
  }
  return exam;
}

function normalizeExam(exam) {
  if (!exam) return null;
  return {
    id: exam.exam_id ?? exam.id,
    title: exam.title,
    description: exam.description,
    courseId: exam.course_id ?? exam.courseId,
    courseTitle: exam.courseTitle ?? exam.course_title,
    courseCode: exam.courseCode ?? exam.course_code,
    teacherName: exam.teacherName ?? exam.teacher_name,
    status: exam.exam_status ?? exam.status,
    availableFrom: exam.available_from ?? exam.availableFrom,
    availableUntil: exam.available_until ?? exam.availableUntil,
    durationMinutes: Number(exam.duration_minutes ?? exam.durationMinutes),
    passPercent: Number(exam.pass_percent ?? exam.passPercent ?? 50),
    shuffleQuestions:
      exam.shuffle_questions ?? exam.shuffleQuestions ?? true,
    shuffleOptions: exam.shuffle_options ?? exam.shuffleOptions ?? true,
    resultsVisibility:
      exam.results_visibility ?? exam.resultsVisibility ?? "after_close",
    maxAttempts: Number(exam.max_attempts ?? exam.maxAttempts ?? 1),
    questionCount:
      exam.questionCount != null ? Number(exam.questionCount) : undefined,
    studentCount:
      exam.studentCount != null ? Number(exam.studentCount) : undefined,
  };
}

async function loadExamQuestions(examId, client = pool) {
  const { rows } = await client.query(
    `SELECT q.id, q.position, q.prompt, q.points,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', o.id,
                  'position', o.position,
                  'text', o.text,
                  'isCorrect', o.is_correct
                ) ORDER BY o.position
              ) FILTER (WHERE o.id IS NOT NULL),
              '[]'::json
            ) AS options
       FROM exam_questions q
       LEFT JOIN exam_options o ON o.question_id = q.id
      WHERE q.exam_id = $1
      GROUP BY q.id
      ORDER BY q.position`,
    [examId],
  );
  return rows.map((question) => ({
    ...question,
    position: Number(question.position),
    points: Number(question.points),
    options: (question.options || []).map((option) => ({
      ...option,
      position: Number(option.position),
    })),
  }));
}

async function insertExamQuestions(client, examId, questions) {
  for (const [index, question] of questions.entries()) {
    const { rows } = await client.query(
      `INSERT INTO exam_questions (exam_id, position, prompt, points)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [examId, index + 1, question.prompt, question.points],
    );
    const questionId = rows[0].id;
    for (const [optionIndex, option] of question.options.entries()) {
      await client.query(
        `INSERT INTO exam_options (question_id, position, text, is_correct)
         VALUES ($1, $2, $3, $4)`,
        [questionId, optionIndex + 1, option.text, option.isCorrect],
      );
    }
  }
}

async function saveExamAnswers(client, questions, attemptId, answers) {
  if (!answers?.length) return;
  const questionMap = new Map(
    questions.map((question) => [String(question.id), question]),
  );
  for (const answer of answers) {
    const question = questionMap.get(String(answer.questionId));
    if (!question) {
      throw examError(422, "سوال ارسالی متعلق به این آزمون نیست.");
    }
    const optionId = answer.selectedOptionId
      ? String(answer.selectedOptionId)
      : null;
    if (
      optionId &&
      !question.options.some((option) => String(option.id) === optionId)
    ) {
      throw examError(422, "گزینهٔ انتخاب‌شده معتبر نیست.");
    }
  }
  for (const answer of answers) {
    await client.query(
      `INSERT INTO exam_answers (attempt_id, question_id, selected_option_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (attempt_id, question_id)
       DO UPDATE SET selected_option_id = EXCLUDED.selected_option_id,
                     answered_at = now()`,
      [
        attemptId,
        answer.questionId,
        answer.selectedOptionId ? answer.selectedOptionId : null,
      ],
    );
  }
}

async function finalizeExamAttempt({
  attemptId,
  answers = null,
  integrity = {},
  mode = "submitted",
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT a.*, e.organization_id, e.course_id, e.title, e.pass_percent,
              e.results_visibility, e.available_until, e.status AS exam_status
         FROM exam_attempts a
         JOIN exams e ON e.id = a.exam_id
        WHERE a.id = $1
        FOR UPDATE`,
      [attemptId],
    );
    const attempt = rows[0];
    if (!attempt) return { notFound: true };
    if (["submitted", "expired", "voided"].includes(attempt.status)) {
      return { attempt, alreadyFinal: true };
    }

    const questions = await loadExamQuestions(attempt.exam_id, client);
    await saveExamAnswers(client, questions, attempt.id, answers);

    const { rows: savedAnswers } = await client.query(
      `SELECT question_id AS "questionId",
              selected_option_id AS "selectedOptionId"
         FROM exam_answers
        WHERE attempt_id = $1`,
      [attempt.id],
    );
    const graded = gradeAnswers(questions, savedAnswers);
    const status = mode === "expired" ? "expired" : "submitted";
    const submittedAt =
      status === "expired" ? attempt.expires_at : new Date();
    const tabSwitches = Math.max(
      0,
      Math.min(10_000, Number(integrity.tabSwitches) || 0),
    );
    const fullscreenExits = Math.max(
      0,
      Math.min(10_000, Number(integrity.fullscreenExits) || 0),
    );
    const copyAttempts = Math.max(
      0,
      Math.min(10_000, Number(integrity.copyAttempts) || 0),
    );
    const printAttempts = Math.max(
      0,
      Math.min(10_000, Number(integrity.printAttempts) || 0),
    );
    const focusLosses = Math.max(
      0,
      Math.min(10_000, Number(integrity.focusLosses) || 0),
    );

    const { rows: updated } = await client.query(
      `UPDATE exam_attempts
          SET status = $2,
              submitted_at = $3,
              correct_count = $4,
              earned_points = $5,
              total_points = $6,
              percent = $7,
              score_out_of_20 = $8,
              passed = $9,
              graded_at = now(),
              tab_switch_count = GREATEST(tab_switch_count, $10),
              integrity_flags = integrity_flags || $11::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        attempt.id,
        status,
        submittedAt,
        graded.correctCount,
        graded.earnedPoints,
        graded.totalPoints,
        graded.percent,
        graded.scoreOutOf20,
        graded.percent >= Number(attempt.pass_percent),
        tabSwitches,
        JSON.stringify({
          tabSwitches,
          fullscreenExits,
          copyAttempts,
          printAttempts,
          focusLosses,
        }),
      ],
    );

    for (const question of questions) {
      const entry = graded.perAnswer.get(String(question.id));
      if (!entry) continue;
      await client.query(
        `UPDATE exam_answers
            SET is_correct = $2, earned_points = $3
          WHERE attempt_id = $1 AND question_id = $4`,
        [attempt.id, entry.isCorrect, entry.earnedPoints, question.id],
      );
    }

    return { attempt: updated[0], questions, graded };
  });
}

async function finalizeExpiredExamAttempts({
  organizationId,
  examId = null,
  studentId = null,
}) {
  const params = [organizationId];
  const where = [
    "a.status = 'in_progress'",
    "a.expires_at < now()",
    "e.organization_id = $1",
  ];
  if (examId) {
    params.push(examId);
    where.push(`a.exam_id = $${params.length}`);
  }
  if (studentId) {
    params.push(studentId);
    where.push(`a.student_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT a.id
       FROM exam_attempts a
       JOIN exams e ON e.id = a.exam_id
      WHERE ${where.join(" AND ")}`,
    params,
  );
  for (const row of rows) {
    await finalizeExamAttempt({ attemptId: row.id, mode: "expired" }).catch(
      (error) => console.error("finalize expired exam attempt", error),
    );
  }
  await maybeNotifyExamResultsReady({ organizationId, examId }).catch((error) =>
    console.error("results-ready notification", error),
  );
}

// "Results ready" notification for after_close exams. Idempotent: the first
// caller to atomically claim the exam via results_notified_at sends the
// notifications, so this is safe to call from finalize paths with no cron.
async function maybeNotifyExamResultsReady({ organizationId, examId = null }) {
  const params = [organizationId];
  const filters = [
    "e.organization_id = $1",
    "e.results_visibility = 'after_close'",
    "e.results_notified_at IS NULL",
    "e.status <> 'cancelled'",
    "(e.status = 'closed' OR e.available_until <= now())",
  ];
  if (examId) {
    params.push(examId);
    filters.push(`e.id = $${params.length}`);
  }
  const { rows: candidates } = await pool.query(
    `SELECT e.id, e.title FROM exams e WHERE ${filters.join(" AND ")}`,
    params,
  );
  for (const exam of candidates) {
    const { rowCount } = await pool.query(
      `UPDATE exams
          SET results_notified_at = now(), updated_at = now()
        WHERE id = $1 AND results_notified_at IS NULL`,
      [exam.id],
    );
    if (!rowCount) continue;
    try {
      await pool.query(
        `INSERT INTO notifications (organization_id, user_id, type, title, message, link)
         SELECT DISTINCT $1::uuid, u.id, 'exam', $2, $3, 'portal'
           FROM users u
           JOIN students st
             ON st.organization_id = u.organization_id
            AND (
              st.student_number = u.student_id
              OR (
                u.student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                AND st.id = u.student_id::uuid
              )
            )
           JOIN exam_attempts a ON a.student_id = st.id AND a.exam_id = $4::uuid
          WHERE u.role = 'student' AND u.is_active = true
            AND a.status IN ('submitted', 'expired')`,
        [
          organizationId,
          `نتیجهٔ آزمون: ${exam.title}`,
          `نمرهٔ آزمون «${exam.title}» اکنون در دسترس است.`,
          exam.id,
        ],
      );
    } catch (error) {
      console.error("results-ready notification", error);
    }
  }
}

function examAttemptPayload(attempt) {
  return {
    id: attempt.id,
    status: attempt.status,
    attemptNo: Number(attempt.attempt_no ?? 1),
    startedAt: attempt.started_at ?? attempt.startedAt,
    expiresAt: attempt.expires_at ?? attempt.expiresAt,
    submittedAt: attempt.submitted_at ?? attempt.submittedAt,
    correctCount: Number(attempt.correct_count ?? 0),
    earnedPoints: Number(attempt.earned_points ?? 0),
    totalPoints: Number(attempt.total_points ?? 0),
    percent:
      attempt.percent == null ? null : Number(attempt.percent),
    scoreOutOf20:
      attempt.score_out_of_20 == null
        ? null
        : Number(attempt.score_out_of_20),
    passed: attempt.passed,
    tabSwitchCount: Number(attempt.tab_switch_count ?? 0),
    integrityFlags: attempt.integrity_flags ?? attempt.integrityFlags ?? {},
  };
}

async function loadStudentExamAttempt(attemptId, studentId) {
  const { rows } = await pool.query(
    `SELECT a.*, e.id AS exam_id, e.organization_id, e.title, e.description,
            e.available_from, e.available_until, e.duration_minutes,
            e.pass_percent, e.shuffle_questions, e.shuffle_options,
            e.results_visibility, e.status AS exam_status,
            c.title AS course_title, c.code AS course_code,
            c.teacher_name AS teacher_name
       FROM exam_attempts a
       JOIN exams e ON e.id = a.exam_id
       JOIN courses c ON c.id = e.course_id
      WHERE a.id = $1 AND a.student_id = $2`,
    [attemptId, studentId],
  );
  return rows[0] || null;
}

async function buildStudentAttemptPayload(attempt) {
  const questions = await loadExamQuestions(attempt.exam_id);
  const ordered = orderByAttempt(
    questions,
    attempt.id,
    attempt.shuffle_questions,
  ).map((question) => ({
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    points: question.points,
    options: orderByAttempt(
      question.options,
      attempt.id,
      attempt.shuffle_options,
    ).map((option) => ({
      id: option.id,
      position: option.position,
      text: option.text,
    })),
  }));
  const { rows: answers } = await pool.query(
    `SELECT question_id AS "questionId",
            selected_option_id AS "selectedOptionId"
       FROM exam_answers
      WHERE attempt_id = $1`,
    [attempt.id],
  );
  return {
    attempt: examAttemptPayload(attempt),
    exam: {
      id: attempt.exam_id,
      title: attempt.title,
      description: attempt.description,
      courseTitle: attempt.course_title,
      courseCode: attempt.course_code,
      teacherName: attempt.teacher_name,
      durationMinutes:
        Number(attempt.duration_minutes) + Number(attempt.extra_minutes || 0),
      extraMinutes: Number(attempt.extra_minutes || 0),
      questionCount: ordered.length,
      passPercent: Number(attempt.pass_percent),
      resultsVisibility: attempt.results_visibility,
      availableUntil: attempt.available_until,
      status: attempt.exam_status,
    },
    questions: ordered,
    answers,
    serverNow: new Date().toISOString(),
  };
}

async function buildStudentResultPayload(attempt, exam, questions = null) {
  const normalizedExam = normalizeExam(exam || attempt);
  const visible = scoreVisible(normalizedExam, attempt);
  const base = {
    attempt: examAttemptPayload(attempt),
    exam: {
      id: normalizedExam.id,
      title: normalizedExam.title,
      courseTitle: normalizedExam.courseTitle,
      courseCode: normalizedExam.courseCode,
      teacherName: normalizedExam.teacherName,
      resultsVisibility: normalizedExam.resultsVisibility,
      status: normalizedExam.status,
      availableUntil: normalizedExam.availableUntil,
    },
    scoreVisible: visible,
    serverNow: new Date().toISOString(),
  };
  if (!visible) return base;

  const allQuestions = questions || (await loadExamQuestions(attempt.exam_id));
  const { rows: answers } = await pool.query(
    `SELECT question_id AS "questionId",
            selected_option_id AS "selectedOptionId"
       FROM exam_answers
      WHERE attempt_id = $1`,
    [attempt.id],
  );
  const answerMap = new Map(
    answers.map((answer) => [
      String(answer.questionId),
      answer.selectedOptionId ? String(answer.selectedOptionId) : null,
    ]),
  );
  base.questions = allQuestions.map((question) => ({
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    points: question.points,
    selectedOptionId: answerMap.get(String(question.id)) || null,
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: option.isCorrect === true,
    })),
  }));
  return base;
}

async function refreshExamStudents(client, examId, courseId) {
  // Diff-style refresh: keep rows for students still enrolled (preserving any
  // granted accommodations) and only drop students who left the course.
  await client.query(
    `INSERT INTO exam_students (exam_id, student_id)
     SELECT $1, cs.student_id
       FROM course_students cs
       JOIN students st ON st.id = cs.student_id
      WHERE cs.course_id = $2 AND st.status = 'active'
     ON CONFLICT DO NOTHING`,
    [examId, courseId],
  );
  await client.query(
    `DELETE FROM exam_students es
      WHERE es.exam_id = $1
        AND NOT EXISTS (
          SELECT 1
            FROM course_students cs
            JOIN students st ON st.id = cs.student_id
           WHERE cs.course_id = $2
             AND cs.student_id = es.student_id
             AND st.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM exam_attempts a
           WHERE a.exam_id = es.exam_id AND a.student_id = es.student_id
        )`,
    [examId, courseId],
  );
}

// Keep the eligibility snapshot in sync while an exam is still editable/open.
// Closed or cancelled exams keep their historical snapshot untouched.
async function refreshCourseExamStudents(client, courseId) {
  const { rows } = await client.query(
    `SELECT id FROM exams
      WHERE course_id = $1 AND status IN ('draft', 'published')`,
    [courseId],
  );
  for (const row of rows) {
    await refreshExamStudents(client, row.id, courseId);
  }
}

app.get(
  "/api/exams",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    await finalizeExpiredExamAttempts({ organizationId: req.user.org });
    const params = [req.user.org];
    let scope = "";
    if (isTeacher(req)) {
      params.push(req.user.sub);
      scope = ` AND c.teacher_user_id = $${params.length}`;
    }
    let filters = "";
    if (req.query.courseId) {
      params.push(req.query.courseId);
      filters += ` AND e.course_id = $${params.length}`;
    }
    if (req.query.teacherId && !isTeacher(req)) {
      params.push(req.query.teacherId);
      filters += ` AND c.teacher_user_id = $${params.length}`;
    }
    const allowedStatuses = ["draft", "published", "closed", "cancelled"];
    if (allowedStatuses.includes(String(req.query.status || ""))) {
      params.push(req.query.status);
      filters += ` AND e.status = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.description, e.status,
              e.available_from AS "availableFrom",
              e.available_until AS "availableUntil",
              e.duration_minutes AS "durationMinutes",
              e.pass_percent AS "passPercent",
              e.shuffle_questions AS "shuffleQuestions",
              e.shuffle_options AS "shuffleOptions",
              e.results_visibility AS "resultsVisibility",
              e.max_attempts AS "maxAttempts",
              e.published_at AS "publishedAt",
              e.closed_at AS "closedAt",
              e.created_at AS "createdAt",
              c.id AS "courseId", c.code AS "courseCode",
              c.title AS "courseTitle",
              COALESCE(u.display_name, c.teacher_name) AS "teacherName",
              (SELECT count(*)::int FROM exam_questions q
                WHERE q.exam_id = e.id) AS "questionCount",
              CASE WHEN e.status = 'draft'
                THEN (SELECT count(*)::int
                        FROM course_students cs
                        JOIN students st ON st.id = cs.student_id
                       WHERE cs.course_id = e.course_id
                         AND st.status = 'active')
                ELSE (SELECT count(*)::int FROM exam_students es
                       WHERE es.exam_id = e.id)
              END AS "studentCount",
              (SELECT count(*)::int FROM exam_attempts a
                WHERE a.exam_id = e.id
                  AND a.status IN ('submitted','expired')) AS "submittedCount",
              (SELECT count(*)::int FROM exam_attempts a
                WHERE a.exam_id = e.id
                  AND a.status IN ('submitted','expired')
                  AND a.passed) AS "passedCount",
              (SELECT round(avg(a.percent)::numeric, 2)
                 FROM exam_attempts a
                WHERE a.exam_id = e.id
                  AND a.status IN ('submitted','expired')) AS "averagePercent"
         FROM exams e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN users u ON u.id = COALESCE(e.created_by, c.teacher_user_id)
        WHERE e.organization_id = $1${scope}${filters}
        ORDER BY e.available_from DESC, e.created_at DESC`,
      params,
    );
    const now = Date.now();
    res.json({
      exams: rows.map((exam) => ({
        ...exam,
        effectiveStatus:
          exam.status === "published"
            ? new Date(exam.availableUntil).getTime() <= now
              ? "closed"
              : new Date(exam.availableFrom).getTime() > now
                ? "upcoming"
                : "open"
            : exam.status,
      })),
      serverNow: new Date().toISOString(),
    });
  }),
);

app.get(
  "/api/exams/:id",
  // "mine" belongs to the student route registered below; skip this route for it
  // before the teacher/admin guard rejects students with 403.
  (req, res, next) =>
    req.params.id === "mine"
      ? next()
      : authorize("admin", "teacher")(req, res, next),
  asyncRoute(async (req, res, next) => {
    if (req.params.id === "mine") return next();
    const exam = await loadExamForManagement(req, req.params.id);
    const questions = await loadExamQuestions(exam.id);
    res.json({
      exam: normalizeExam(exam),
      questions: questions.map((question) => ({
        id: question.id,
        position: question.position,
        prompt: question.prompt,
        points: question.points,
        options: question.options,
      })),
      serverNow: new Date().toISOString(),
    });
  }),
);

app.post(
  "/api/exams",
  authorize("teacher"),
  validate(examInputSchema),
  asyncRoute(async (req, res) => {
    const input = req.body;
    if (new Date(input.availableUntil).getTime() <= Date.now()) {
      return res.status(422).json({
        message:
          "پایان بازهٔ آزمون باید در آینده باشد. زمان آزمون را اصلاح کنید و دوباره ذخیره کنید.",
      });
    }
    const course = await pool.query(
      `SELECT id, title, teacher_user_id
         FROM courses
        WHERE id = $1 AND organization_id = $2 AND teacher_user_id = $3`,
      [input.courseId, req.user.org, req.user.sub],
    );
    if (!course.rows[0]) {
      return res
        .status(403)
        .json({ message: "این درس به شما تخصیص نیافته است." });
    }
    const exam = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exams
           (organization_id, course_id, created_by, title, description,
            available_from, available_until, duration_minutes, pass_percent,
            shuffle_questions, shuffle_options, results_visibility, max_attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          req.user.org,
          input.courseId,
          req.user.sub,
          input.title,
          input.description || "",
          input.availableFrom,
          input.availableUntil,
          input.durationMinutes,
          input.passPercent,
          input.shuffleQuestions,
          input.shuffleOptions,
          input.resultsVisibility,
          input.maxAttempts,
        ],
      );
      await insertExamQuestions(client, rows[0].id, input.questions);
      // Snapshot the course roster right away so the teacher sees the real
      // participant count; publish refreshes it again before the exam opens.
      await refreshExamStudents(client, rows[0].id, input.courseId);
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "create",
        "exam",
        rows[0].id,
        { title: input.title, courseId: input.courseId },
      );
      return rows[0];
    });
    res.status(201).json({ exam: normalizeExam(exam) });
  }),
);

app.put(
  "/api/exams/:id",
  authorize("teacher"),
  validate(examInputSchema),
  asyncRoute(async (req, res) => {
    const input = req.body;
    if (new Date(input.availableUntil).getTime() <= Date.now()) {
      return res.status(422).json({
        message:
          "پایان بازهٔ آزمون باید در آینده باشد. زمان آزمون را اصلاح کنید.",
      });
    }
    const exam = await loadExamForManagement(req, req.params.id);
    if (!["draft", "published"].includes(exam.status)) {
      return res
        .status(409)
        .json({ message: "آزمون بسته یا لغو‌شده قابل ویرایش نیست." });
    }
    const { rows: attempts } = await pool.query(
      `SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1`,
      [exam.id],
    );
    if (attempts[0].count > 0) {
      return res.status(409).json({
        message:
          "پس از شروع آزمون، سوالات قفل می‌شوند. فقط پایان بازه یا نمایش نتیجه قابل تغییر است.",
      });
    }
    const course = await pool.query(
      `SELECT id, title FROM courses
        WHERE id = $1 AND organization_id = $2 AND teacher_user_id = $3`,
      [input.courseId, req.user.org, req.user.sub],
    );
    if (!course.rows[0]) {
      return res
        .status(403)
        .json({ message: "این درس به شما تخصیص نیافته است." });
    }
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE exams
            SET course_id = $2, title = $3, description = $4,
                available_from = $5, available_until = $6,
                duration_minutes = $7, pass_percent = $8,
                shuffle_questions = $9, shuffle_options = $10,
                results_visibility = $11, max_attempts = $12,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          exam.id,
          input.courseId,
          input.title,
          input.description || "",
          input.availableFrom,
          input.availableUntil,
          input.durationMinutes,
          input.passPercent,
          input.shuffleQuestions,
          input.shuffleOptions,
          input.resultsVisibility,
          input.maxAttempts,
        ],
      );
      await client.query(`DELETE FROM exam_questions WHERE exam_id = $1`, [
        exam.id,
      ]);
      await insertExamQuestions(client, exam.id, input.questions);
      // The exam may have moved to another course, and the roster can change
      // while it is still a draft. Refresh unconditionally: editing is only
      // allowed before any attempt exists, so no student data can be lost.
      await refreshExamStudents(client, exam.id, input.courseId);
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "update",
        "exam",
        exam.id,
        { title: input.title },
      );
      return rows[0];
    });
    res.json({ exam: normalizeExam(updated) });
  }),
);

app.patch(
  "/api/exams/:id/schedule",
  authorize("admin", "teacher"),
  validate(examScheduleSchema),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    if (!["draft", "published"].includes(exam.status)) {
      return res
        .status(409)
        .json({ message: "فقط آزمون پیش‌نویس یا منتشرشده قابل تنظیم است." });
    }
    const updates = [];
    const params = [exam.id];
    if (req.body.availableUntil) {
      const until = new Date(req.body.availableUntil);
      if (until.getTime() <= Date.now()) {
        return res
          .status(422)
          .json({ message: "پایان بازه باید در آینده باشد." });
      }
      if (
        until.getTime() - new Date(exam.available_from).getTime() <
        Number(exam.duration_minutes) * 60_000
      ) {
        return res.status(422).json({
          message: "پایان بازه با مدت پاسخ‌دهی آزمون سازگار نیست.",
        });
      }
      params.push(req.body.availableUntil);
      updates.push(`available_until = $${params.length}`);
    }
    if (req.body.resultsVisibility) {
      params.push(req.body.resultsVisibility);
      updates.push(`results_visibility = $${params.length}`);
    }
    if (!updates.length) {
      return res.status(422).json({ message: "تغییری ارسال نشده است." });
    }
    updates.push("updated_at = now()");
    const { rows } = await pool.query(
      `UPDATE exams SET ${updates.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );
    await withTransaction(async (client) => {
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "schedule",
        "exam",
        exam.id,
        req.body,
      );
    });
    res.json({ exam: normalizeExam(rows[0]) });
  }),
);

app.post(
  "/api/exams/:id/publish",
  authorize("teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    if (exam.status !== "draft") {
      return res.status(409).json({ message: "این آزمون قبلاً منتشر شده است." });
    }
    if (new Date(exam.available_until).getTime() <= Date.now()) {
      return res
        .status(422)
        .json({ message: "بازهٔ آزمون به پایان رسیده است؛ زمان را تمدید کنید." });
    }
    const questions = await loadExamQuestions(exam.id);
    if (!questions.length || questions.length > 20) {
      return res
        .status(422)
        .json({ message: "آزمون باید بین ۱ تا ۲۰ سوال داشته باشد." });
    }
    const invalid = questions.find(
      (question) =>
        question.options.length < 3 ||
        question.options.length > 5 ||
        question.options.filter((option) => option.isCorrect).length !== 1,
    );
    if (invalid) {
      return res.status(422).json({
        message: "هر سوال باید ۳ تا ۵ گزینه و دقیقاً یک پاسخ صحیح داشته باشد.",
      });
    }
    const { rows: studentCount } = await pool.query(
      `SELECT count(*)::int AS count
         FROM course_students cs
         JOIN students st ON st.id = cs.student_id
        WHERE cs.course_id = $1 AND st.status = 'active'`,
      [exam.course_id],
    );
    if (!studentCount[0].count) {
      return res.status(422).json({
        message: "در این درس دانشجوی فعالی ثبت نشده است.",
      });
    }
    const published = await withTransaction(async (client) => {
      await refreshExamStudents(client, exam.id, exam.course_id);
      const { rows } = await client.query(
        `UPDATE exams
            SET status = 'published', published_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [exam.id],
      );
      // Notify every student account linked to an eligible student.
      await client.query(
        `INSERT INTO notifications (organization_id, user_id, type, title, message, link)
         SELECT DISTINCT $1::uuid, u.id, 'exam', $2, $3, 'portal'
           FROM users u
           JOIN students st
             ON st.organization_id = u.organization_id
            AND (
              st.student_number = u.student_id
              OR (
                u.student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                AND st.id = u.student_id::uuid
              )
            )
           JOIN exam_students es ON es.student_id = st.id
          WHERE u.role = 'student' AND u.is_active = true AND es.exam_id = $4::uuid`,
        [
          req.user.org,
          `آزمون جدید: ${exam.title}`,
          `آزمون «${exam.title}» برای درس ${exam.courseTitle} منتشر شد.`,
          exam.id,
        ],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "publish",
        "exam",
        exam.id,
        { title: exam.title },
      );
      return rows[0];
    });
    // Students only see exams through a linked user account. Tell the teacher
    // when some course members cannot log in, instead of silently skipping them.
    const { rows: missingAccounts } = await pool.query(
      `SELECT count(*)::int AS count
         FROM exam_students es
         JOIN students st ON st.id = es.student_id
        WHERE es.exam_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM users u
             WHERE u.organization_id = $2
               AND u.role = 'student' AND u.is_active = true
               AND (
                 st.student_number = u.student_id
                 OR (
                   u.student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   AND st.id = u.student_id::uuid
                 )
               )
          )`,
      [exam.id, req.user.org],
    );
    res.json({
      exam: normalizeExam(published),
      studentsWithoutAccounts: missingAccounts[0].count,
    });
  }),
);

app.post(
  "/api/exams/:id/close",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    if (exam.status === "draft") {
      return res
        .status(409)
        .json({ message: "آزمون پیش‌نویس قابل بستن نیست؛ آن را لغو کنید." });
    }
    if (exam.status === "closed") {
      return res.json({ exam: normalizeExam(exam) });
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE exams
            SET status = 'closed', closed_at = now(), updated_at = now()
          WHERE id = $1`,
        [exam.id],
      );
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "close",
        "exam",
        exam.id,
        { title: exam.title },
      );
    });
    // Closing an exam early must finalize every open attempt, not only attempts
    // that already passed their per-student expiry.
    const { rows: openAttempts } = await pool.query(
      `SELECT id FROM exam_attempts
        WHERE exam_id = $1 AND status = 'in_progress'`,
      [exam.id],
    );
    for (const attempt of openAttempts) {
      await finalizeExamAttempt({ attemptId: attempt.id, mode: "expired" }).catch(
        (error) => console.error("finalize attempt on exam close", error),
      );
    }
    await finalizeExpiredExamAttempts({
      organizationId: req.user.org,
      examId: exam.id,
    });
    const { rows } = await pool.query(`SELECT * FROM exams WHERE id = $1`, [
      exam.id,
    ]);
    res.json({ exam: normalizeExam(rows[0]) });
  }),
);

app.post(
  "/api/exams/:id/cancel",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const { rows: attempts } = await pool.query(
      `SELECT count(*)::int AS count FROM exam_attempts
        WHERE exam_id = $1 AND status <> 'voided'`,
      [exam.id],
    );
    if (attempts[0].count > 0) {
      return res.status(409).json({
        message: "آزمون دارای شرکت‌کننده قابل لغو نیست؛ آن را ببندید.",
      });
    }
    const { rows } = await pool.query(
      `UPDATE exams
          SET status = 'cancelled', closed_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [exam.id],
    );
    await withTransaction(async (client) => {
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "cancel",
        "exam",
        exam.id,
        { title: exam.title },
      );
    });
    res.json({ exam: normalizeExam(rows[0]) });
  }),
);

app.delete(
  "/api/exams/:id",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const { rows: attempts } = await pool.query(
      `SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1`,
      [exam.id],
    );
    if (attempts[0].count > 0) {
      return res.status(409).json({
        message: "آزمون دارای سابقهٔ شرکت‌کننده قابل حذف نیست؛ آن را ببندید.",
      });
    }
    if (!["draft", "cancelled"].includes(exam.status)) {
      return res.status(409).json({
        message: "فقط آزمون پیش‌نویس یا لغو‌شده قابل حذف است.",
      });
    }
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM exams WHERE id = $1`, [exam.id]);
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "delete",
        "exam",
        exam.id,
        { title: exam.title },
      );
    });
    res.sendStatus(204);
  }),
);

app.get(
  "/api/exams/:id/results",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    await finalizeExpiredExamAttempts({
      organizationId: req.user.org,
      examId: exam.id,
    });
    const { rows } = await pool.query(
      `SELECT st.id AS "studentId", st.student_number AS "studentNumber",
              st.full_name AS "fullName",
              a.id AS "attemptId", a.status AS "attemptStatus",
              a.started_at AS "startedAt", a.submitted_at AS "submittedAt",
              a.percent, a.score_out_of_20 AS "scoreOutOf20", a.passed,
              a.correct_count AS "correctCount", a.total_points AS "totalPoints",
              a.tab_switch_count AS "tabSwitchCount",
              a.integrity_flags AS "integrityFlags",
              a.ip_address AS "ipAddress", a.user_agent AS "userAgent",
              a.void_reason AS "voidReason",
              es.extra_minutes AS "extraMinutes",
              es.extra_attempts AS "extraAttempts"
         FROM exam_students es
         JOIN students st ON st.id = es.student_id
         LEFT JOIN LATERAL (
           SELECT x.*
             FROM exam_attempts x
            WHERE x.exam_id = es.exam_id AND x.student_id = es.student_id
            ORDER BY x.attempt_no DESC
            LIMIT 1
         ) a ON true
        WHERE es.exam_id = $1
        ORDER BY st.full_name`,
      [exam.id],
    );
    const finished = rows.filter((row) =>
      ["submitted", "expired"].includes(row.attemptStatus),
    );
    const summary = {
      studentCount: rows.length,
      startedCount: rows.filter((row) => row.attemptStatus).length,
      submittedCount: finished.length,
      passedCount: finished.filter((row) => row.passed).length,
      suspiciousCount: finished.filter(
        (row) => Number(row.tabSwitchCount || 0) >= 3,
      ).length,
      averagePercent: finished.length
        ? Math.round(
            (finished.reduce((sum, row) => sum + Number(row.percent || 0), 0) /
              finished.length) *
              100,
          ) / 100
        : null,
    };
    res.json({
      exam: normalizeExam(exam),
      results: rows,
      summary,
      serverNow: new Date().toISOString(),
    });
  }),
);

app.get(
  "/api/exams/:id/attempts/:attemptId",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const { rows } = await pool.query(
      `SELECT a.*, st.student_number AS "studentNumber",
              st.full_name AS "fullName"
         FROM exam_attempts a
         JOIN students st ON st.id = a.student_id
        WHERE a.id = $1 AND a.exam_id = $2`,
      [req.params.attemptId, exam.id],
    );
    const attempt = rows[0];
    if (!attempt) return res.status(404).json({ message: "برگهٔ آزمون پیدا نشد." });
    const questions = await loadExamQuestions(exam.id);
    const { rows: answers } = await pool.query(
      `SELECT question_id AS "questionId",
              selected_option_id AS "selectedOptionId",
              is_correct AS "isCorrect", earned_points AS "earnedPoints"
         FROM exam_answers WHERE attempt_id = $1`,
      [attempt.id],
    );
    const answerMap = new Map(
      answers.map((answer) => [String(answer.questionId), answer]),
    );
    res.json({
      exam: normalizeExam(exam),
      attempt: examAttemptPayload(attempt),
      student: {
        id: attempt.student_id,
        number: attempt.studentNumber,
        name: attempt.fullName,
      },
      questions: questions.map((question) => ({
        ...question,
        answer: answerMap.get(String(question.id)) || null,
      })),
      serverNow: new Date().toISOString(),
    });
  }),
);

app.post(
  "/api/exams/:id/attempts/:attemptId/void",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 3) {
      return res
        .status(422)
        .json({ message: "دلیل ابطال را وارد کنید (حداقل ۳ کاراکتر)." });
    }
    const { rows } = await pool.query(
      `UPDATE exam_attempts
          SET status = 'voided', voided_at = now(), void_reason = $3,
              updated_at = now()
        WHERE id = $1 AND exam_id = $2 AND status <> 'voided'
        RETURNING *`,
      [req.params.attemptId, exam.id, reason],
    );
    if (!rows[0]) {
      return res.status(404).json({ message: "برگهٔ آزمون پیدا نشد." });
    }
    await withTransaction(async (client) => {
      await audit(
        client,
        req.user.org,
        req.user.sub,
        "void",
        "exam_attempt",
        rows[0].id,
        { examId: exam.id, reason },
      );
    });
    res.json({ attempt: examAttemptPayload(rows[0]) });
  }),
);

app.get(
  "/api/exams/mine",
  authorize("student"),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student) {
      return res.status(404).json({
        message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست.",
      });
    }
    await finalizeExpiredExamAttempts({
      organizationId: req.user.org,
      studentId: student.id,
    });
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.description,
              e.available_from AS "availableFrom",
              e.available_until AS "availableUntil",
              e.duration_minutes AS "durationMinutes",
              e.pass_percent AS "passPercent",
              e.results_visibility AS "resultsVisibility",
              e.status,
              c.title AS "courseTitle", c.code AS "courseCode",
              c.teacher_name AS "teacherName",
              es.extra_minutes AS "extraMinutes",
              es.extra_attempts AS "extraAttempts",
              (SELECT count(*)::int FROM exam_questions q
                WHERE q.exam_id = e.id) AS "questionCount",
              a.id AS "attemptId", a.status AS "attemptStatus",
              a.started_at AS "startedAt", a.expires_at AS "attemptExpiresAt",
              a.submitted_at AS "submittedAt", a.percent,
              a.score_out_of_20 AS "scoreOutOf20", a.passed,
              a.correct_count AS "correctCount",
              a.total_points AS "totalPoints"
         FROM exams e
         JOIN courses c ON c.id = e.course_id
         JOIN exam_students es
           ON es.exam_id = e.id AND es.student_id = $2
         LEFT JOIN LATERAL (
           SELECT x.*
             FROM exam_attempts x
            WHERE x.exam_id = e.id AND x.student_id = $2
              AND x.status <> 'voided'
            ORDER BY x.attempt_no DESC
            LIMIT 1
         ) a ON true
        WHERE e.organization_id = $1
          AND e.status IN ('published', 'closed')
        ORDER BY e.available_from DESC`,
      [req.user.org, student.id],
    );
    const now = Date.now();
    res.json({
      exams: rows.map((exam) => {
        const normalized = normalizeExam({
          ...exam,
          resultsVisibility: exam.resultsVisibility,
          availableUntil: exam.availableUntil,
        });
        const attempt = exam.attemptId
          ? {
              status: exam.attemptStatus,
              percent: exam.percent,
              passed: exam.passed,
            }
          : null;
        const visible = scoreVisible(normalized, attempt);
        const inWindow =
          new Date(exam.availableFrom).getTime() <= now &&
          new Date(exam.availableUntil).getTime() > now;
        return {
          ...exam,
          scoreVisible: visible,
          percent: visible ? exam.percent : null,
          scoreOutOf20: visible ? exam.scoreOutOf20 : null,
          passed: visible ? exam.passed : null,
          correctCount: visible ? exam.correctCount : null,
          totalPoints: visible ? exam.totalPoints : null,
          canStart:
            exam.status === "published" &&
            inWindow &&
            !exam.attemptId,
          canResume:
            exam.attemptStatus === "in_progress" &&
            new Date(exam.attemptExpiresAt).getTime() > now,
        };
      }),
      student: { id: student.id, number: student.studentNumber },
      serverNow: new Date().toISOString(),
    });
  }),
);

app.post(
  "/api/exams/:id/start",
  authorize("student"),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student) {
      return res.status(404).json({
        message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست.",
      });
    }
    const { rows: examRows } = await pool.query(
      `SELECT e.*, c.title AS "courseTitle", c.code AS "courseCode",
              c.teacher_name AS "teacherName"
         FROM exams e
         JOIN courses c ON c.id = e.course_id
        WHERE e.id = $1 AND e.organization_id = $2`,
      [req.params.id, req.user.org],
    );
    const exam = examRows[0];
    if (!exam) return res.status(404).json({ message: "آزمون پیدا نشد." });
    if (exam.status !== "published") {
      return res.status(409).json({
        message:
          exam.status === "draft"
            ? "این آزمون هنوز منتشر نشده است."
            : "این آزمون بسته شده است.",
      });
    }
    const now = Date.now();
    if (now < new Date(exam.available_from).getTime()) {
      return res
        .status(409)
        .json({ message: "زمان شروع آزمون هنوز فرا نرسیده است." });
    }
    if (now >= new Date(exam.available_until).getTime()) {
      return res
        .status(409)
        .json({ message: "زمان این آزمون به پایان رسیده است." });
    }
    const { rows: eligibility } = await pool.query(
      `SELECT extra_minutes, extra_attempts
         FROM exam_students
        WHERE exam_id = $1 AND student_id = $2`,
      [exam.id, student.id],
    );
    if (!eligibility.length) {
      return res
        .status(403)
        .json({ message: "شما در فهرست دانشجویان مجاز این آزمون نیستید." });
    }
    const accommodation = eligibility[0];
    const extraMinutes = Number(accommodation.extra_minutes || 0);
    const extraAttempts = Number(accommodation.extra_attempts || 0);
    await finalizeExpiredExamAttempts({
      organizationId: req.user.org,
      examId: exam.id,
      studentId: student.id,
    });
    const { rows: existing } = await pool.query(
      `SELECT * FROM exam_attempts
        WHERE exam_id = $1 AND student_id = $2
        ORDER BY attempt_no`,
      [exam.id, student.id],
    );
    const active = existing.filter((attempt) => attempt.status !== "voided");
    // Resume an open attempt before checking the attempt limit, otherwise a
    // student with max_attempts=1 could never return to an in-progress exam.
    const inProgress = active.find(
      (attempt) => attempt.status === "in_progress",
    );
    if (inProgress) {
      if (new Date(inProgress.expires_at).getTime() > now) {
        return res.json(await buildStudentAttemptPayload({
          ...exam,
          ...inProgress,
          exam_id: exam.id,
          title: exam.title,
          description: exam.description,
          course_title: exam.courseTitle,
          course_code: exam.courseCode,
          teacher_name: exam.teacherName,
          duration_minutes: exam.duration_minutes,
          pass_percent: exam.pass_percent,
          results_visibility: exam.results_visibility,
          shuffle_questions: exam.shuffle_questions,
          shuffle_options: exam.shuffle_options,
          available_until: exam.available_until,
          exam_status: exam.status,
        }));
      }
      await finalizeExamAttempt({ attemptId: inProgress.id, mode: "expired" });
      return res.status(409).json({
        message: "زمان آزمون شما به پایان رسیده است.",
        attemptId: inProgress.id,
      });
    }
    if (
      active.length >=
      Number(exam.max_attempts) + extraAttempts
    ) {
      const last = active[active.length - 1];
      return res.status(409).json({
        message: "شما قبلاً در این آزمون شرکت کرده‌اید.",
        attemptId: last?.id || null,
      });
    }
    let attempt;
    try {
      const { rows } = await pool.query(
        `INSERT INTO exam_attempts
           (exam_id, student_id, attempt_no, started_at, expires_at,
            ip_address, user_agent, extra_minutes)
         VALUES ($1, $2, $3, now(),
                 LEAST(now() + make_interval(mins => $4), $5),
                 $6, $7, $8)
         RETURNING *`,
        [
          exam.id,
          student.id,
          existing.length ? Math.max(...existing.map((row) => row.attempt_no)) + 1 : 1,
          Number(exam.duration_minutes) + extraMinutes,
          exam.available_until,
          req.ip,
          req.get("user-agent") || null,
          extraMinutes,
        ],
      );
      attempt = rows[0];
    } catch (error) {
      if (error.code === "23505") {
        const { rows } = await pool.query(
          `SELECT * FROM exam_attempts
            WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
            LIMIT 1`,
          [exam.id, student.id],
        );
        if (rows[0]) {
          attempt = rows[0];
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    res.status(201).json(await buildStudentAttemptPayload({
      ...exam,
      exam_id: exam.id,
      ...attempt,
      title: exam.title,
      description: exam.description,
      course_title: exam.courseTitle,
      course_code: exam.courseCode,
      teacher_name: exam.teacherName,
      duration_minutes: exam.duration_minutes,
      pass_percent: exam.pass_percent,
      results_visibility: exam.results_visibility,
      shuffle_questions: exam.shuffle_questions,
      shuffle_options: exam.shuffle_options,
      available_until: exam.available_until,
      exam_status: exam.status,
    }));
  }),
);

app.put(
  "/api/exams/attempts/:attemptId/answers",
  authorize("student"),
  validate(examAnswersSchema),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student) {
      return res.status(404).json({
        message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست.",
      });
    }
    const attempt = await loadStudentExamAttempt(
      req.params.attemptId,
      student.id,
    );
    if (!attempt) {
      return res.status(404).json({ message: "آزمون در حال اجرا پیدا نشد." });
    }
    if (attempt.status !== "in_progress") {
      return res.status(409).json({ message: "این آزمون قبلاً ثبت شده است." });
    }
    if (Date.now() > new Date(attempt.expires_at).getTime()) {
      await finalizeExamAttempt({ attemptId: attempt.id, mode: "expired" });
      return res.status(409).json({
        message: "زمان آزمون به پایان رسیده است؛ پاسخ‌های ذخیره‌شده ثبت شدند.",
        attemptId: attempt.id,
      });
    }
    await withTransaction(async (client) => {
      const questions = await loadExamQuestions(attempt.exam_id, client);
      await saveExamAnswers(
        client,
        questions,
        attempt.id,
        req.body.answers,
      );
    });
    res.json({
      savedAt: new Date().toISOString(),
      serverNow: new Date().toISOString(),
      expiresAt: attempt.expires_at,
    });
  }),
);

app.post(
  "/api/exams/attempts/:attemptId/submit",
  authorize("student"),
  validate(examAnswersSchema),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student) {
      return res.status(404).json({
        message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست.",
      });
    }
    const attempt = await loadStudentExamAttempt(
      req.params.attemptId,
      student.id,
    );
    if (!attempt) {
      return res.status(404).json({ message: "آزمون پیدا نشد." });
    }
    if (["submitted", "expired"].includes(attempt.status)) {
      return res.json(await buildStudentResultPayload(attempt, attempt));
    }
    if (attempt.status === "voided") {
      return res.status(409).json({ message: "این آزمون ابطال شده است." });
    }
    const expires = new Date(attempt.expires_at).getTime();
    const late = Date.now() > expires + 30_000;
    const result = await finalizeExamAttempt({
      attemptId: attempt.id,
      answers: late ? null : req.body.answers,
      integrity: req.body.integrity || {},
      mode: late ? "expired" : "submitted",
    });
    if (result.notFound) {
      return res.status(404).json({ message: "آزمون پیدا نشد." });
    }
    res.json(
      await buildStudentResultPayload(result.attempt, attempt, result.questions),
    );
  }),
);

app.get(
  "/api/exams/attempts/:attemptId",
  authorize("student"),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student) {
      return res.status(404).json({
        message: "حساب شما به دانشجویی معتبر در سامانه متصل نیست.",
      });
    }
    let attempt = await loadStudentExamAttempt(
      req.params.attemptId,
      student.id,
    );
    if (!attempt) {
      return res.status(404).json({ message: "آزمون پیدا نشد." });
    }
    if (
      attempt.status === "in_progress" &&
      Date.now() > new Date(attempt.expires_at).getTime()
    ) {
      await finalizeExamAttempt({ attemptId: attempt.id, mode: "expired" });
      attempt = await loadStudentExamAttempt(attempt.id, student.id);
    }
    if (attempt.status === "in_progress") {
      return res.json(await buildStudentAttemptPayload(attempt));
    }
    res.json(await buildStudentResultPayload(attempt, attempt));
  }),
);

// Notify one linked student account about an exam (best effort).
async function notifyExamStudent({ organizationId, studentId, title, message }) {
  try {
    await pool.query(
      `INSERT INTO notifications (organization_id, user_id, type, title, message, link)
       SELECT DISTINCT $1::uuid, u.id, 'exam', $2, $3, 'portal'
         FROM users u
         JOIN students st
           ON st.organization_id = u.organization_id
          AND (
            st.student_number = u.student_id
            OR (
              u.student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND st.id = u.student_id::uuid
            )
          )
        WHERE u.role = 'student' AND u.is_active = true AND st.id = $4::uuid`,
      [organizationId, title, message, studentId],
    );
  } catch (error) {
    console.error("notify exam student", error);
  }
}

app.post(
  "/api/exams/:id/students/:studentId/accommodation",
  authorize("admin", "teacher"),
  validate(
    z.object({
      extraMinutes: z.coerce.number().int().min(0).max(180),
      extraAttempts: z.coerce.number().int().min(0).max(3),
      note: z.string().trim().max(200).optional().default(""),
    }),
  ),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const body = req.body;
    let updated = null;
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE exam_students
            SET extra_minutes = $1, extra_attempts = $2
          WHERE exam_id = $3 AND student_id = $4
          RETURNING extra_minutes, extra_attempts`,
        [body.extraMinutes, body.extraAttempts, exam.id, req.params.studentId],
      );
      updated = rows[0] || null;
      if (!updated) {
        throw examError(404, "این دانشجو در فهرست مجاز این آزمون نیست.");
      }
      await audit(client, req.user.org, req.user.sub, "grant_accommodation", "exam", exam.id, {
        title: exam.title,
        studentId: req.params.studentId,
        extraMinutes: body.extraMinutes,
        extraAttempts: body.extraAttempts,
        note: body.note || undefined,
      });
    });
    if (body.extraMinutes > 0 || body.extraAttempts > 0) {
      const parts = [];
      if (body.extraMinutes > 0) parts.push(`${body.extraMinutes} دقیقه مهلت اضافه`);
      if (body.extraAttempts > 0) parts.push(`${body.extraAttempts} فرصت اضافه`);
      await notifyExamStudent({
        organizationId: req.user.org,
        studentId: req.params.studentId,
        title: `امتیاز ویژهٔ آزمون: ${exam.title}`,
        message: `برای شما در آزمون «${exam.title}» ${parts.join(" و ")} در نظر گرفته شد.`,
      });
    }
    res.json({
      ok: true,
      extraMinutes: Number(updated.extra_minutes),
      extraAttempts: Number(updated.extra_attempts),
    });
  }),
);

app.get(
  "/api/exams/:id/analysis",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const questions = await loadExamQuestions(exam.id);
    const { rows: attemptRows } = await pool.query(
      `SELECT id FROM exam_attempts
        WHERE exam_id = $1 AND status IN ('submitted', 'expired')`,
      [exam.id],
    );
    const attemptIds = attemptRows.map((row) => row.id);
    let answerRows = [];
    if (attemptIds.length) {
      const { rows } = await pool.query(
        `SELECT question_id AS "questionId",
                selected_option_id AS "selectedOptionId",
                is_correct AS "isCorrect"
           FROM exam_answers
          WHERE attempt_id = ANY($1::uuid[])`,
        [attemptIds],
      );
      answerRows = rows;
    }
    const analysis = questions.map((question) => {
      const qAnswers = answerRows.filter(
        (answer) => String(answer.questionId) === String(question.id),
      );
      const answeredCount = qAnswers.filter((answer) => answer.selectedOptionId).length;
      const correctCount = qAnswers.filter((answer) => answer.isCorrect).length;
      return {
        id: question.id,
        position: question.position,
        prompt: question.prompt,
        points: Number(question.points),
        doneCount: attemptIds.length,
        answeredCount,
        correctCount,
        correctPercent: attemptIds.length
          ? Math.round((correctCount / attemptIds.length) * 1000) / 10
          : null,
        options: question.options.map((option) => ({
          id: option.id,
          position: option.position,
          text: option.text,
          isCorrect: option.isCorrect === true,
          selectedCount: qAnswers.filter(
            (answer) => String(answer.selectedOptionId) === String(option.id),
          ).length,
        })),
      };
    });
    res.json({ analysis, attemptCount: attemptIds.length });
  }),
);

app.post(
  "/api/exams/attempts/:attemptId/report",
  authorize("student"),
  validate(
    z.object({
      questionId: z.string().uuid(),
      note: z.string().trim().max(500).optional().default(""),
    }),
  ),
  asyncRoute(async (req, res) => {
    const student = await findStudentByUserId(req.user.sub, req.user.org);
    if (!student) {
      return res.status(404).json({ message: "پروفایل دانشجو یافت نشد." });
    }
    const body = req.body;
    const attempt = await loadStudentExamAttempt(req.params.attemptId, student.id);
    if (!attempt) {
      return res.status(404).json({ message: "جلسهٔ آزمون یافت نشد." });
    }
    if (attempt.status !== "in_progress") {
      return res.status(409).json({
        message: "گزارش خطای سوال فقط در حین آزمون امکان‌پذیر است.",
      });
    }
    if (new Date(attempt.expires_at).getTime() <= Date.now()) {
      return res.status(409).json({ message: "مهلت این آزمون به پایان رسیده است." });
    }
    const { rowCount: questionBelongs } = await pool.query(
      `SELECT 1 FROM exam_questions WHERE id = $1 AND exam_id = $2`,
      [body.questionId, attempt.exam_id],
    );
    if (!questionBelongs) {
      return res.status(404).json({ message: "این سوال مربوط به این آزمون نیست." });
    }
    await pool.query(
      `INSERT INTO exam_question_reports (exam_id, question_id, student_id, attempt_id, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (question_id, student_id)
       DO UPDATE SET note = EXCLUDED.note,
                     attempt_id = EXCLUDED.attempt_id,
                     created_at = now()`,
      [attempt.exam_id, body.questionId, student.id, attempt.id, body.note],
    );
    res.status(201).json({ ok: true });
  }),
);

app.get(
  "/api/exams/:id/reports",
  authorize("admin", "teacher"),
  asyncRoute(async (req, res) => {
    const exam = await loadExamForManagement(req, req.params.id);
    const { rows } = await pool.query(
      `SELECT r.id, r.note, r.created_at AS "createdAt",
              q.id AS "questionId", q.position AS "position", q.prompt,
              st.id AS "studentId", st.student_number AS "studentNumber",
              st.full_name AS "fullName"
         FROM exam_question_reports r
         JOIN exam_questions q ON q.id = r.question_id
         JOIN students st ON st.id = r.student_id
        WHERE r.exam_id = $1
        ORDER BY r.created_at DESC`,
      [exam.id],
    );
    res.json({ reports: rows });
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

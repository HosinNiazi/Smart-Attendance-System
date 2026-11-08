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

const app = express();

const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters.");

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
function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, org: user.organization_id, role: user.role },
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
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success)
      return res.status(422).json({
        message: "اطلاعات ارسالی معتبر نیست.",
        errors: result.error.flatten(),
      });
    req.body = result.data;
    return next();
  };
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
  .enum(["manual", "face", "voice", "class_camera", "system"])
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

app.get(
  "/health",
  asyncRoute(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  }),
);
app.post(
  "/api/auth/login",
  validate(
    z.object({
      email: z.string().trim().email().max(254),
      password: z.string().min(8).max(128),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;
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
    res.json({ token: tokenFor(user), user: publicUser(user) });
  }),
);

app.post(
  "/api/registrations",
  validate(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      username: z.string().trim().min(3).max(120),
      password: z.string().min(8).max(128),
      nationalId: z.string().trim().max(20).optional().default(""),
      major: z.string().trim().max(120).optional().default(""),
      term: z.string().trim().max(20).optional().default(""),
      phone: z.string().trim().max(40).optional().default(""),
    }),
  ),
  asyncRoute(async (req, res) => {
    const orgRow = await pool.query(
      "SELECT id FROM organizations WHERE name = $1 ORDER BY created_at LIMIT 1",
      ["سازمان پیش‌فرض"],
    );
    if (!orgRow.rows[0])
      return res.status(500).json({ message: "سازمان پیش‌فرض یافت نشد." });
    const orgId = orgRow.rows[0].id;
    const { fullName, username, password, nationalId, major, term, phone } =
      req.body;
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

app.get(
  "/api/me",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND organization_id = $2",
      [req.user.sub, req.user.org],
    );
    res.json({ user: rows[0] ? publicUser(rows[0]) : null });
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
          `SELECT s.id, s.course_id AS "courseId", to_char(s.session_date,'YYYY-MM-DD') AS date, s.teacher_name AS "teacherName", to_char(s.start_time,'HH24:MI') AS "startTime", to_char(s.end_time,'HH24:MI') AS "endTime", s.grace_minutes AS "graceMinutes", s.open_before_minutes AS "openBeforeMinutes", s.close_after_minutes AS "closeAfterMinutes", s.status, COALESCE(array_agg(ss.student_id) FILTER (WHERE ss.student_id IS NOT NULL), '{}') AS "studentIds" FROM class_sessions s LEFT JOIN session_students ss ON ss.session_id=s.id WHERE s.organization_id=$1 GROUP BY s.id ORDER BY s.session_date DESC, s.start_time DESC`,
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
        .enum(["manual", "face", "voice", "class_camera", "system"])
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
      ["face", "voice", "class_camera", "manual", "system"].includes(value)
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

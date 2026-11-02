import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './db.js';

// Demo data used for the local presentation.  Every insert is idempotent, so the
// script can be re-run without duplicating rows.
const students = [
  ['40123001', 'آرمان محمدی', 'مهندسی کامپیوتر', '۳', '09121234567', 'active'],
  ['40123002', 'نگار رضایی', 'مهندسی کامپیوتر', '۳', '09351234567', 'active'],
  ['40123003', 'پارسا کریمی', 'فناوری اطلاعات', '۲', '09151234567', 'active'],
  ['40123004', 'سارا احمدی', 'مهندسی کامپیوتر', '۴', '09901234567', 'active'],
  ['40123005', 'امیرحسین مرادی', 'فناوری اطلاعات', '۲', '09129876543', 'inactive'],
  ['40123006', 'مریم جعفری', 'مهندسی کامپیوتر', '۳', '09361234567', 'active'],
];

const courses = [
  ['CS301', 'برنامه‌سازی پیشرفته', 'مهندس نادری', 'کلاس ۲۰۴', 'شنبه', '10:00', '12:00'],
  ['CS204', 'پایگاه داده', 'دکتر حسینی', 'آزمایشگاه ۱', 'یکشنبه', '13:00', '15:00'],
  ['CS210', 'ساختمان داده', 'مهندس احمدی', 'کلاس ۱۰۲', 'دوشنبه', '08:00', '10:00'],
  ['MA205', 'ریاضی گسسته', 'دکتر کریمی', 'کلاس ۳۰۱', 'سه‌شنبه', '10:00', '12:00'],
];

const iso = (date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

const demoUsers = [
  ['admin@hozorban.local', 'Admin@123456', 'مدیر سامانه', 'admin', null],
  ['teacher@hozorban.local', 'Teacher@123456', 'مهندس نادری', 'teacher', null],
  ['student@hozorban.local', 'Student@123456', 'آرمان محمدی', 'student', '40123001'],
];

const orgRow = await pool.query(
  "SELECT id FROM organizations WHERE name = $1 ORDER BY created_at LIMIT 1",
  ['سازمان پیش‌فرض'],
);
if (!orgRow.rows[0]) {
  throw new Error('Run `npm run migrate` before seeding demo data.');
}
const orgId = orgRow.rows[0].id;

await withTransaction(async (client) => {
  for (const [number, name, major, term, phone, status] of students) {
    await client.query(
      `INSERT INTO students (organization_id, student_number, full_name, major, term, phone, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id, student_number) DO UPDATE
       SET full_name=EXCLUDED.full_name, major=EXCLUDED.major, term=EXCLUDED.term,
           phone=EXCLUDED.phone, status=EXCLUDED.status, updated_at=now()`,
      [orgId, number, name, major, term, phone, status],
    );
  }

  for (const [code, title, teacher, room, weekday, start, end] of courses) {
    await client.query(
      `INSERT INTO courses (organization_id, code, title, teacher_name, room, weekday, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (organization_id, code) DO UPDATE
       SET title=EXCLUDED.title, teacher_name=EXCLUDED.teacher_name, room=EXCLUDED.room,
           weekday=EXCLUDED.weekday, start_time=EXCLUDED.start_time,
           end_time=EXCLUDED.end_time, updated_at=now()`,
      [orgId, code, title, teacher, room, weekday, start, end],
    );
  }

  // Every active student is a member of every demo course.
  await client.query(
    `INSERT INTO course_students (course_id, student_id)
     SELECT c.id, s.id FROM courses c CROSS JOIN students s
     WHERE c.organization_id=$1 AND s.organization_id=$1 AND s.status='active'
     ON CONFLICT DO NOTHING`,
    [orgId],
  );

  for (const [email, password, name, role, studentNumber] of demoUsers) {
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users (organization_id, email, password_hash, display_name, role, student_id)
       VALUES ($1, lower($2), $3, $4, $5, $6)
       ON CONFLICT (organization_id, email) DO UPDATE
       SET password_hash=EXCLUDED.password_hash, display_name=EXCLUDED.display_name,
           role=EXCLUDED.role, student_id=EXCLUDED.student_id`,
      [orgId, email, hash, name, role, studentNumber],
    );
  }

  // Demo session: yesterday (finished, with real statuses) for the first course.
  const yesterdayCourse = await client.query(
    'SELECT id, title FROM courses WHERE organization_id=$1 AND code=$2',
    [orgId, 'CS301'],
  );
  const todayCourse = await client.query(
    'SELECT id, title FROM courses WHERE organization_id=$1 AND code=$2',
    [orgId, 'CS204'],
  );

  const roster = await client.query(
    `SELECT s.id, s.student_number FROM students s
     JOIN course_students cs ON cs.student_id=s.id
     WHERE cs.course_id=$1 AND s.status='active' ORDER BY s.student_number`,
    [yesterdayCourse.rows[0].id],
  );

  const finished = await client.query(
    `INSERT INTO class_sessions
       (organization_id, course_id, session_date, teacher_name, start_time, end_time,
        grace_minutes, open_before_minutes, close_after_minutes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'finalized')
     ON CONFLICT (course_id, session_date) DO UPDATE
       SET status='finalized', updated_at=now()
     RETURNING id`,
    [orgId, yesterdayCourse.rows[0].id, iso(yesterday), 'مهندس نادری', '10:00', '12:00', 10, 15, 30],
  );

  const statuses = ['present', 'present', 'late', 'present', 'absent'];
  for (let index = 0; index < roster.rows.length; index += 1) {
    const student = roster.rows[index];
    await client.query(
      `INSERT INTO session_students (session_id, student_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [finished.rows[0].id, student.id],
    );
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status, method, checked_at)
       VALUES ($1,$2,$3,'manual', now() - interval '1 day')
       ON CONFLICT (session_id, student_id) DO NOTHING`,
      [finished.rows[0].id, student.id, statuses[index % statuses.length]],
    );
  }

  // Demo session for today, opened and waiting for attendance.
  const open = await client.query(
    `INSERT INTO class_sessions
       (organization_id, course_id, session_date, teacher_name, start_time, end_time,
        grace_minutes, open_before_minutes, close_after_minutes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'started')
     ON CONFLICT (course_id, session_date) DO UPDATE
       SET status='started', updated_at=now()
     RETURNING id`,
    [orgId, todayCourse.rows[0].id, iso(today), 'دکتر حسینی', '13:00', '15:00', 10, 15, 30],
  );

  const todayRoster = await client.query(
    `SELECT s.id FROM students s
     JOIN course_students cs ON cs.student_id=s.id
     WHERE cs.course_id=$1 AND s.status='active' ORDER BY s.student_number`,
    [todayCourse.rows[0].id],
  );
  for (const student of todayRoster.rows) {
    await client.query(
      `INSERT INTO session_students (session_id, student_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [open.rows[0].id, student.id],
    );
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status, method)
       VALUES ($1,$2,'unmarked','system')
       ON CONFLICT (session_id, student_id) DO NOTHING`,
      [open.rows[0].id, student.id],
    );
  }
});

console.log('Demo data is ready.');
console.log('Demo accounts:');
console.log('  admin@hozorban.local / Admin@123456');
console.log('  teacher@hozorban.local / Teacher@123456');
console.log('  student@hozorban.local / Student@123456');
await pool.end();

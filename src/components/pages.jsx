import React, { useEffect, useRef, useState } from "react";
import { Badge, EmptyState, Icon, PanelTitle, SkeletonCards, SkeletonTable, StatCard, StudentAvatar, TablePager } from "./shared.jsx";
import { JalaliDateInput } from "./JalaliDateInput.jsx";
import {
  LiveClassBanner,
  StudentCalendar,
} from "./phase2.jsx";
import { StudentExams } from "./StudentExams.jsx";
import { HelpChat } from "../help/HelpChat.jsx";
import {
  CLASSROOM_SCAN_INTERVAL_MS,
  FACE_SCAN_INTERVAL_MS,
  averageEyeRatio,
  createLivenessState,
  livenessPhaseLabel,
  tickLivenessLost,
  updateLiveness,
} from "../face/liveness.js";
import { playBeep as playUnknown, playSuccess } from "../audio/sfx.js";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { exportAttendanceExcel } from "../reports/exportAttendanceExcel.js";

const PRESENT_STATUS = "\u062d\u0627\u0636\u0631";
const ABSENT_STATUS = "\u063a\u0627\u06cc\u0628";
const LATE_STATUS = "\u062a\u0623\u062e\u06cc\u0631";

const METHOD_LABELS = {
  manual: "ثبت دستی",
  face: "تشخیص چهره",
  voice: "تشخیص صدا",
  class_camera: "دوربین کلاس",
  fingerprint: "اثر انگشت",
  system: "خودکار",
  auto: "خودکار",
};

// Persian labels for the admin activity feed (audit_logs).
const AUDIT_ACTION_LABELS = {
  create: "ایجاد",
  update: "تغییر",
  delete: "حذف",
  approve: "تأیید",
  reject: "رد",
  attach: "افزودن عضویت",
  detach: "حذف عضویت",
  finalize: "نهایی‌سازی",
  reset_password: "بازنشانی رمز",
  activate: "فعال‌سازی",
  deactivate: "غیرفعال‌سازی",
  import: "ورود داده",
};
const AUDIT_ACTION_TONES = {
  create: "success",
  update: "neutral",
  delete: "danger",
  approve: "success",
  reject: "danger",
  attach: "purple",
  detach: "warning",
  finalize: "success",
  reset_password: "purple",
  activate: "success",
  deactivate: "warning",
  import: "neutral",
};
const AUDIT_ENTITY_LABELS = {
  course: "درس",
  session: "جلسه",
  attendance: "حضور و غیاب",
  teacher: "استاد",
  registration: "درخواست ثبت‌نام",
  voice_sample: "نمونهٔ صدا",
  browser_snapshot: "بک‌آپ مرورگر",
};
const AUDIT_ENTITY_OPTIONS = [
  ["", "همهٔ موجودیت‌ها"],
  ...Object.entries(AUDIT_ENTITY_LABELS),
];
const ATTENDANCE_STATUS_FA = {
  present: "حاضر",
  late: "تأخیر",
  absent: "غایب",
  excused: "غیبت موجه",
  left_early: "خروج زودهنگام",
  unmarked: "ثبت‌نشده",
};
const AUDIT_FIELD_LABELS = {
  code: "کد",
  title: "عنوان",
  teacherName: "استاد",
  teacherId: "استاد",
  room: "کلاس",
  weekday: "روز",
  startTime: "شروع",
  endTime: "پایان",
};

function activityMetadataSummary(metadata) {
  if (!metadata || typeof metadata !== "object") return "—";
  const parts = [];
  if (metadata.fullName) parts.push(String(metadata.fullName));
  else if (metadata.studentName) parts.push(String(metadata.studentName));
  if (metadata.title) parts.push(String(metadata.title));
  if (metadata.code) parts.push(`کد ${metadata.code}`);
  if (metadata.email) parts.push(String(metadata.email));
  if (metadata.username) parts.push(`نام کاربری: ${metadata.username}`);
  if (metadata.status)
    parts.push(`وضعیت: ${ATTENDANCE_STATUS_FA[metadata.status] || metadata.status}`);
  if (metadata.method)
    parts.push(`روش: ${METHOD_LABELS[metadata.method] || metadata.method}`);
  if (metadata.absent != null)
    parts.push(`غایب: ${Number(metadata.absent).toLocaleString("fa-IR")}`);
  if (metadata.date) parts.push(String(metadata.date));
  if (Array.isArray(metadata.fields) && metadata.fields.length)
    parts.push(
      `تغییر فیلدها: ${metadata.fields
        .map((field) => AUDIT_FIELD_LABELS[field] || field)
        .join("، ")}`,
    );
  return parts.length ? parts.join(" · ") : "—";
}

function methodLabel(method) {
  return METHOD_LABELS[method] || "ثبت دستی";
}

function statusToneClass(status) {
  if ([PRESENT_STATUS, "حاضر"].includes(status)) return "is-present";
  if ([LATE_STATUS, "تأخیر"].includes(status)) return "is-late";
  if (status === "غیبت موجه") return "is-excused";
  if ([ABSENT_STATUS, "غایب"].includes(status)) return "is-absent";
  if (status === "خروج زودهنگام") return "is-left";
  return "is-muted";
}

function formatSessionDate(value) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeSearch(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(AR_DIGITS.indexOf(digit)))
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function attendanceStatusKind(status) {
  if ([PRESENT_STATUS, "حاضر", "خروج زودهنگام"].includes(status))
    return "present";
  if ([ABSENT_STATUS, "غایب", "غیبت موجه"].includes(status)) return "absent";
  if ([LATE_STATUS, "تأخیر", "با تأخیر"].includes(status)) return "late";
  return "unknown";
}

export function Dashboard({
  students,
  courses,
  attendance,
  onNavigate,
  onExport,
  accessRole = "admin",
}) {
  const today = new Date().toLocaleDateString("en-CA");

  // رکوردهای مربوط به امروز
  const todayAttendance = attendance.filter(
    (a) => a.sessionDate && String(a.sessionDate).slice(0, 10) === today,
  );

  // آمار کلی تمام سوابق
  const present = attendance.filter(
    (a) => attendanceStatusKind(a.status) === "present",
  ).length;

  const late = attendance.filter(
    (a) => attendanceStatusKind(a.status) === "late",
  ).length;

  const absent = attendance.filter(
    (a) => attendanceStatusKind(a.status) === "absent",
  ).length;

  // آمار امروز
  const todayPresent = todayAttendance.filter(
    (a) => attendanceStatusKind(a.status) === "present",
  ).length;

  const todayLate = todayAttendance.filter(
    (a) => attendanceStatusKind(a.status) === "late",
  ).length;

  const todayAbsent = todayAttendance.filter(
    (a) => attendanceStatusKind(a.status) === "absent",
  ).length;

  // درصدهای نمودار امروز
  const todayTotal = todayAttendance.length;
  const presentPercent = todayTotal
    ? Math.round((todayPresent / todayTotal) * 100)
    : 0;

  const latePercent = todayTotal
    ? Math.round((todayLate / todayTotal) * 100)
    : 0;

  // مرتب‌سازی آخرین رویدادها
  const latestAttendance = [...attendance]
    .sort((a, b) => {
      const dateA = `${a.sessionDate || ""} ${a.time || ""}`;
      const dateB = `${b.sessionDate || ""} ${b.time || ""}`;
      return dateB.localeCompare(dateA);
    })
    .slice(0, 5);

  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">نمای کلی سامانه</div>
          <h1>
            سلام، روز بخیر <span>✦</span>
          </h1>
          <p>در یک نگاه، وضعیت کلاس‌ها و حضور دانشجویان را بررسی کنید.</p>
        </div>

        <div className="welcome-actions">
          <button
            type="button"
            className="btn btn-light-outline"
            onClick={() => onNavigate("reports")}
          >
            <Icon name="bi-download" /> خروجی گزارش
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNavigate("manual")}
          >
            <Icon name="bi-plus-lg" /> ثبت حضور جدید
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          icon="bi-people"
          label="کل دانشجویان"
          value={students.length.toLocaleString("fa-IR")}
          detail="دانشجوی ثبت‌شده"
          trend=""
          color="blue"
        />

        <StatCard
          icon="bi-journal-bookmark"
          label="درس‌های فعال"
          value={courses.length.toLocaleString("fa-IR")}
          detail="در این نیم‌سال"
          trend=""
          color="purple"
        />

        <StatCard
          icon="bi-person-check"
          label="حاضرین امروز"
          value={todayPresent.toLocaleString("fa-IR")}
          detail="از ثبت‌های امروز"
          trend=""
          color="green"
        />

        <StatCard
          icon="bi-clock-history"
          label="تأخیر و غیبت امروز"
          value={(todayLate + todayAbsent).toLocaleString("fa-IR")}
          detail="نیازمند بررسی"
          trend=""
          color="orange"
        />
      </div>

      <div className="dashboard-grid">
        <section className="content-card attendance-overview">
          <div className="card-heading">
            <div>
              <h2>وضعیت حضور امروز</h2>
              <p>خلاصه وضعیت ثبت‌های امروز</p>
            </div>

            <button
              className="text-action"
              onClick={() => onNavigate("reports")}
            >
              مشاهده گزارش <Icon name="bi-arrow-left" />
            </button>
          </div>

          <div className="attendance-summary">
            <div className="donut-wrap">
              <div
                className={`donut-chart ${todayTotal === 0 ? "is-empty" : ""}`.trim()}
                style={{
                  "--present": `${presentPercent}%`,
                  "--late": `${latePercent}%`,
                }}
              >
                <div>
                  <strong>{presentPercent.toLocaleString("fa-IR")}٪</strong>
                  <small>حضور ثبت‌شده</small>
                </div>
              </div>
            </div>

            <div className="legend-list">
              <div>
                <span className="legend-dot present" />
                <span>حاضر</span>
                <strong>{todayPresent.toLocaleString("fa-IR")}</strong>
              </div>

              <div>
                <span className="legend-dot late" />
                <span>با تأخیر</span>
                <strong>{todayLate.toLocaleString("fa-IR")}</strong>
              </div>

              <div>
                <span className="legend-dot absent" />
                <span>غایب</span>
                <strong>{todayAbsent.toLocaleString("fa-IR")}</strong>
              </div>
            </div>
          </div>

          <div className="chart-footnote">
            <Icon name="bi-info-circle" />
            {todayTotal > 0
              ? `آمار بر اساس ${todayTotal.toLocaleString("fa-IR")} رکورد ثبت‌شده امروز محاسبه شده است.`
              : "هنوز هیچ رکورد حضور و غیابی برای امروز ثبت نشده است."}
          </div>
        </section>

        <section className="content-card quick-actions-card">
          <div className="card-heading">
            <div>
              <h2>دسترسی سریع</h2>
              <p>کارهای پرتکرار سامانه</p>
            </div>

            <span className="heading-icon">
              <Icon name="bi-lightning-charge" />
            </span>
          </div>

          <div className="quick-action-list">
            {accessRole === "admin" ? (
              <button onClick={() => onNavigate("students")}>
                <span className="quick-icon blue">
                  <Icon name="bi-person-plus" />
                </span>

                <span>
                  <strong>مدیریت دانشجویان</strong>
                  <small>افزودن و مشاهده فهرست دانشجویان</small>
                </span>

                <Icon name="bi-chevron-left" className="quick-arrow" />
              </button>
            ) : (
              <button onClick={() => onNavigate("sessions")}>
                <span className="quick-icon blue">
                  <Icon name="bi-calendar3" />
                </span>

                <span>
                  <strong>جلسات کلاس</strong>
                  <small>مشاهده و برنامه‌ریزی جلسه‌های آموزشی</small>
                </span>

                <Icon name="bi-chevron-left" className="quick-arrow" />
              </button>
            )}

            <button onClick={() => onNavigate("manual")}>
              <span className="quick-icon green">
                <Icon name="bi-clipboard-check" />
              </span>

              <span>
                <strong>ثبت حضور و غیاب</strong>
                <small>ثبت دستی وضعیت حضور کلاس</small>
              </span>

              <Icon name="bi-chevron-left" className="quick-arrow" />
            </button>

            <button onClick={() => onNavigate("face")}>
              <span className="quick-icon purple">
                <Icon name="bi-camera-video" />
              </span>

              <span>
                <strong>تشخیص چهره</strong>
                <small>شروع دوربین برای ثبت آزمایشی</small>
              </span>

              <Icon name="bi-chevron-left" className="quick-arrow" />
            </button>

            <button onClick={() => onNavigate("fingerprint")}>
              <span className="quick-icon rose">
                <Icon name="bi-fingerprint" />
              </span>

              <span>
                <strong>ثبت حضور با اثر انگشت</strong>
                <small>احراز هویت فیزیکی با حسگر اثر انگشت</small>
              </span>

              <Icon name="bi-chevron-left" className="quick-arrow" />
            </button>
          </div>
        </section>
      </div>

      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>آخرین وضعیت حضور و غیاب</h2>
            <p>آخرین رویدادهای ثبت‌شده در سامانه</p>
          </div>

          <button className="text-action" onClick={() => onNavigate("manual")}>
            مشاهده همه <Icon name="bi-arrow-left" />
          </button>
        </div>

        <AttendanceTable rows={latestAttendance} students={students} compact />
      </section>

      <section className="content-card courses-strip">
        <div className="card-heading">
          <div>
            <h2>کلاس‌های فعال</h2>
            <p>برنامه کلاس‌های این نیم‌سال</p>
          </div>

          <button className="text-action" onClick={() => onNavigate("courses")}>
            همه درس‌ها <Icon name="bi-arrow-left" />
          </button>
        </div>

        <div className="course-mini-grid">
          {courses.slice(0, 3).map((c, i) => (
            <div className="course-mini" key={c.id}>
              <div className={`course-color color-${i}`}>
                <Icon
                  name={["bi-code-slash", "bi-database", "bi-diagram-3"][i]}
                />
              </div>

              <div className="course-mini-info">
                <strong>{c.title}</strong>
                <small>{c.teacher}</small>

                <div>
                  <Icon name="bi-clock" /> {c.time}
                </div>
              </div>

              <span className="course-count">
                <Icon name="bi-people" /> {c.count.toLocaleString("fa-IR")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function Students({ students, query, setQuery, onAdd, onDelete, onSavePhoto, onImportStudents }) {
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  useEffect(() => {
    setPage(1);
  }, [query, students.length]);
  const pageCount = Math.max(1, Math.ceil(students.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleStudents = students.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  return (
    <>
      <PanelTitle
        eyebrow="مدیریت آموزشی"
        title="مدیریت دانشجویان"
        description="فهرست دانشجویان را مشاهده، جست‌وجو و مدیریت کنید."
        action={
          <div className="page-action-row">
            <button className="btn btn-primary" onClick={onAdd}>
              <Icon name="bi-plus-lg" /> افزودن دانشجو
            </button>
            <button
              className="btn btn-light-outline"
              onClick={() => setImportOpen(true)}
            >
              <Icon name="bi-file-earmark-spreadsheet" /> ایمپورت اکسل
            </button>
          </div>
        }
      />
      {importOpen ? (
        <ImportPanel
          kind="students"
          onImport={onImportStudents}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      <div className="content-card data-card">
        <div className="table-toolbar">
          <div className="search-wrap">
            <Icon name="bi-search" />
            <input
              className="form-control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجو بر اساس نام، شماره دانشجویی..."
            />
          </div>
          <span className="result-count">
            {students.length.toLocaleString("fa-IR")} دانشجو
          </span>
        </div>
        {students.length ? (
          <>
            <div className="table-responsive">
              <table className="table custom-table align-middle">
                <thead>
                  <tr>
                    <th>دانشجو</th>
                    <th>شماره دانشجویی</th>
                    <th>رشته تحصیلی</th>
                    <th>ترم</th>
                    <th>شماره تماس</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((s, i) => (
                    <tr key={s.id}>
                      <td>
                        <div className="student-cell">
                          <StudentAvatar
                            name={s.name}
                            photo={s.faceImage}
                            index={(safePage - 1) * pageSize + i}
                          />
                          <strong>{s.name}</strong>
                        </div>
                      </td>
                      <td className="id-cell">{s.id}</td>
                      <td>{s.major}</td>
                      <td>{s.term}</td>
                      <td>{s.phone || "—"}</td>
                      <td>
                        <Badge tone={s.status === "فعال" ? "success" : "neutral"}>
                          {s.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="student-actions-cell">
                          <label
                            className="row-action photo-action"
                            title={
                              s.faceImage
                                ? "تغییر عکس پروفایل"
                                : "ثبت عکس پروفایل"
                            }
                          >
                            <Icon
                              name={
                                s.faceImage ? "bi-pencil-square" : "bi-camera"
                              }
                            />
                            <input
                              type="file"
                              accept="image/*"
                              capture="user"
                              hidden
                              onChange={(event) => {
                                onSavePhoto?.(
                                  s.id,
                                  Array.from(event.target.files || []),
                                );
                                event.target.value = "";
                              }}
                            />
                          </label>
                          <button
                            className="row-action danger-action"
                            title="حذف دانشجو"
                            onClick={() => {
                              if (
                                window.confirm(`دانشجوی «${s.name}» حذف شود؟`)
                              )
                                onDelete(s.id);
                            }}
                          >
                            <Icon name="bi-trash3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager
              page={safePage}
              pageSize={pageSize}
              total={students.length}
              onPageChange={setPage}
              label="دانشجو"
            />
          </>
        ) : (
          <EmptyState
            icon="bi-search"
            title="دانشجویی پیدا نشد"
            text="عبارت جست‌وجو را تغییر دهید یا دانشجوی جدید اضافه کنید."
          />
        )}
      </div>
      <div className="page-note">
        <Icon name="bi-info-circle" /> اطلاعات در دیتابیس PostgreSQL ذخیره و در
        همهٔ بخش‌ها استفاده می‌شود؛ هر دانشجو فقط یک عکس پروفایل دارد که همان
        عکس مرجع تشخیص چهره نیز هست.
      </div>
    </>
  );
}
export function Courses({
  courses,
  students = [],
  teachers = [],
  canAssignTeacher = true,
  defaultTeacher = "",
  onNavigate,
  onAddCourse,
  onAssignTeacher,
  onPlanCourse,
  onImportCourses,
}) {
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignTeacherFor, setAssignTeacherFor] = useState("");
  const [courseForm, setCourseForm] = useState({
    id: "",
    title: "",
    teacher: defaultTeacher,
    teacherId: "",
    day: "شنبه",
    startTime: "10:00",
    endTime: "12:00",
    room: "",
    studentIds: [],
  });
  const [courseFormError, setCourseFormError] = useState("");
  const updateCourseForm = (key, value) =>
    setCourseForm((current) => ({ ...current, [key]: value }));
  const submitCourse = async (event) => {
    event.preventDefault();
    const course = {
      ...courseForm,
      id: courseForm.id.trim().toUpperCase(),
      title: courseForm.title.trim(),
      teacher: courseForm.teacher.trim(),
      room: courseForm.room.trim(),
    };
    if (!course.id || !course.title || !course.teacher || !course.room)
      return setCourseFormError("کد درس، نام درس، استاد و کلاس را کامل کنید.");
    if (course.startTime >= course.endTime)
      return setCourseFormError("ساعت پایان باید بعد از ساعت شروع باشد.");
    if (!course.studentIds.length)
      return setCourseFormError("حداقل یک دانشجو را به این کلاس اختصاص دهید.");
    const result = await onAddCourse?.({
      ...course,
      time: `${course.day}، ${course.startTime} تا ${course.endTime}`,
      count: course.studentIds.length,
    });
    if (result === false) return;
    setCourseForm({
      id: "",
      title: "",
      teacher: defaultTeacher,
      teacherId: "",
      day: "شنبه",
      startTime: "10:00",
      endTime: "12:00",
      room: "",
      studentIds: [],
    });
    setCourseFormError("");
    setShowCourseForm(false);
  };
  return (
    <>
      <PanelTitle
        eyebrow="مدیریت آموزشی"
        title="درس‌ها و کلاس‌ها"
        description="اطلاعات درس‌ها، استادان و زمان‌بندی کلاس‌ها."
        action={
          <div className="course-page-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setCourseFormError("");
                setShowCourseForm((value) => !value);
              }}
            >
              <Icon name="bi-plus-lg" /> افزودن کلاس
            </button>
            <button
              className="btn btn-light-outline"
              onClick={() => onNavigate("sessions")}
            >
              <Icon name="bi-calendar-plus" /> مشاهده جلسات
            </button>
            <button
              className="btn btn-light-outline"
              onClick={() => setImportOpen(true)}
            >
              <Icon name="bi-file-earmark-spreadsheet" /> ایمپورت اکسل
            </button>
          </div>
        }
      />
      {importOpen ? (
        <ImportPanel
          kind="courses"
          onImport={onImportCourses}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {showCourseForm && (
        <form
          className="content-card course-create-card"
          onSubmit={submitCourse}
        >
          <div className="card-heading">
            <div>
              <h3>تعریف درس و کلاس جدید</h3>
              <p>
                اطلاعات این کلاس در برنامه جلسات، حضور و غیاب و گزارش‌ها استفاده
                می‌شود.
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="بستن فرم"
              onClick={() => setShowCourseForm(false)}
            >
              <Icon name="bi-x-lg" />
            </button>
          </div>
          <div className="course-form-grid">
            <label className="form-label">
              کد درس
              <input
                className="form-control"
                value={courseForm.id}
                maxLength={20}
                onChange={(event) => updateCourseForm("id", event.target.value)}
                placeholder="مثلاً CS401"
              />
            </label>
            <label className="form-label">
              نام درس
              <input
                className="form-control"
                value={courseForm.title}
                maxLength={80}
                onChange={(event) =>
                  updateCourseForm("title", event.target.value)
                }
                placeholder="نام درس"
              />
            </label>
            {canAssignTeacher && teachers.length > 0 ? (
              <label className="form-label">
                استاد
                <select
                  className="form-select"
                  value={courseForm.teacherId}
                  onChange={(event) => {
                    const teacher = teachers.find(
                      (item) => item.id === event.target.value,
                    );
                    setCourseForm((current) => ({
                      ...current,
                      teacherId: event.target.value,
                      teacher: teacher?.fullName || "",
                    }));
                  }}
                >
                  <option value="">— انتخاب استاد —</option>
                  {teachers
                    .filter((teacher) => teacher.isActive)
                    .map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.fullName}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label className="form-label">
                استاد
                <input
                  className="form-control"
                  value={courseForm.teacher}
                  maxLength={80}
                  readOnly={!canAssignTeacher}
                  onChange={(event) =>
                    updateCourseForm("teacher", event.target.value)
                  }
                  placeholder="نام استاد"
                />
              </label>
            )}
            <label className="form-label">
              کلاس / مکان
              <input
                className="form-control"
                value={courseForm.room}
                maxLength={60}
                onChange={(event) =>
                  updateCourseForm("room", event.target.value)
                }
                placeholder="مثلاً کلاس ۲۰۵"
              />
            </label>
            <label className="form-label">
              روز هفته
              <select
                className="form-select"
                value={courseForm.day}
                onChange={(event) =>
                  updateCourseForm("day", event.target.value)
                }
              >
                {[
                  "شنبه",
                  "یکشنبه",
                  "دوشنبه",
                  "سه‌شنبه",
                  "چهارشنبه",
                  "پنجشنبه",
                  "جمعه",
                ].map((day) => (
                  <option key={day}>{day}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              ساعت شروع
              <input
                className="form-control"
                type="time"
                value={courseForm.startTime}
                onChange={(event) =>
                  updateCourseForm("startTime", event.target.value)
                }
                required
              />
            </label>
            <label className="form-label">
              ساعت پایان
              <input
                className="form-control"
                type="time"
                value={courseForm.endTime}
                onChange={(event) =>
                  updateCourseForm("endTime", event.target.value)
                }
                required
              />
            </label>
          </div>
          <fieldset className="course-student-picker">
            <legend>دانشجویان این کلاس</legend>
            <div>
              {students
                .filter((student) => student.status !== "غیرفعال")
                .map((student) => (
                  <label key={student.id}>
                    <input
                      type="checkbox"
                      checked={courseForm.studentIds.includes(student.id)}
                      onChange={(event) =>
                        updateCourseForm(
                          "studentIds",
                          event.target.checked
                            ? [
                                ...new Set([
                                  ...courseForm.studentIds,
                                  student.id,
                                ]),
                              ]
                            : courseForm.studentIds.filter(
                                (id) => id !== student.id,
                              ),
                        )
                      }
                    />{" "}
                    <span>
                      {student.name}
                      <small>{student.id}</small>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
          {courseFormError && (
            <p className="course-form-error" role="alert">
              {courseFormError}
            </p>
          )}
          <div className="course-form-footer">
            <span>
              {courseForm.studentIds.length.toLocaleString("fa-IR")} دانشجو
              انتخاب شده
            </span>
            <button
              type="button"
              className="btn btn-light-outline"
              onClick={() => setShowCourseForm(false)}
            >
              انصراف
            </button>
            <button type="submit" className="btn btn-primary">
              <Icon name="bi-check2" /> ذخیره کلاس
            </button>
          </div>
        </form>
      )}
      {courses.length ? (
        <div className="course-grid">
          {courses.map((c, i) => (
            <div className="content-card course-card" key={c.id}>
              <div className={`course-banner banner-${i % 4}`}>
                <span className="course-color">
                  <Icon
                    name={
                      [
                        "bi-code-slash",
                        "bi-database",
                        "bi-diagram-3",
                        "bi-calculator",
                      ][i % 4]
                    }
                  />
                </span>
                <span className="course-code">{c.id}</span>
              </div>
              <div className="course-card-body">
                <Badge>فعال</Badge>
                <h3>{c.title}</h3>
                <div className="course-teacher">
                  <span className="teacher-avatar">{c.teacher.charAt(0)}</span>
                  <span>{c.teacher}</span>
                </div>
                {canAssignTeacher && teachers.length > 0 && c.databaseId && (
                  c.teacherUserId && assignTeacherFor !== c.id ? (
                    <button
                      type="button"
                      className="course-teacher-edit"
                      onClick={() => setAssignTeacherFor(c.id)}
                    >
                      <Icon name="bi-pencil-square" /> تغییر استاد
                    </button>
                  ) : (
                    <label className="course-teacher-assign">
                      <span>استاد درس</span>
                      <select
                        className="form-select"
                        value={c.teacherUserId || ""}
                        onChange={(event) => {
                          onAssignTeacher?.(c.databaseId, event.target.value || null);
                          setAssignTeacherFor("");
                        }}
                      >
                        <option value="">— بدون استاد —</option>
                        {teachers
                          .filter((teacher) => teacher.isActive)
                          .map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.fullName}
                            </option>
                          ))}
                      </select>
                    </label>
                  )
                )}
                <div className="course-detail">
                  <span>
                    <Icon name="bi-clock" />
                    {c.time}
                  </span>
                  <span>
                    <Icon name="bi-geo-alt" />
                    {c.room}
                  </span>
                  <span>
                    <Icon name="bi-people" />
                    {c.count.toLocaleString("fa-IR")} دانشجو
                  </span>
                </div>
                <button
                  className="btn btn-light-outline w-100"
                  onClick={() => onNavigate("manual")}
                >
                  ثبت حضور این درس <Icon name="bi-arrow-left" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="bi-journal-x"
          title="درسی ثبت نشده است"
          text="از دکمهٔ افزودن کلاس برای تعریف درس و اختصاص دانشجو استفاده کنید."
        />
      )}
    </>
  );
}
export { Sessions } from "./Sessions.jsx";
export function ManualAttendance({
  attendance,
  students = [],
  query,
  setQuery,
  courses,
  courseFilter,
  setCourseFilter,
  onStatus,
  onExport,
}) {
  const [reason, setReason] = useState("");
  const photoById = new Map(
    students.map((student) => [String(student.id), student.faceImage || ""]),
  );
  return (
    <>
      <PanelTitle
        eyebrow="ثبت حضور و غیاب"
        title="ثبت دستی حضور"
        description="وضعیت حضور دانشجویان را برای هر کلاس ثبت و اصلاح کنید."
        action={
          <button className="btn btn-light-outline" onClick={onExport}>
            <Icon name="bi-download" /> خروجی CSV
          </button>
        }
      />
      <div className="content-card data-card">
        <div className="table-toolbar toolbar-wrap">
          <div className="search-wrap">
            <Icon name="bi-search" />
            <input
              className="form-control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی نام یا شماره دانشجویی"
            />
          </div>
          <select
            className="form-select filter-select"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
          >
            <option>همه درس‌ها</option>
            {courses.map((c) => (
              <option key={c.id}>{c.title}</option>
            ))}
          </select>
          <span className="result-count">
            {attendance.length.toLocaleString("fa-IR")} رکورد
          </span>
        </div>
        <div className="attendance-edit-reason">
          <label htmlFor="attendance-edit-reason">
            دلیل اصلاح وضعیت (اختیاری)
          </label>
          <input
            id="attendance-edit-reason"
            className="form-control"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثلاً ارائهٔ گواهی پزشکی"
          />
        </div>
        <div className="table-responsive">
          <table className="table custom-table align-middle">
            <thead>
              <tr>
                <th>دانشجو</th>
                <th>شماره دانشجویی</th>
                <th>درس</th>
                <th>تاریخ جلسه</th>
                <th>ساعت ثبت</th>
                <th>وضعیت فعلی</th>
                <th>تغییر وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((a, i) => (
                <tr key={`${a.id}-${a.course}-${a.sessionId || a.sessionDate || i}`}>
                  <td>
                    <div className="student-cell">
                      <StudentAvatar
                        name={a.name}
                        photo={photoById.get(String(a.id)) || ""}
                        index={i}
                      />
                      <strong>{a.name}</strong>
                    </div>
                  </td>
                  <td className="id-cell">{a.id}</td>
                  <td>{a.course}</td>
                  <td dir="ltr">{formatSessionDate(a.sessionDate)}</td>
                  <td>{a.time}</td>
                  <td>
                    <Badge
                      tone={
                        attendanceStatusKind(a.status) === "present"
                          ? "success"
                          : attendanceStatusKind(a.status) === "late"
                            ? "warning"
                            : attendanceStatusKind(a.status) === "absent"
                              ? "danger"
                              : "neutral"
                      }
                    >
                      {a.status}
                    </Badge>
                  </td>
                  <td>
                    <div className="attendance-actions">
                      <button
                        className={`mini-status present ${attendanceStatusKind(a.status) === "present" ? "selected" : ""}`}
                        onClick={() =>
                          onStatus(a.id, "حاضر", a.course, a.sessionId, reason)
                        }
                        title="حاضر"
                      >
                        <Icon name="bi-check2" />
                      </button>
                      <button
                        className={`mini-status late ${attendanceStatusKind(a.status) === "late" ? "selected" : ""}`}
                        onClick={() =>
                          onStatus(a.id, "تأخیر", a.course, a.sessionId, reason)
                        }
                        title="تأخیر"
                      >
                        <Icon name="bi-clock" />
                      </button>
                      <button
                        className={`mini-status absent ${attendanceStatusKind(a.status) === "absent" ? "selected" : ""}`}
                        onClick={() =>
                          onStatus(a.id, "غایب", a.course, a.sessionId, reason)
                        }
                        title="غایب"
                      >
                        <Icon name="bi-x-lg" />
                      </button>
                      <button
                        className={`mini-status absent ${a.status === "غیبت موجه" ? "selected" : ""}`}
                        onClick={() =>
                          onStatus(
                            a.id,
                            "غیبت موجه",
                            a.course,
                            a.sessionId,
                            reason,
                          )
                        }
                        title="غیبت موجه"
                      >
                        <Icon name="bi-file-earmark-medical" />
                      </button>
                      <button
                        className={`mini-status late ${a.status === "خروج زودهنگام" ? "selected" : ""}`}
                        onClick={() =>
                          onStatus(
                            a.id,
                            "خروج زودهنگام",
                            a.course,
                            a.sessionId,
                            reason,
                          )
                        }
                        title="خروج زودهنگام"
                      >
                        <Icon name="bi-box-arrow-right" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!attendance.length && (
                <tr>
                  <td colSpan="7">
                    <EmptyState
                      icon="bi-clipboard-x"
                      title="رکوردی برای نمایش نیست"
                      text="فیلتر درس یا عبارت جست‌وجو را تغییر دهید؛ با شروع جلسه رکوردهای حضور ایجاد می‌شوند."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-bottom">
          <span>
            <Icon name="bi-info-circle" /> برای تغییر وضعیت از دکمه‌های هر ردیف
            استفاده کنید.
          </span>
          <span>نمایش {attendance.length.toLocaleString("fa-IR")} مورد</span>
        </div>
      </div>
    </>
  );
}
export function AttendanceTable({ rows, students = [], compact = false }) {
  const photoById = new Map(
    students.map((student) => [String(student.id), student.faceImage || ""]),
  );
  if (!rows?.length)
    return (
      <EmptyState
        icon="bi-clipboard-x"
        title="هنوز رکورد حضوری ثبت نشده"
        text="پس از شروع جلسه و ثبت وضعیت دانشجویان، گزارش اینجا نمایش داده می‌شود."
      />
    );
  return (
    <div className="table-responsive">
      <table
        className={`table custom-table align-middle ${compact ? "compact-table" : ""}`}
      >
        <thead>
          <tr>
            <th>دانشجو</th>
            <th>درس</th>
            <th>ساعت</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr
              key={`${a.id}-${a.course}-${a.sessionId || a.sessionDate || a.time || i}`}
            >
              <td>
                <div className="student-cell">
                  <StudentAvatar
                    name={a.name}
                    photo={photoById.get(String(a.id)) || ""}
                    index={i}
                  />
                  <div>
                    <strong>{a.name}</strong>
                    <small className="student-id-small">{a.id}</small>
                  </div>
                </div>
              </td>
              <td>{a.course}</td>
              <td>{a.time}</td>
              <td>
                <Badge
                  tone={
                    attendanceStatusKind(a.status) === "present"
                      ? "success"
                      : attendanceStatusKind(a.status) === "late"
                        ? "warning"
                        : attendanceStatusKind(a.status) === "absent"
                          ? "danger"
                          : "neutral"
                  }
                >
                  {a.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FaceAttendance({
  variant = "face",
  courses,
  students,
  attendance,
  sessionCourse,
  setSessionCourse,
  sessionDate,
  setSessionDate,
  sessionId,
  onSaveStudentPhoto,
  onMarkAttendance,
  onRecognitionNotice,
  cameraState,
  cameras = [],
  selectedCameraId = "",
  onSelectCamera,
  videoRef,
  streamRef,
  startCamera,
  stopCamera,
}) {
  const classroomMode = variant === "classroom";
  const [modelStatus, setModelStatus] = React.useState("loading");
  const [faceDescriptors, setFaceDescriptors] = React.useState([]);
  const [descriptorsStatus, setDescriptorsStatus] = React.useState("idle");
  const [unusablePhotos, setUnusablePhotos] = React.useState(0);
  const [recognitionMessage, setRecognitionMessage] = React.useState(
    "در حال آماده‌سازی دوربین",
  );
  const [lastRecognized, setLastRecognized] = React.useState(null);
  const [faceBoxes, setFaceBoxes] = React.useState([]);
  const [attendancePopup, setAttendancePopup] = React.useState(null);
  const faceApiRef = React.useRef(null);
  const scanBusyRef = React.useRef(false);
  const notifiedSessionRef = React.useRef(new Set());
  const notifiedLivenessRef = React.useRef(new Set());
  const attendanceRef = React.useRef(attendance);
  const studentsRef = React.useRef(students);
  const markAttendanceRef = React.useRef(onMarkAttendance);
  const recognitionNoticeRef = React.useRef(onRecognitionNotice);
  const lastUnknownNoticeRef = React.useRef(0);
  const recognitionStreakRef = React.useRef(new Map());
  const livenessRef = React.useRef(new Map());
  attendanceRef.current = attendance;
  studentsRef.current = students;
  markAttendanceRef.current = onMarkAttendance;
  recognitionNoticeRef.current = onRecognitionNotice;

  useEffect(() => {
    let cancelled = false;
    import("@vladmandic/face-api")
      .then((faceapi) => {
        faceApiRef.current = faceapi;
        return Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
          faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
        ]);
      })
      .then(() => {
        if (!cancelled) setModelStatus("ready");
      })
      .catch((error) => {
        console.error("Face recognition models failed to load", error);
        if (!cancelled) setModelStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // فقط وقتی عکس پروفایل‌ها واقعاً عوض شود بازسازی می‌شود؛ بارگذاری مجدد
  // دیتابیس پس از هر ثبت حضور، دیسکریپتورها را دوباره نمی‌سازد (صرفه‌جویی در منابع).
  const photoKey = students
    .map((student) => `${student.id}:${student.faceImage || ""}`)
    .join("|");

  useEffect(() => {
    if (modelStatus !== "ready") return;
    let cancelled = false;
    const faceapi = faceApiRef.current;
    if (!faceapi) return;
    setDescriptorsStatus("loading");
    setFaceDescriptors([]);
    setUnusablePhotos(0);
    async function buildDescriptors() {
      const registered = [];
      let invalid = 0;
      for (const student of studentsRef.current) {
        // فقط یک عکس پروفایلی برای هر دانشجو مبناست (همان عکسی که در کل پروژه دیده می‌شود).
        const photos = student.faceImage ? [student.faceImage] : [];
        for (const photo of photos) {
          try {
            const image = await faceapi.fetchImage(photo);
            const result = await faceapi
              .detectSingleFace(
                image,
                new faceapi.TinyFaceDetectorOptions({
                  inputSize: 320,
                  scoreThreshold: 0.45,
                }),
              )
              .withFaceLandmarks(true)
              .withFaceDescriptor();
            if (result)
              registered.push({
                studentId: student.id,
                descriptor: result.descriptor,
              });
            else invalid += 1;
          } catch {
            invalid += 1;
          }
        }
      }
      if (!cancelled) {
        setFaceDescriptors(registered);
        setUnusablePhotos(invalid);
        setDescriptorsStatus("ready");
      }
    }
    buildDescriptors();
    return () => {
      cancelled = true;
    };
  }, [modelStatus, photoKey]);

  useEffect(() => {
    setLastRecognized(null);
    setFaceBoxes([]);
    setAttendancePopup(null);
    recognitionStreakRef.current.clear();
    livenessRef.current.clear();
    notifiedSessionRef.current.clear();
    notifiedLivenessRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    if (cameraState !== "live") {
      recognitionStreakRef.current.clear();
      livenessRef.current.clear();
    }
  }, [cameraState]);

  useEffect(() => {
    if (!attendancePopup) return undefined;
    const timer = window.setTimeout(() => setAttendancePopup(null), 4200);
    return () => window.clearTimeout(timer);
  }, [attendancePopup]);

  useEffect(() => {
    if (cameraState !== "live" || modelStatus !== "ready") return;
    let cancelled = false;
    const faceapi = faceApiRef.current;
    if (!faceapi) return;
    async function scanFrame() {
      if (cancelled || scanBusyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      scanBusyRef.current = true;
      try {
        const results = await faceapi
          .detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 320,
              scoreThreshold: 0.5,
            }),
          )
          .withFaceLandmarks(true)
          .withFaceDescriptors();
        if (cancelled) return;
        if (!results.length) {
          recognitionStreakRef.current.clear();
          for (const [key, liveness] of livenessRef.current.entries())
            if (!tickLivenessLost(liveness, false)) livenessRef.current.delete(key);
          if (classroomMode) setFaceBoxes([]);
          const noFaceMessage = classroomMode
            ? "چهره‌ای در کادر نیست؛ نور و زاویهٔ دوربین را بررسی کنید."
            : "چهره دیده نشد؛ نور روبه‌رو را بیشتر کنید و فقط یک نفر مقابل دوربین بایستد.";
          setRecognitionMessage((current) =>
            current === noFaceMessage ? current : noFaceMessage,
          );
          return;
        }
        const view = video.parentElement;
        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        const box = view?.getBoundingClientRect();
        const scale = box ? Math.max(box.width / vw, box.height / vh) : 1;
        const cropX = box ? (vw * scale - box.width) / 2 : 0;
        const cropY = box ? (vh * scale - box.height) / 2 : 0;
        const currentIds = new Set();
        const claimed = new Set();
        let livenessHint = null;
        const nextBoxes = results.map((result, faceIndex) => {
          const studentDistances = new Map();
          for (const reference of faceDescriptors) {
            const distance = faceapi.euclideanDistance(
              result.descriptor,
              reference.descriptor,
            );
            const previous = studentDistances.get(reference.studentId);
            if (previous == null || distance < previous)
              studentDistances.set(reference.studentId, distance);
          }
          const ranked = [...studentDistances].sort((a, b) => a[1] - b[1]);
          const best = ranked.length ? { studentId: ranked[0][0] } : null;
          const nearest = ranked[0]?.[1] ?? Infinity;
          const second = ranked[1]?.[1] ?? Infinity;
          const reliable =
            best &&
            nearest < 0.54 &&
            (second === Infinity || second - nearest > 0.035) &&
            !claimed.has(best.studentId);
          const student = reliable
            ? studentsRef.current.find((item) => item.id === best.studentId)
            : null;
          let tone = "unknown";
          let label = "ناشناس";
          if (student) {
            const key = String(student.id);
            currentIds.add(key);
            claimed.add(student.id);
            const streak = (recognitionStreakRef.current.get(key) || 0) + 1;
            recognitionStreakRef.current.set(key, streak);
            let liveness = null;
            if (!classroomMode) {
              liveness = livenessRef.current.get(key);
              if (!liveness) {
                liveness = createLivenessState();
                livenessRef.current.set(key, liveness);
              }
              liveness.lostFrames = 0;
              if (!liveness.verified)
                // ماشین وضعیت پلک (کالیبره → بسته → باز → تأیید) از face/liveness.js
                updateLiveness(liveness, averageEyeRatio(result.landmarks));
            }
            label = student.name;
            const existing = attendanceRef.current.find(
              (item) =>
                item.sessionId === sessionId &&
                String(item.id) === String(student.id),
            );
            if (["حاضر", "تأخیر", "با تأخیر"].includes(existing?.status)) {
              tone = "recognized";
              label = `${student.name} · ${existing.status}`;
              const noticeKey = `${sessionId}:${student.id}`;
              if (
                !classroomMode &&
                !notifiedSessionRef.current.has(noticeKey)
              ) {
                notifiedSessionRef.current.add(noticeKey);
                setAttendancePopup({
                  name: student.name,
                  status: "حضور این جلسه قبلاً ثبت شده",
                  time: existing.time || "",
                });
              }
            } else if (!classroomMode && !liveness.verified) {
              // وضعیت قبلی (غایب/غیبت موجه/…) مانع نیست؛ با پلک‌تائید شدن، حضور ثبت می‌شود.
              tone = "review";
              livenessHint = livenessPhaseLabel(liveness);
              label = `${student.name} · ${livenessHint}`;
              const livenessNoticeKey = `${sessionId}:${student.id}`;
              if (!notifiedLivenessRef.current.has(livenessNoticeKey)) {
                notifiedLivenessRef.current.add(livenessNoticeKey);
                recognitionNoticeRef.current?.(
                  `${student.name} شناسایی شد؛ برای ثبت حضور یک‌بار پلک بزنید.`,
                );
              }
            } else if (streak >= (classroomMode ? 1 : 2) || liveness.verified) {
              const noticeKey = `${sessionId}:${student.id}`;
              if (!notifiedSessionRef.current.has(noticeKey)) {
                notifiedSessionRef.current.add(noticeKey);
                const saved = markAttendanceRef.current(
                  student.id,
                  PRESENT_STATUS,
                  { silent: !classroomMode, method: "face" },
                );
                if (saved) {
                  tone = "recognized";
                  label = `${student.name} · ثبت شد`;
                  playSuccess();
                  setLastRecognized({
                    studentId: student.id,
                    name: student.name,
                  });
                  recognitionNoticeRef.current?.(
                    `حضور ${student.name} با موفقیت در این جلسه ثبت شد.`,
                  );
                  if (!classroomMode) {
                    const time = new Intl.DateTimeFormat("fa-IR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date());
                    setAttendancePopup({
                      name: student.name,
                      status: "حضور این جلسه ثبت شد",
                      time,
                    });
                  }
                } else {
                  tone = "review";
                  label = `${student.name} · ثبت نشد`;
                }
              } else {
                tone = "review";
                label = `${student.name} · در انتظار ثبت`;
              }
            } else {
              tone = "review";
              label = `${student.name} · در حال تطبیق`;
            }
          }
          const face = result.detection.box;
          let left = face.x * scale - cropX;
          const top = face.y * scale - cropY;
          const width = face.width * scale;
          const height = face.height * scale;
          if (box && video.videoWidth) left = box.width - left - width;
          return {
            key: student ? `student-${student.id}` : `unknown-${faceIndex}`,
            left: `${Math.max(0, (left / (box?.width || 1)) * 100)}%`,
            top: `${Math.max(0, (top / (box?.height || 1)) * 100)}%`,
            width: `${Math.min(100, (width / (box?.width || 1)) * 100)}%`,
            height: `${Math.min(100, (height / (box?.height || 1)) * 100)}%`,
            tone,
            label,
          };
        });
        for (const key of recognitionStreakRef.current.keys())
          if (!currentIds.has(key)) recognitionStreakRef.current.delete(key);
        for (const [key, liveness] of livenessRef.current.entries()) {
          if (!currentIds.has(key) && !tickLivenessLost(liveness, true))
            livenessRef.current.delete(key);
        }
        if (classroomMode) setFaceBoxes(nextBoxes);
        if (!faceDescriptors.length) {
          setRecognitionMessage(
            "چهره دیده شد؛ ابتدا عکس مرجع دانشجویان را ثبت کنید",
          );
        } else if (livenessHint) {
          setRecognitionMessage(
            livenessHint.includes("پلک بزنید")
              ? "هویت تطبیق شد؛ برای تأیید زنده‌بودن یک‌بار پلک بزنید"
              : livenessHint,
          );
        } else if (!nextBoxes.some((item) => item.tone === "recognized")) {
          const unknownMessage =
            "چهره با عکس مرجع تطبیق نشد؛ روبه‌روی دوربین بمانید و یک‌بار پلک بزنید. اگر باز هم شناسایی نشدید، عکس مرجع را بررسی کنید.";
          setRecognitionMessage(unknownMessage);
        } else {
          setRecognitionMessage("چهره شناسایی و حضور در جلسه ثبت شده است");
        }
        if (nextBoxes.some((item) => item.tone === "unknown")) {
          playUnknown();
          const unknownMessage =
            "چهره با عکس مرجع تطبیق نشد؛ روبه‌روی دوربین بمانید و یک‌بار پلک بزنید. اگر باز هم شناسایی نشدید، عکس مرجع را بررسی کنید.";
          setRecognitionMessage((current) =>
            current === unknownMessage ? current : unknownMessage,
          );
          const now = Date.now();
          if (now - lastUnknownNoticeRef.current >= 5000) {
            lastUnknownNoticeRef.current = now;
            recognitionNoticeRef.current?.(unknownMessage);
          }
        }
      } catch (error) {
        console.error("Face recognition frame failed", error);
        if (Date.now() - lastUnknownNoticeRef.current >= 5000) {
          lastUnknownNoticeRef.current = Date.now();
          const message =
            "پردازش تصویر با خطا روبه‌رو شد؛ دوربین را ببندید، نور و مجوز مرورگر را بررسی و دوباره تلاش کنید.";
          setRecognitionMessage(message);
          recognitionNoticeRef.current?.(message);
        }
      } finally {
        scanBusyRef.current = false;
      }
    }
    // فاصلهٔ کوتاه لازم است تا پلک ۱۰۰–۴۰۰ میلی‌ثانیه‌ای بین فریم‌ها از دست نرود.
    const timer = window.setInterval(
      scanFrame,
      classroomMode ? CLASSROOM_SCAN_INTERVAL_MS : FACE_SCAN_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    cameraState,
    modelStatus,
    faceDescriptors,
    sessionId,
    videoRef,
    classroomMode,
    sessionCourse,
  ]);

  const usableReferenceCount = new Set(
    faceDescriptors.map((item) => item.studentId),
  ).size;
  const sessionReady = Boolean(sessionCourse && sessionDate);
  const referenceError =
    descriptorsStatus === "ready" &&
    faceDescriptors.length === 0 &&
    unusablePhotos > 0;
  const faceSteps = [
    {
      icon: "bi-calendar2-check",
      title: "انتخاب کلاس و تاریخ",
      detail: sessionReady
        ? `${sessionCourse} · ${formatSessionDate(sessionDate)}`
        : "کلاس و تاریخ جلسه را در تنظیمات انتخاب کنید",
      status: sessionReady ? "done" : "active",
    },
    {
      icon: "bi-images",
      title: "ثبت عکس مرجع",
      detail:
        modelStatus === "error"
          ? "مدل تشخیص بارگذاری نشد؛ عکس‌ها فعلاً قابل بررسی نیستند"
          : modelStatus !== "ready"
            ? "در انتظار آماده‌شدن مدل تشخیص"
            : descriptorsStatus === "loading"
              ? "در حال بررسی عکس‌های ذخیره‌شده"
              : usableReferenceCount
                ? `${usableReferenceCount.toLocaleString("fa-IR")} دانشجو دارای تصویر قابل تطبیق است`
                : referenceError
                  ? `${unusablePhotos.toLocaleString("fa-IR")} عکس قابل استفاده نبود؛ عکس واضح‌تری ثبت کنید`
                  : "از فهرست پایین برای هر دانشجو عکس روبه‌رو و روشن ثبت کنید",
      status:
        modelStatus === "error"
          ? "error"
          : descriptorsStatus === "ready" && usableReferenceCount > 0
            ? "done"
            : referenceError
              ? "error"
              : "active",
    },
    {
      icon: "bi-cpu",
      title: "آماده‌سازی مدل تشخیص",
      detail:
        modelStatus === "ready"
          ? "مدل‌های تشخیص و تطبیق در مرورگر آماده‌اند"
          : modelStatus === "error"
            ? "مدل بارگذاری نشد؛ اتصال و فایل‌های مدل را بررسی کنید"
            : "مدل‌های تشخیص در حال بارگذاری هستند",
      status:
        modelStatus === "ready"
          ? "done"
          : modelStatus === "error"
            ? "error"
            : "active",
    },
    {
      icon: "bi-camera-video",
      title: "روشن‌کردن دوربین و ثبت حضور",
      detail:
        cameraState === "error"
          ? "دسترسی دوربین برقرار نشد؛ مجوز مرورگر را بررسی کنید"
          : lastRecognized
            ? `حضور ${lastRecognized.name} در این جلسه شناسایی و ثبت شد`
            : cameraState === "live"
              ? faceDescriptors.length
                ? "جلوی دوربین بایستید؛ تطبیق چهره به‌صورت خودکار انجام می‌شود"
                : "دوربین روشن است؛ برای تطبیق ابتدا عکس مرجع ثبت کنید"
              : "پس از آماده‌شدن مدل و ثبت عکس مرجع، دوربین را فعال کنید",
      status:
        cameraState === "error"
          ? "error"
          : lastRecognized
            ? "done"
            : cameraState === "live"
              ? "active"
              : "pending",
    },
  ];

  useEffect(() => {
    if (cameraState === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState, videoRef, streamRef]);

  return (
    <>
      <PanelTitle
        eyebrow="حضور و غیاب هوشمند"
        title={classroomMode ? "دوربین کلاس" : "تشخیص چهره"}
        description={
          classroomMode
            ? "پایش زندهٔ چهره‌های حاضر در کلاس و ثبت نتیجه در فهرست همین جلسه."
            : "دوربین را فعال کنید و محیط آماده شناسایی آزمایشی را بررسی کنید."
        }
        action={
          <Badge tone="purple">
            {classroomMode ? "پایش زنده" : "نسخه نمایشی"}
          </Badge>
        }
      />
      <div className="face-layout">
        <section className="content-card camera-card">
          <div className="card-heading">
            <div>
              <h3>نمای زنده دوربین</h3>
              <p>برای استفاده از وب‌کم، اجازه دسترسی مرورگر را تأیید کنید.</p>
            </div>
            <span
              className={`camera-status ${cameraState === "live" ? "is-live" : ""}`}
            >
              <span />{" "}
              {cameraState === "live" ? "دوربین فعال" : "دوربین غیرفعال"}
            </span>
          </div>
          <div
            className={`camera-view ${cameraState === "live" ? "camera-live" : ""}`}
          >
            {cameraState === "live" ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted />
                <div
                  className={
                    "camera-overlay " +
                    (!classroomMode ? "camera-overlay-scan" : "")
                  }
                >
                  {!classroomMode && (
                    <>
                      <span className="scan-corner tl" />
                      <span className="scan-corner tr" />
                      <span className="scan-corner bl" />
                      <span className="scan-corner br" />
                      <div className="scan-line" />
                    </>
                  )}
                  {!classroomMode && (
                    <span className="scan-label">
                      <Icon
                        name={
                          modelStatus === "error"
                            ? "bi-exclamation-triangle"
                            : modelStatus !== "ready" ||
                                descriptorsStatus === "loading"
                              ? "bi-hourglass-split"
                              : recognitionMessage.includes("ثبت شده")
                                ? "bi-check-circle"
                                : "bi-broadcast"
                        }
                      />
                      {modelStatus === "error"
                        ? "مدل تشخیص بارگذاری نشد"
                        : modelStatus !== "ready"
                          ? "در حال آماده‌سازی مدل تشخیص"
                          : descriptorsStatus === "loading"
                            ? "در حال بررسی عکس‌های مرجع"
                            : !faceDescriptors.length
                              ? "چهره دیده شد؛ ابتدا عکس مرجع ثبت کنید"
                              : recognitionMessage}
                    </span>
                  )}
                </div>
                {classroomMode && (
                  <div className="face-box-layer" aria-live="polite">
                    {faceBoxes.map((face) => (
                      <div
                        key={face.key}
                        className={`face-box face-box-${face.tone}`}
                        style={{
                          left: face.left,
                          top: face.top,
                          width: face.width,
                          height: face.height,
                        }}
                      >
                        <span>{face.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="camera-placeholder">
                <span className="camera-placeholder-icon">
                  <Icon
                    name={
                      cameraState === "error"
                        ? "bi-camera-video-off"
                        : "bi-camera-video"
                    }
                  />
                </span>
                <strong>
                  {cameraState === "error"
                    ? "دسترسی به دوربین برقرار نشد"
                    : "دوربین هنوز فعال نشده است"}
                </strong>
                <p>
                  {cameraState === "error"
                    ? "مجوز دوربین و اتصال امن را بررسی کنید."
                    : "برای مشاهده تصویر دوربین، روی دکمه زیر بزنید."}
                </p>
              </div>
            )}
          </div>
          {!classroomMode && attendancePopup && (
            <div
              className="attendance-success-toast"
              role="status"
              aria-live="polite"
            >
              <span className="attendance-success-icon">
                <Icon name="bi-check-lg" />
              </span>
              <span className="attendance-success-copy">
                <strong>{attendancePopup.status}</strong>
                <small>
                  {attendancePopup.name}
                  {attendancePopup.time ? " · " + attendancePopup.time : ""}
                </small>
              </span>
              <button
                type="button"
                aria-label="بستن پیام"
                onClick={() => setAttendancePopup(null)}
              >
                ×
              </button>
              <i className="attendance-success-progress" />
            </div>
          )}
          {classroomMode && (
            <div className="camera-picker-row">
              <label htmlFor="face-camera-select">دوربین ورودی</label>
              <select
                id="face-camera-select"
                className="form-select"
                value={selectedCameraId}
                onChange={(event) => onSelectCamera?.(event.target.value)}
                disabled={!cameras.length || cameraState === "connecting"}
              >
                {cameras.length ? (
                  cameras.map((camera, index) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {camera.label || `دوربین ${index + 1}`}
                    </option>
                  ))
                ) : (
                  <option value="">دوربینی پیدا نشد</option>
                )}
              </select>
              <small>
                {cameras.length
                  ? "دوربین داخلی لپ‌تاپ در صورت شناسایی، پیش‌فرض است."
                  : "برای نمایش نام دوربین‌ها، دسترسی را هنگام روشن‌کردن تأیید کنید."}
              </small>
            </div>
          )}
          <div className="camera-controls">
            {cameraState === "live" ? (
              <button className="btn btn-light-outline" onClick={stopCamera}>
                <Icon name="bi-stop-circle" /> توقف دوربین
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => startCamera()}
                disabled={cameraState === "connecting"}
              >
                <Icon
                  name={
                    cameraState === "connecting"
                      ? "bi-hourglass-split"
                      : "bi-camera-video"
                  }
                />{" "}
                {cameraState === "connecting"
                  ? "در حال اتصال…"
                  : "فعال‌سازی دوربین"}
              </button>
            )}
            <span className="camera-hint">
              {cameraState === "live"
                ? faceDescriptors.length
                  ? recognitionMessage
                  : "برای شروع تطبیق، ابتدا عکس مرجع دانشجویان را ثبت کنید."
                : "با فعال‌کردن دوربین، تطبیق خودکار شروع می‌شود."}
            </span>
          </div>
          <div className="camera-disclaimer">
            <Icon name="bi-shield-lock" />
            <span>
              تطبیق چهره در همین مرورگر و با عکس‌های مرجع ثبت‌شده انجام می‌شود.
              برای دقت بهتر، عکس روشن و روبه‌رو ثبت کنید و فقط یک نفر جلوی
              دوربین باشد.
            </span>
          </div>
        </section>
        <aside className="face-side">
          <section className="content-card face-settings">
            <div className="card-heading">
              <div>
                <h3>تنظیمات جلسه</h3>
                <p>کلاس مورد نظر را انتخاب کنید.</p>
              </div>
              <span className="heading-icon">
                <Icon name="bi-sliders" />
              </span>
            </div>
            <label className="form-label">درس / کلاس</label>
            <select
              className="form-select"
              value={sessionCourse}
              onChange={(e) => setSessionCourse(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id}>{c.title}</option>
              ))}
            </select>
            <label className="form-label" htmlFor="face-session-date">
              تاریخ جلسه
            </label>
            <JalaliDateInput
              id="face-session-date"
              value={sessionDate}
              onChange={(next) => setSessionDate(next)}
              ariaLabel="تاریخ جلسه"
            />
            <div className="face-info-row">
              <span>
                <Icon name="bi-clock" /> زمان جلسه
              </span>
              <strong>
                {new Intl.DateTimeFormat("fa-IR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date())}
              </strong>
            </div>
            <div className="face-info-row">
              <span>
                <Icon name="bi-calendar3" /> تاریخ
              </span>
              <strong>
                {new Intl.DateTimeFormat("fa-IR", {
                  day: "numeric",
                  month: "long",
                }).format(new Date())}
              </strong>
            </div>
            <div className="face-info-row">
              <span>
                <Icon name="bi-cpu" /> موتور تشخیص
              </span>
              <Badge
                tone={
                  modelStatus === "ready"
                    ? "success"
                    : modelStatus === "error"
                      ? "danger"
                      : "neutral"
                }
              >
                {modelStatus === "ready"
                  ? "موتور آماده"
                  : modelStatus === "error"
                    ? "خطا در بارگذاری مدل"
                    : "در حال آماده‌سازی مدل"}
              </Badge>
            </div>
          </section>
          <section className="content-card face-steps">
            <h3>مراحل استفاده</h3>
            {faceSteps.map((step) => (
              <div className={`face-step is-${step.status}`} key={step.title}>
                <span className={`step-icon ${step.status}`}>
                  <Icon name={step.icon} />
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </div>
                {step.status === "done" && (
                  <Icon name="bi-check-circle-fill" className="step-check" />
                )}
                {step.status === "active" && (
                  <span className="step-current">گام بعدی</span>
                )}
                {step.status === "error" && (
                  <Icon
                    name="bi-exclamation-circle-fill"
                    className="step-error"
                  />
                )}
              </div>
            ))}
          </section>
        </aside>
      </div>
      {classroomMode ? (
        <section className="content-card classroom-attendance-card">
          <div className="card-heading">
            <div>
              <h3>وضعیت دانشجویان جلسه</h3>
              <p>
                وضعیت‌ها از همان رکوردهای حضور، صدا و تشخیص چهره خوانده می‌شوند.
              </p>
            </div>
            <Badge tone="neutral">
              {attendance
                .filter((item) => item.sessionId === sessionId)
                .length.toLocaleString("fa-IR")}{" "}
              ثبت جلسه
            </Badge>
          </div>
          {students.length ? (
            <div className="classroom-roster">
              {students.map((student) => {
                const record = attendance.find(
                  (item) =>
                    item.sessionId === sessionId &&
                    String(item.id) === String(student.id),
                );
                const kind = attendanceStatusKind(
                  !record || record.status === "ثبت‌نشده"
                    ? ABSENT_STATUS
                    : record.status,
                );
                return (
                  <article key={student.id}>
                    <span
                      className={
                        "classroom-roster-avatar " +
                        kind +
                        (student.faceImage ? " has-photo" : "")
                      }
                    >
                      {student.faceImage ? (
                        <img src={student.faceImage} alt={student.name} />
                      ) : (
                        student.name.charAt(0)
                      )}
                    </span>
                    <div>
                      <strong>{student.name}</strong>
                      <small>{student.id}</small>
                    </div>
                    <Badge
                      tone={
                        kind === "present"
                          ? "success"
                          : kind === "late"
                            ? "warning"
                            : kind === "absent"
                              ? "danger"
                              : "neutral"
                      }
                    >
                      {!record || record.status === "ثبت‌نشده"
                        ? ABSENT_STATUS
                        : record.status}
                    </Badge>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="bi-people"
              title="دانشجویی ثبت نشده"
              text="ابتدا فهرست دانشجویان را کامل کنید تا وضعیت حضور این کلاس نمایش داده شود."
            />
          )}
          <div className="camera-disclaimer classroom-model-note">
            <Icon name="bi-info-circle" />
            <span>
              تشخیص چهره و ثبت حضور فعال است. تشخیص ماسک هنوز به مدل جداگانه
              نیاز دارد و در این نسخه وضعیت ماسک اعلام نمی‌شود.
            </span>
          </div>
        </section>
      ) : (
        <section className="content-card face-roster-card">
          <div className="card-heading">
            <div>
              <h3>فهرست تطبیق و ثبت حضور</h3>
              <p>
                عکس دانشجو را ذخیره کنید، چهره را با تصویر دوربین تطبیق دهید و
                وضعیت همین جلسه را ثبت کنید.
              </p>
            </div>
            <Badge tone="neutral">
              {attendance
                .filter((item) => item.sessionId === sessionId)
                .length.toLocaleString("fa-IR")}{" "}
              ثبت‌شده در این جلسه
            </Badge>
          </div>
          <div className="face-roster">
            {students.length ? (
              students.map((student) => {
                const record = attendance.find(
                  (item) =>
                    item.sessionId === sessionId && item.id === student.id,
                );
                // بدون رکورد یا رکورد «ثبت‌نشده» ⇒ ابتدا غایب نمایش داده می‌شود.
                const shownStatus =
                  !record || record.status === "ثبت‌نشده"
                    ? ABSENT_STATUS
                    : record.status;
                return (
                  <article className="face-student" key={student.id}>
                    <div className="face-student-profile">
                      {student.faceImage ? (
                        <img
                          src={student.faceImage}
                          alt={`تصویر ${student.name}`}
                        />
                      ) : (
                        <span className="face-student-placeholder">
                          <Icon name="bi-person" />
                        </span>
                      )}
                      <div>
                        <strong>{student.name}</strong>
                        <small>{student.id}</small>
                        <small>
                          {student.faceImage
                            ? "دارای عکس پروفایل"
                            : "بدون عکس پروفایل"}
                        </small>
                        <small
                          className={`face-attendance-status ${attendanceStatusKind(shownStatus)}`}
                        >
                          {shownStatus}
                        </small>
                      </div>
                    </div>
                    <div className="face-student-actions">
                      {student.faceImage && (
                        <img
                          src={student.faceImage}
                          alt={`تصویر ${student.name}`}
                          className="face-current-photo"
                          title="عکس پروفایل این دانشجو"
                        />
                      )}
                      <label className="btn btn-light-outline face-photo-button">
                        <Icon name="bi-image" />{" "}
                        {student.faceImage
                          ? "تغییر عکس پروفایل"
                          : "ثبت عکس پروفایل"}
                        <input
                          type="file"
                          accept="image/*"
                          capture="user"
                          onChange={(event) => {
                            onSaveStudentPhoto(
                              student.id,
                              Array.from(event.target.files || []),
                            );
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className={`btn btn-success-soft ${attendanceStatusKind(shownStatus) === "present" ? "selected" : ""}`}
                        aria-pressed={
                          attendanceStatusKind(shownStatus) === "present"
                        }
                        onClick={() =>
                          onMarkAttendance(student.id, PRESENT_STATUS, {
                            method: "manual",
                          })
                        }
                      >
                        حاضر
                      </button>
                      <button
                        type="button"
                        className={`btn btn-light-outline ${attendanceStatusKind(shownStatus) === "absent" ? "selected" : ""}`}
                        aria-pressed={
                          attendanceStatusKind(shownStatus) === "absent"
                        }
                        onClick={() =>
                          onMarkAttendance(student.id, ABSENT_STATUS, {
                            method: "manual",
                          })
                        }
                      >
                        غایب
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <EmptyState
                icon="bi-people"
                title="دانشجویی در فهرست نیست"
                text="برای این جلسه ابتدا دانشجو ثبت یا فهرست جلسه را اصلاح کنید."
              />
            )}
          </div>
        </section>
      )}
    </>
  );
}
export function Reports({
  attendance,
  students,
  courses = [],
  sessions = {},
  onExport,
  onPrint,
}) {
  const [courseId, setCourseId] = useState("all");
  const [studentId, setStudentId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const courseTitles = [
    ...new Set(
      [
        ...courses.map((course) => course.title),
        ...attendance.map((record) => record.course),
      ].filter(Boolean),
    ),
  ];
  const filtered = attendance.filter((record) => {
    const date = record.sessionDate || sessions[record.sessionId]?.date || "";
    return (
      (courseId === "all" || record.course === courseId) &&
      (studentId === "all" || String(record.id) === studentId) &&
      (!fromDate || (date && date >= fromDate)) &&
      (!toDate || (date && date <= toDate))
    );
  });
  const total = filtered.length;
  const present = filtered.filter(
    (a) => attendanceStatusKind(a.status) === "present",
  ).length;
  const late = filtered.filter(
    (a) => attendanceStatusKind(a.status) === "late",
  ).length;
  const absent = filtered.filter(
    (a) =>
      attendanceStatusKind(a.status) === "absent" && a.status !== "غیبت موجه",
  ).length;
  const excused = filtered.filter((a) => a.status === "غیبت موجه").length;
  const pct = total ? Math.round((present / total) * 100) : 0;
  const selectedStudent = students.find(
    (student) => String(student.id) === studentId,
  );
  const selectedCourse =
    courseId === "all" ? "همهٔ درس‌ها" : courseId;
  const selectedStudentLabel =
    studentId === "all"
      ? "همهٔ دانشجویان"
      : `${selectedStudent?.name || "دانشجو"} · ${studentId}`;
  const issueDate = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  const courseTeacher = new Map(
    courses.map((course) => [course.title, course.teacher || ""]),
  );

  async function handleExcelExport() {
    if (exporting) return;
    setExporting(true);
    setExportMessage("");
    try {
      await exportAttendanceExcel({
        records: filtered,
        courses,
        filters: {
          course: selectedCourse,
          student: selectedStudentLabel,
          fromDate,
          toDate,
        },
      });
      setExportMessage("فایل Excel با موفقیت ساخته شد.");
    } catch (error) {
      setExportMessage(
        error?.message || "ساخت فایل Excel انجام نشد؛ دوباره تلاش کنید.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="reports-page">
      <PanelTitle
        eyebrow="تحلیل و گزارش"
        title="گزارش‌های حضور و غیاب"
        description="تحلیل وضعیت حضور و دریافت خروجی از داده‌های ثبت‌شده."
        action={
          <div className="report-export-actions">
            <button
              type="button"
              className="btn btn-light-outline"
              onClick={handleExcelExport}
              disabled={exporting}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (exporting) return;
                handleExcelExport();
              }}
            >
              <Icon name="bi-file-earmark-spreadsheet" />{" "}
              {exporting ? "در حال ساخت Excel…" : "خروجی Excel"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onPrint}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onPrint();
              }}
            >
              <Icon name="bi-file-earmark-pdf" /> چاپ / ذخیره PDF
            </button>
            <span className="report-export-status">{exportMessage}</span>
          </div>
        }
      />
      <section className="content-card report-filter-card">
        <div className="report-filter-grid">
          <label>
            درس
            <select
              className="form-select"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              <option value="all">همهٔ درس‌ها</option>
              {courseTitles.map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            دانشجو
            <select
              className="form-select"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="all">همهٔ دانشجویان</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} · {student.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            از تاریخ
            <JalaliDateInput
              value={fromDate}
              onChange={(next) => setFromDate(next)}
              max={toDate || ""}
              clearable
              placeholder="همهٔ تاریخ‌ها"
              ariaLabel="از تاریخ"
            />
          </label>
          <label>
            تا تاریخ
            <JalaliDateInput
              value={toDate}
              onChange={(next) => setToDate(next)}
              min={fromDate || ""}
              clearable
              placeholder="همهٔ تاریخ‌ها"
              ariaLabel="تا تاریخ"
            />
          </label>
          <button
            className="btn btn-light-outline"
            onClick={() => {
              setCourseId("all");
              setStudentId("all");
              setFromDate("");
              setToDate("");
            }}
          >
            پاک‌کردن فیلتر
          </button>
        </div>
        <small>{total.toLocaleString("fa-IR")} رکورد مطابق فیلترها</small>
      </section>
      <div className="stat-grid report-stats">
        <StatCard
          icon="bi-check-circle"
          label="حضور ثبت‌شده"
          value={present.toLocaleString("fa-IR")}
          detail="رکورد حاضر"
          color="green"
        />
        <StatCard
          icon="bi-clock"
          label="تأخیر"
          value={late.toLocaleString("fa-IR")}
          detail="رکورد با تأخیر"
          color="orange"
        />
        <StatCard
          icon="bi-x-circle"
          label="غیبت"
          value={absent.toLocaleString("fa-IR")}
          detail={`${excused.toLocaleString("fa-IR")} غیبت موجه`}
          color="red"
        />
        <StatCard
          icon="bi-graph-up-arrow"
          label="نرخ حضور"
          value={`${pct.toLocaleString("fa-IR")}٪`}
          detail="از کل رکوردها"
          color="blue"
        />
      </div>
      <div className="report-grid">
        <section className="content-card">
          <div className="card-heading">
            <div>
              <h3>توزیع وضعیت‌ها</h3>
              <p>بر اساس کل رکوردهای ثبت‌شده</p>
            </div>
          </div>
          <div className="report-bars">
            {[
              { label: "حاضر", count: present, color: "bar-green" },
              { label: "تأخیر", count: late, color: "bar-orange" },
              { label: "غایب", count: absent, color: "bar-red" },
              { label: "غیبت موجه", count: excused, color: "bar-purple" },
            ].map((item) => (
              <div className="report-bar-row" key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.count.toLocaleString("fa-IR")}</strong>
                </div>
                <div className="bar-track">
                  <span
                    className={item.color}
                    style={{
                      width: `${total ? (item.count / total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="content-card report-highlight">
          <span className="highlight-icon">
            <Icon name="bi-people" />
          </span>
          <div className="eyebrow">مجموعه آموزشی</div>
          <strong className="highlight-number">
            {students.length.toLocaleString("fa-IR")}
          </strong>
          <h3>دانشجوی ثبت‌شده</h3>
          <p>تعداد دانشجویان در فهرست فعلی سامانه</p>
          <div className="highlight-footer">
            <span>
              <Icon name="bi-journal-bookmark" /> رکوردهای حضور
            </span>
            <strong>{total.toLocaleString("fa-IR")}</strong>
          </div>
        </section>
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h3>جزئیات آخرین رکوردها</h3>
            <p>تاریخچهٔ تغییر وضعیت و دلایل اصلاح</p>
          </div>
        </div>
        <div className="report-print-table">
          <AttendanceTable rows={filtered} students={students} />
        </div>
      </section>
      <section className="content-card report-audit-card">
        <div className="card-heading">
          <div>
            <h3>تاریخچهٔ تغییرات حضور</h3>
            <p>سوابق ثبت‌شده برای رکوردهای فیلترشده</p>
          </div>
        </div>
        {filtered.some((record) => record.history?.length) ? (
          <div className="report-audit-list">
            {filtered
              .flatMap((record) =>
                (record.history || []).map((entry, index) => ({
                  record,
                  entry,
                  index,
                })),
              )
              .reverse()
              .map(({ record, entry, index }) => (
                <article
                  key={`${record.sessionId}-${record.id}-${entry.changedAt}-${index}`}
                >
                  <span>
                    <strong>{record.name}</strong>
                    <small>
                      {record.course} ·{" "}
                      {record.sessionDate ||
                        sessions[record.sessionId]?.date ||
                        "بدون تاریخ"}
                    </small>
                  </span>
                  <span>
                    {entry.from} ← {entry.to}
                  </span>
                  <span>
                    {entry.changedBy}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </span>
                  <time>
                    {new Intl.DateTimeFormat("fa-IR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(entry.changedAt))}
                  </time>
                </article>
              ))}
          </div>
        ) : (
          <p className="report-audit-empty">
            برای فیلتر فعلی، تغییری ثبت نشده است.
          </p>
        )}
      </section>
      <section className="report-print-root" dir="rtl" aria-hidden="true">
        <header className="rp-header">
          <div className="rp-brand">
            <span className="rp-logo">
              <Icon name="bi-fingerprint" />
            </span>
            <div>
              <strong>حضوربان</strong>
              <small>سامانه حضور و غیاب هوشمند</small>
            </div>
          </div>
          <div className="rp-heading">
            <span>گزارش رسمی</span>
            <h1>گزارش حضور و غیاب</h1>
            <p>خروجی تحلیلی وضعیت حضور دانشجویان بر اساس فیلترهای انتخابی</p>
          </div>
          <div className="rp-stamp">
            <span>تاریخ صدور</span>
            <strong>{issueDate}</strong>
            <small>{filtered.length.toLocaleString("fa-IR")} رکورد</small>
          </div>
        </header>
        <div className="rp-chips">
          <span>
            <Icon name="bi-journal-bookmark" /> {selectedCourse}
          </span>
          <span>
            <Icon name="bi-person" /> {selectedStudentLabel}
          </span>
          <span>
            <Icon name="bi-calendar3" />{" "}
            {fromDate ? formatSessionDate(fromDate) : "از ابتدا"} تا{" "}
            {toDate ? formatSessionDate(toDate) : "اکنون"}
          </span>
        </div>
        <div className="rp-summary">
          {[
            { label: "کل رکوردها", value: total, tone: "blue" },
            { label: "حاضر", value: present, tone: "green" },
            { label: "تأخیر", value: late, tone: "orange" },
            { label: "غایب", value: absent, tone: "red" },
            { label: "غیبت موجه", value: excused, tone: "purple" },
            { label: "نرخ حضور", value: `${pct}٪`, tone: "teal" },
          ].map((item) => (
            <div className={`rp-summary-item ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>
                {typeof item.value === "number"
                  ? item.value.toLocaleString("fa-IR")
                  : item.value}
              </strong>
            </div>
          ))}
        </div>
        <table className="rp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>شماره دانشجویی</th>
              <th>نام دانشجو</th>
              <th>درس</th>
              <th>استاد</th>
              <th>تاریخ جلسه</th>
              <th>ساعت</th>
              <th>وضعیت</th>
              <th>روش ثبت</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((record, index) => (
              <tr
                key={
                  record.databaseId ||
                  `${record.sessionId}-${record.id}-${index}`
                }
              >
                <td>{(index + 1).toLocaleString("fa-IR")}</td>
                <td>{record.id}</td>
                <td>{record.name}</td>
                <td>{record.course}</td>
                <td>{courseTeacher.get(record.course) || "—"}</td>
                <td>{formatSessionDate(record.sessionDate)}</td>
                <td>{record.time || "—"}</td>
                <td>
                  <span className={`rp-status ${statusToneClass(record.status)}`}>
                    {record.status}
                  </span>
                </td>
                <td>{methodLabel(record.method)}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={9} className="rp-empty">
                  رکوردی برای این فیلترها وجود ندارد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <footer className="rp-footer">
          <span>
            این گزارش به‌صورت خودکار توسط سامانه حضوربان تولید شده است.
          </span>
          <span>حضوربان · حضور امن و دقیق</span>
        </footer>
      </section>
    </div>
  );
}
export function Settings({
  settings,
  setSettings,
  onSave,
  onBackup,
  onRestore,
  onNotify,
}) {
  const update = (key, value) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const resetSettings = () => {
    if (!confirm("تنظیمات به مقدار پیش‌فرض بازنشانی شود؟"))
      return;
    setSettings({
      name: "سامانه حضوربان",
      lateAfter: "10",
      notifications: true,
      faceRecognition: true,
    });
    onNotify?.("تنظیمات به پیش‌فرض‌ها بازنشانی شد.");
  };

  const [backupOptions, setBackupOptions] = React.useState({
    includeVoiceProfiles: true,
    includeImages: true,
  });

  const browserChecks = [
    [
      "اتصال امن برای دوربین و میکروفون",
      Boolean(window.isSecureContext),
      "از localhost یا HTTPS استفاده کنید.",
    ],
    [
      "دسترسی زنده به دوربین و میکروفون",
      Boolean(navigator.mediaDevices?.getUserMedia),
      "مرورگر جدیدی مثل Chrome، Edge یا Safari را باز کنید.",
    ],
    [
      "پردازش صوت",
      Boolean(window.AudioContext || window.webkitAudioContext),
      "مرورگر از Web Audio API پشتیبانی نمی‌کند.",
    ],
    [
      "ذخیرهٔ محلی صدا",
      Boolean(window.indexedDB),
      "حالت ناشناس یا محدودیت‌های حریم خصوصی ممکن است ذخیره‌سازی را مسدود کند.",
    ],
  ];
  return (
    <>
      <PanelTitle
        eyebrow="پیکربندی سامانه"
        title="تنظیمات"
        description="تنظیمات عمومی نسخه نمایشی سامانه را مدیریت کنید."
        action={
          <button className="btn btn-primary" onClick={onSave}>
            <Icon name="bi-check2" /> ذخیره تغییرات
          </button>
        }
      />
      <div className="settings-layout">
        <section className="content-card settings-card">
          <div className="settings-section-title">
            <span className="settings-icon">
              <Icon name="bi-sliders" />
            </span>
            <div>
              <h3>تنظیمات عمومی</h3>
              <p>اطلاعات پایه سامانه</p>
            </div>
          </div>
          <div className="setting-item">
            <div>
              <strong>نام سامانه</strong>
              <small>نام نمایشی در پنل مدیریت</small>
            </div>
            <input
              className="form-control settings-input"
              value={settings.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="setting-item">
            <div>
              <strong>حد مجاز تأخیر (دقیقه)</strong>
              <small>پس از این زمان، حضور به‌صورت تأخیر ثبت می‌شود.</small>
            </div>
            <input
              type="number"
              min="0"
              max="120"
              className="form-control settings-input narrow"
              value={settings.lateAfter}
              onChange={(e) => update("lateAfter", e.target.value)}
            />
          </div>
        </section>
        <section className="content-card settings-card">
          <div className="settings-section-title">
            <span className="settings-icon purple">
              <Icon name="bi-shield-check" />
            </span>
            <div>
              <h3>قابلیت‌های سامانه</h3>
              <p>فعال یا غیرفعال‌کردن امکانات</p>
            </div>
          </div>
          <div className="setting-item">
            <div>
              <strong>اعلان‌های سامانه</strong>
              <small>نمایش پیام‌های وضعیت و اطلاع‌رسانی</small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) => update("notifications", e.target.checked)}
              />
              <span />
            </label>
          </div>
          <div className="setting-item">
            <div>
              <strong>ماژول تشخیص چهره</strong>
              <small>نمایش صفحه تشخیص چهره در منو</small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.faceRecognition}
                onChange={(e) => update("faceRecognition", e.target.checked)}
              />
              <span />
            </label>
          </div>
          <div className="settings-warning">
            <Icon name="bi-database-check" /> این تنظیمات در PostgreSQL ذخیره
            می‌شوند و برای همهٔ کاربران سازمان اعمال می‌شوند.
          </div>
        </section>
        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-light-outline" onClick={resetSettings}>
            <Icon name="bi-arrow-counterclockwise" /> بازنشانی تنظیمات به پیش‌فرض‌ها
          </button>
        </div>
      </div>
      <section className="content-card backup-card">
        <div className="settings-section-title">
          <span className="settings-icon">
            <Icon name="bi-safe2" />
          </span>
          <div>
            <h3>پشتیبان‌گیری و بازیابی</h3>
            <p>
              نسخهٔ پشتیبان JSON از داده‌های این مرورگر بسازید یا بازیابی کنید.
              <br />
              <small>
                برای انتخاب محتوای پشتیبان، گزینه‌های زیر را تنظیم کنید:
              </small>
            </p>
            <div className="backup-options" style={{ marginTop: 16 }}>
              <label className="form-check form-check-inline" style={{ marginRight: 24 }}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={backupOptions.includeVoiceProfiles}
                  onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeVoiceProfiles: e.target.checked }))}
                />
                <span className="form-check-label">شامل الگوهای صوتی</span>
              </label>
              <label className="form-check form-check-inline" style={{ marginRight: 24 }}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={backupOptions.includeImages}
                  onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeImages: e.target.checked }))}
                />
                <span className="form-check-label">شامل عکس‌های مرجع</span>
              </label>
            </div>
          </div>
        </div>
        <div className="backup-info" style={{ marginTop: 16 }}>
          <div className="backup-privacy-note" style={{ marginBottom: 16 }}>
            <Icon name="bi-shield-lock" /> 
            فایل پشتیبان شامل:
            <ul className="list-unstyled" style={{ margin: "8px 0 0 20px", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "4px 16px" }}>
              <li>اطلاعات دانشجویان (نام، شماره دانشجویی، وضعیت)</li>
              <li>سوابق حضور و غیاب</li>
              <li>عکس‌های مرجع دانشجوها</li>
              <li>الگوهای صوتی (در صورت فعال بودن)</li>
              <li>تنظیمات کاربر (نام سامانه، حد تأخیر، اعلان‌ها، تشخیص چهره)</li>
              <li>تنظیمات تم تاریک/روشن</li>
            </ul>
            <small style={{ display: "block", marginTop: 8 }}>
              <strong>نکته:</strong> این پشتیبان تمام داده‌های حساس را شامل می‌شود. برای حفظ امنیت، این فایل را در فضای امن نگهدارید.
            </small>
          </div>
        </div>
        <div className="backup-actions">
          <button className="btn btn-primary" onClick={() => onBackup?.(backupOptions)}>
            <Icon name="bi-download" /> دریافت نسخهٔ پشتیبان
          </button>
          <label className="btn btn-light-outline">
            انتخاب فایل برای بازیابی
            <Icon name="bi-upload" />
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                onRestore?.(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </section>
      <section className="content-card browser-check-card">
        <div className="settings-section-title">
          <span className="settings-icon purple">
            <Icon name="bi-browser-chrome" />
          </span>
          <div>
            <h3>بررسی مرورگر و دستگاه فعلی</h3>
            <p>
              این بررسی قابلیت‌های پایه را می‌سنجد؛ کیفیت نور، دوربین یا
              میکروفون را با اجرای جلسهٔ آزمایشی ارزیابی کنید.
            </p>
          </div>
        </div>
        <ul>
          {browserChecks.map(([label, supported, hint]) => (
            <li key={label} className={supported ? "supported" : "unsupported"}>
              <Icon
                name={
                  supported
                    ? "bi-check-circle-fill"
                    : "bi-exclamation-circle-fill"
                }
              />
              <span>
                <strong>{label}</strong>
                {!supported && <small>{hint}</small>}
              </span>
              <Badge tone={supported ? "success" : "warning"}>
                {supported ? "آماده" : "نیازمند بررسی"}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function FingerprintAttendance({
  courses,
  students,
  attendance,
  sessionCourse,
  setSessionCourse,
  sessionDate,
  setSessionDate,
  sessionId,
  onMarkAttendance,
  onRecognitionNotice,
  fingerprintCredentials = [],
  checkFingerprintEnrollment,
  startFingerprintRegistration,
  finishFingerprintRegistration,
  startFingerprintAuthentication,
  finishFingerprintAuthentication,
  revokeFingerprintCredential,
  onCheckMyFingerprint,
}) {
  const [fpBusy, setFpBusy] = React.useState(false);
  const [fpBusyStudentId, setFpBusyStudentId] = React.useState("");
  const [fpMessage, setFpMessage] = React.useState({ tone: "info", text: "" });

  const enrolledByStudent = React.useMemo(() => {
    const map = new Map();
    for (const credential of fingerprintCredentials || []) {
      if (!credential?.studentId || credential.revokedAt) continue;
      map.set(String(credential.studentId), credential);
    }
    return map;
  }, [fingerprintCredentials]);

  const roster = React.useMemo(
    () =>
      (students || []).map((student) => ({
        ...student,
        credential:
          enrolledByStudent.get(
            String(student.databaseId || student.id),
          ) || null,
      })),
    [students, enrolledByStudent],
  );
  const enrolledCount = roster.filter((row) => row.credential).length;

  async function handleFingerprintScan() {
    setFpBusy(true);
    setFpMessage({ tone: "info", text: "در حال پیکربندی درخواست احراز اثر انگشت…" });
    try {
      const { options } = await startFingerprintAuthentication(sessionId);
      const { platformAuthenticatorIsAvailable, startAuthentication } =
        await import("@simplewebauthn/browser");
      const available = await platformAuthenticatorIsAvailable();
      if (!available) {
        throw new Error("این مرورگر یا سیستم عامل از حسگر اثر انگشت پشتیبانی نمی‌کند.");
      }
      const response = await startAuthentication({ optionsJSON: options });
      const result = await finishFingerprintAuthentication(sessionId, response);
      if (!result?.verified) {
        throw new Error("اثر انگشت با امنیت تأیید نشد.");
      }
      const studentId = result?.frontendStudentId || result?.student?.id;
      if (!studentId) {
        throw new Error("دانشجوی مربوط به این اثر انگشت در فهرست کلاس یافت نشد.");
      }
      const saved = await onMarkAttendance(studentId, "\u062d\u0627\u0636\u0631", {
        silent: false,
        method: "fingerprint",
      });
      if (saved) {
        playSuccess();
        setFpMessage({
          tone: "success",
          text: `اثر انگشت ${result.student.fullName || "دانشجو"} موفقیت‌آمیز احراز شد؛ وضعیت حاضر در این جلسه ثبت شد.`,
        });
      } else {
        setFpMessage({
          tone: "error",
          text: "اثر انگشت تأیید شد، اما ثبت خودکار وضعیت در جلسه انجام نشد.",
        });
      }
    } catch (error) {
      setFpMessage({
        tone: "error",
        text: error?.message || "اثر انگشت یافت نشد؛ دوباره تلاش کنید.",
      });
      playUnknown();
    } finally {
      setFpBusy(false);
    }
  }

  async function handleEnroll(student) {
    setFpBusyStudentId(student.id);
    setFpBusy(true);
    setFpMessage({
      tone: "info",
      text: `در حال ثبت اثر انگشت ${student.name}…`,
    });
    try {
      const payload = await startFingerprintRegistration(String(student.id));
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: payload.options });
      const result = await finishFingerprintRegistration(String(student.id), response);
      setFpMessage({
        tone: "success",
        text: `اثر انگشت ${student.name} با موفقیت ثبت شد.`,
      });
    } catch (error) {
      setFpMessage({
        tone: "error",
        text: error?.message || `ثبت اثر انگشت ${student.name} انجام نشد.`,
      });
    } finally {
      setFpBusy(false);
      setFpBusyStudentId("");
    }
  }

  async function handleRevoke(student) {
    const credentialId = student?.credential?.credentialId;
    if (!credentialId) return;
    try {
      await revokeFingerprintCredential(credentialId);
      setFpMessage({ tone: "info", text: "اثر انگشت با موفقیت غیرفعال شد." });
    } catch (error) {
      setFpMessage({
        tone: "error",
        text: error?.message || "غیرفعال‌سازی اثر انگشت انجام نشد.",
      });
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="حضور و غیاب هوشمند"
        title="ثبت حضور با اثر انگشت"
        description="با حسگر فیزیکی اثر انگشت (WebAuthn/پلتفرم) هویت را احراز کنید؛ در صورت تأیید امن، وضعیت حضور در جلسه ثبت می‌شود."
        action={
          <Badge tone="danger">
            <Icon name="bi-fingerprint" /> احراز هویت فیزیکی
          </Badge>
        }
      />
      <div className="face-layout">
        <section className="content-card camera-card">
          <div className="card-heading">
            <div>
              <h3>ثبت حضور با اثر انگشت</h3>
              <p>کلاس انتخاب‌شده را مشخص کنید و سپس دانشجو اثر انگشتش را بزند.</p>
            </div>
            <span className={`camera-status ${fpBusy ? "is-live" : ""}`}>
              <span /> {fpBusy ? "در حال احراز…" : "آمادهٔ ثبت"}
            </span>
          </div>
          <div className="camera-placeholder">
            <span className="camera-placeholder-icon">
              <Icon name="bi-fingerprint" />
            </span>
            <strong>حسگر اثر انگشت آماده است</strong>
            <p>
              برای هر بار ثبت حضور، دانشجو باید اثر انگشت خود را روی حسگر بزند و
              سپس دکمهٔ «ثبت حضور با اثر انگشت» را فشار دهد.
            </p>
          </div>
          <div className="camera-controls">
            <button
              className="btn btn-primary"
              onClick={handleFingerprintScan}
              disabled={fpBusy}
            >
              <Icon name="bi-fingerprint" />{" "}
              {fpBusy ? "در حال احراز اثر انگشت…" : "ثبت حضور با اثر انگشت"}
            </button>
            <span className="camera-hint">{fpMessage.text}</span>
          </div>
          <div className="camera-disclaimer">
            <Icon name="bi-shield-lock" />
            <span>
              احراز اثر انگشت با امضای WebAuthn و بررسی امن انجام می‌شود و بدون
              تأیید، وضعیت حضور ثبت نمی‌شود. اثر انگشت هر دانشجو به همان دستگاه و
              مرورگری که ثبت شده گره می‌خورد؛ برای ایستگاه کلاس، ثبت را روی همان
              ایستگاه انجام دهید.
            </span>
          </div>
        </section>
        <aside className="face-side">
          <section className="content-card face-settings">
            <div className="card-heading">
              <div>
                <h3>تنظیمات جلسه</h3>
                <p>کلاس و تاریخ جلسه را انتخاب کنید.</p>
              </div>
              <span className="heading-icon">
                <Icon name="bi-sliders" />
              </span>
            </div>
            <label className="form-label" htmlFor="fingerprint-session-course">
              درس / کلاس
            </label>
            <select
              id="fingerprint-session-course"
              className="form-select"
              value={sessionCourse}
              onChange={(event) => setSessionCourse(event.target.value)}
            >
              <option value="">همهٔ کلاس‌ها</option>
              {courses.map((course) => (
                <option key={course.id} value={course.title}>
                  {course.title}
                </option>
              ))}
            </select>
            <label className="form-label" htmlFor="fingerprint-session-date">
              تاریخ جلسه
            </label>
            <JalaliDateInput
              id="fingerprint-session-date"
              value={sessionDate}
              onChange={(next) => setSessionDate(next)}
              ariaLabel="تاریخ جلسه"
            />
            <div className="face-info-row">
              <span>
                <Icon name="bi-calendar3" /> جلسهٔ فعال
              </span>
              <strong>{sessionId || "—"}</strong>
            </div>
          </section>
          <section className="content-card face-settings">
            <div className="card-heading">
              <div>
                <h3>دانشجویان کلاس</h3>
                <p>
                  {enrolledCount.toLocaleString("fa-IR")} از{" "}
                  {students.length.toLocaleString("fa-IR")} عضو اثر انگشت دارند.
                </p>
              </div>
              <span className="heading-icon">
                <Icon name="bi-fingerprint" />
              </span>
            </div>
            <div className="fingerprint-list">
              {roster.length ? (
                roster.map((student) => (
                  <div className="fingerprint-row" key={student.id}>
                    <span className="fingerprint-avatar">
                      {student.name?.charAt(0) || "د"}
                    </span>
                    <div className="fingerprint-row-main">
                      <strong>{student.name}</strong>
                      <small>{student.id}</small>
                    </div>
                    {student.credential ? (
                      <>
                        <Badge tone="success">ثبت‌شده</Badge>
                        <button
                          className="text-action"
                          type="button"
                          onClick={() => handleRevoke(student)}
                        >
                          غیرفعال
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-light-outline btn-sm"
                        type="button"
                        onClick={() => handleEnroll(student)}
                        disabled={fpBusyStudentId === student.id}
                      >
                        <Icon name="bi-fingerprint" />{" "}
                        {fpBusyStudentId === student.id ? "در حال ثبت…" : "ثبت اثر انگشت"}
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="student-portal-empty-state compact">
                  <Icon name="bi-people" />
                  <span>دانشجویی در این جلسه ثبت نشده است.</span>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export function Profile({ name, role, photo, onSave, loginHistory = [], historyError = "" }) {
  const [draftName, setDraftName] = useState(name);
  const [draftPhoto, setDraftPhoto] = useState(photo || "");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraftName(name);
    setDraftPhoto(photo || "");
  }, [name, photo]);

  async function selectPhoto(file) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("لطفاً یک فایل تصویری انتخاب کنید.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("حجم تصویر باید کمتر از ۸ مگابایت باشد.");
      return;
    }
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = source;
      });
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      setDraftPhoto(canvas.toDataURL("image/jpeg", 0.8));
    } catch {
      setError("خواندن تصویر انجام نشد؛ فایل دیگری انتخاب کنید.");
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="حساب کاربری"
        title="پروفایل من"
        description="نام نمایشی و تصویر پروفایل خود را مدیریت کنید."
        action={
          <button
            className="btn btn-primary"
            type="button"
            onClick={() =>
              onSave({ name: draftName.trim(), photo: draftPhoto })
            }
          >
            <Icon name="bi-check2" /> ذخیره پروفایل
          </button>
        }
      />
      <div className="profile-layout">
        <section className="content-card profile-card">
          <div className="profile-cover">
            <span>
              <Icon name="bi-person-circle" />
            </span>
          </div>
          <div className="profile-editor">
            <div className="profile-photo-wrap">
              {draftPhoto ? (
                <img
                  className="profile-photo"
                  src={draftPhoto}
                  alt="تصویر پروفایل"
                />
              ) : (
                <span className="profile-photo profile-photo-placeholder">
                  <Icon name="bi-person-fill" />
                </span>
              )}
              <label
                className="profile-photo-edit"
                title="انتخاب تصویر پروفایل"
              >
                <Icon name="bi-camera-fill" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    selectPhoto(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="profile-identity">
              <strong>{draftName || "نام کاربر"}</strong>
              <span>
                <Icon name="bi-shield-check" /> {role}
              </span>
            </div>
            <div className="profile-form">
              <label className="form-label" htmlFor="profile-name">
                نام نمایشی
              </label>
              <input
                id="profile-name"
                className="form-control"
                value={draftName}
                maxLength={60}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="نام و نام خانوادگی"
              />
              {error && (
                <small className="profile-error" role="alert">
                  {error}
                </small>
              )}
              <p className="profile-session-note">
                <Icon name="bi-info-circle" /> تصویر این پروفایل فقط تا پایان
                نشست فعلی مرورگر نگهداری می‌شود.
              </p>
            </div>
          </div>
        </section>
        <aside className="content-card profile-summary-card">
          <span className="profile-summary-icon">
            <Icon name="bi-person-vcard" />
          </span>
          <h3>اطلاعات حساب</h3>
          <p>مشخصات فعلی حساب شما در این پنل</p>
          <div className="profile-detail-row">
            <span>نام</span>
            <strong>{draftName || "—"}</strong>
          </div>
          <div className="profile-detail-row">
            <span>نوع دسترسی</span>
            <strong>{role}</strong>
          </div>
          <div className="profile-detail-row">
            <span>وضعیت</span>
            <strong className="profile-active">
              <i /> فعال
            </strong>
          </div>
        </aside>
      </div>

      <div className="content-card data-card" style={{ marginTop: 16 }}>
        <div className="panel-title-inline" style={{ marginBottom: 12 }}>
          <div className="eyebrow">امنیت حساب</div>
          <h4>تاریخچهٔ ورود</h4>
        </div>
        {loginHistory.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>IP</th>
                  <th>مرورگر/دستگاه</th>
                  <th>نتیجه</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.map((item, index) => (
                  <tr key={item.id || index}>
                    <td dir="ltr" style={{ textAlign: "right" }}>
                      {new Date(item.loginTime || item.login_time).toLocaleString("fa-IR")}
                    </td>
                    <td dir="ltr" style={{ textAlign: "right" }}>
                      {item.ipAddress || item.ip_address || "—"}
                    </td>
                    <td className="text-truncate" style={{ maxWidth: 240 }} title={item.userAgent || item.user_agent || ""}>
                      {item.userAgent || item.user_agent || "—"}
                    </td>
                    <td>
                      {item.successful ? (
                        <Badge tone="success">موفق</Badge>
                      ) : (
                        <Badge tone="danger">ناموفق</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="page-note">رکورد ورودی وجود ندارد.</p>
        )}
        {historyError && (
          <p className="profile-error" role="alert">{historyError}</p>
        )}
      </div>
    </>
  );
}

export function StudentPortal({
  student,
  records,
  courses = [],
  photo,
  theme = "light",
  onUploadPhoto,
  onCheckMyFingerprint,
  onStartMyFingerprintRegistration,
  onFinishMyFingerprintRegistration,
  onToggleTheme,
  onLogout,
  tickets = [],
  onCreateTicket,
  onRefreshTickets,
  leaveRequests = [],
  onCreateLeave,
  onRefreshLeaveRequests,
  onCreateObjection,
  notifications = [],
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  sessions = [],
  onLoadTrend,
}) {
  const [tab, setTab] = useState("overview");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [portalToast, setPortalToast] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState({ tone: "", text: "" });
  const [localPreview, setLocalPreview] = useState("");
  const previewUrlRef = useRef("");
  const fileInputRef = useRef(null);
  const [myFingerprintBusy, setMyFingerprintBusy] = useState(false);
  const [myFingerprintState, setMyFingerprintState] = useState({
    enrolled: false,
    credential: null,
  });
  const [myFingerprintMessage, setMyFingerprintMessage] = useState({
    tone: "",
    text: "",
  });
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketNotice, setTicketNotice] = useState({ tone: "", text: "" });
  const [leaveForm, setLeaveForm] = useState({
    type: "leave",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    reason: "",
  });
  const [leaveProof, setLeaveProof] = useState(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveNotice, setLeaveNotice] = useState({ tone: "", text: "" });
  const [objectionTarget, setObjectionTarget] = useState(null);
  const [objectionReason, setObjectionReason] = useState("");
  const [objectionBusy, setObjectionBusy] = useState(false);
  const [objectionNotice, setObjectionNotice] = useState({
    tone: "",
    text: "",
  });

  useEffect(() => {
    if (tab !== "leave") return undefined;
    onRefreshLeaveRequests?.().catch(() => {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!portalToast) return undefined;
    const timer = setTimeout(() => setPortalToast(""), 4000);
    return () => clearTimeout(timer);
  }, [portalToast]);

  async function handleCreateLeave() {
    if (leaveForm.reason.trim().length < 5) {
      setLeaveNotice({ tone: "error", text: "دلیل را کامل‌تر بنویسید (حداقل ۵ کاراکتر)." });
      return;
    }
    if (leaveForm.endDate && leaveForm.endDate < leaveForm.startDate) {
      setLeaveNotice({ tone: "error", text: "تاریخ پایان نمی‌تواند قبل از شروع باشد." });
      return;
    }
    setLeaveBusy(true);
    setLeaveNotice({ tone: "", text: "" });
    try {
      await onCreateLeave(
        {
          type: leaveForm.type,
          startDate: leaveForm.startDate,
          endDate: leaveForm.endDate || leaveForm.startDate,
          reason: leaveForm.reason.trim(),
        },
        leaveProof,
      );
      setLeaveForm({
        type: "leave",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
        reason: "",
      });
      setLeaveProof(null);
      setLeaveNotice({
        tone: "success",
        text: "درخواست شما ثبت شد و در انتظار بررسی مدیر است.",
      });
      setPortalToast("درخواست مرخصی/توجیه شما با موفقیت ثبت شد.");
    } catch (error) {
      setLeaveNotice({
        tone: "error",
        text: error?.message || "ثبت درخواست انجام نشد.",
      });
    } finally {
      setLeaveBusy(false);
    }
  }

  async function handleCreateObjection() {
    if (!objectionTarget) return;
    if (objectionReason.trim().length < 5) {
      setObjectionNotice({
        tone: "error",
        text: "دلیل اعتراض را کامل‌تر بنویسید.",
      });
      return;
    }
    setObjectionBusy(true);
    setObjectionNotice({ tone: "", text: "" });
    try {
      await onCreateObjection({
        attendanceId: objectionTarget.databaseId,
        reason: objectionReason.trim(),
      });
      setObjectionTarget(null);
      setObjectionReason("");
      setObjectionNotice({
        tone: "success",
        text: "اعتراض شما ثبت شد و توسط مدیر بررسی می‌شود.",
      });
      setPortalToast("اعتراض شما ثبت شد و توسط مدیر بررسی می‌شود.");
    } catch (error) {
      setObjectionNotice({
        tone: "error",
        text: error?.message || "ثبت اعتراض انجام نشد.",
      });
    } finally {
      setObjectionBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== "tickets") return undefined;
    onRefreshTickets?.().catch(() => {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function handleCreateTicket() {
    if (ticketSubject.trim().length < 3) {
      setTicketNotice({ tone: "error", text: "موضوع باید حداقل ۳ کاراکتر باشد." });
      return;
    }
    if (ticketMessage.trim().length < 10) {
      setTicketNotice({ tone: "error", text: "متن درخواست باید حداقل ۱۰ کاراکتر باشد." });
      return;
    }
    setTicketBusy(true);
    setTicketNotice({ tone: "", text: "" });
    try {
      await onCreateTicket({
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
      });
      setTicketSubject("");
      setTicketMessage("");
      setTicketNotice({ tone: "success", text: "درخواست پشتیبانی شما ثبت شد." });
    } catch (error) {
      setTicketNotice({ tone: "error", text: error?.message || "ثبت تیکت انجام نشد." });
    } finally {
      setTicketBusy(false);
    }
  }

  useEffect(() => {
    setPhotoMessage({ tone: "", text: "" });
    setLocalPreview("");
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  }, [student?.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const state =
          (await onCheckMyFingerprint?.()) || { enrolled: false, credential: null };
        if (!cancelled) setMyFingerprintState(state);
      } catch {
        if (!cancelled) setMyFingerprintState({ enrolled: false, credential: null });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  async function handleMyFingerprintEnroll() {
    setMyFingerprintBusy(true);
    setMyFingerprintMessage({ tone: "", text: "" });
    try {
      const check = await onCheckMyFingerprint?.();
      const state = check || { enrolled: false, credential: null };
      setMyFingerprintState(state);
      if (state.enrolled) {
        setMyFingerprintMessage({
          tone: "info",
          text: "این حساب از قبل اثر انگشت دارد؛ برای ثبت حضور، آن را روی حسگر همان دستگاهی که ثبت شده بزنید.",
        });
        return;
      }
      const payload = await onStartMyFingerprintRegistration?.();
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: payload.options });
      const result = await onFinishMyFingerprintRegistration?.(response);
      const checkAgain = await onCheckMyFingerprint?.();
      setMyFingerprintState(checkAgain || { enrolled: false, credential: null });
      setMyFingerprintMessage({
        tone: "success",
        text: "اثر انگشت شما با موفقیت ثبت شد؛ این اثر انگشت به همین دستگاه و مرورگر گره می‌خورد. برای حضور در ایستگاه کلاس، ثبت را روی همان ایستگاه انجام دهید.",
      });
    } catch (error) {
      setMyFingerprintMessage({
        tone: "error",
        text: error?.message || "ثبت اثر انگشت انجام نشد.",
      });
      playUnknown();
    } finally {
      setMyFingerprintBusy(false);
    }
  }

  if (!student) {
    return (
      <div className="student-portal student-portal-empty" dir="rtl">
        <header className="student-portal-topbar">
          <strong>
            <Icon name="bi-fingerprint" /> حضوربان
          </strong>
          <button className="btn btn-light-outline" onClick={onLogout}>
            خروج از حساب
          </button>
        </header>
        <section className="content-card student-link-error">
          <span>
            <Icon name="bi-person-exclamation" />
          </span>
          <h1>حساب دانشجویی پیدا نشد</h1>
          <p>
            نام کاربری ورود را با نام کامل یا شمارهٔ دانشجویی ثبت‌شده در سامانه
            وارد کنید. در این وضعیت اطلاعات دانشجویان دیگر نمایش داده نمی‌شود.
          </p>
          <button className="btn btn-primary" onClick={onLogout}>
            <Icon name="bi-arrow-right" /> بازگشت به ورود
          </button>
        </section>
      </div>
    );
  }

  const presentCount = records.filter(
    (item) =>
      attendanceStatusKind(item.status) === "present" ||
      attendanceStatusKind(item.status) === "late",
  ).length;
  const absentCount = records.filter(
    (item) => attendanceStatusKind(item.status) === "absent",
  ).length;
  const attendanceRate = records.length
    ? Math.round((presentCount / records.length) * 100)
    : 0;
  const courseNames = [
    ...new Set(
      [
        ...courses
          .filter((course) =>
            (course.studentIds || []).some(
              (id) => String(id) === String(student.id),
            ),
          )
          .map((course) => course.title),
        ...records.map((item) => item.course),
      ].filter(Boolean),
    ),
  ];
  const recentRecords = [...records].sort((a, b) =>
    `${b.sessionDate || ""}${b.time || ""}`.localeCompare(
      `${a.sessionDate || ""}${a.time || ""}`,
    ),
  );
  const statusLabel = (status) => {
    const kind = attendanceStatusKind(status);
    return kind === "present"
      ? "حاضر"
      : kind === "late"
        ? "با تأخیر"
        : kind === "absent"
          ? "غایب"
          : status || "ثبت‌نشده";
  };
  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("fa-IR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(date);
  };

  const photoSrc = localPreview || student.faceImage || photo || "";
  const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!allowedPhotoTypes.includes(file.type)) {
      setPhotoMessage({
        tone: "error",
        text: "فقط تصویر با فرمت JPG، PNG یا WebP انتخاب کنید.",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoMessage({
        tone: "error",
        text: "حجم تصویر باید کمتر از ۵ مگابایت باشد.",
      });
      return;
    }

    // پیش‌نمایش فوری قبل از آپلود
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = URL.createObjectURL(file);
    setLocalPreview(previewUrlRef.current);
    setPhotoMessage({ tone: "", text: "" });

    setUploading(true);
    try {
      await onUploadPhoto?.(file);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = "";
      }
      setLocalPreview("");
      setPhotoMessage({
        tone: "success",
        text: "عکس پروفایل به‌روزرسانی شد؛ همین عکس مرجع تشخیص چهره هم هست.",
      });
    } catch (error) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = "";
      }
      setLocalPreview("");
      setPhotoMessage({
        tone: "error",
        text:
          error?.message ||
          "بارگذاری عکس انجام نشد. دوباره تلاش کنید یا با مدیر تماس بگیرید.",
      });
    } finally {
      setUploading(false);
    }
  }

  const tabs = [
    { id: "overview", label: "نمای کلی", icon: "bi-grid-1x2" },
    { id: "exams", label: "آزمون‌ها", icon: "bi-journal-check" },
    { id: "fingerprint", label: "اثر انگشت", icon: "bi-fingerprint" },
    { id: "profile", label: "پروفایل من", icon: "bi-person-circle" },
    { id: "tickets", label: "تیکت‌ها", icon: "bi-ticket" },
    { id: "calendar", label: "تقویم من", icon: "bi-calendar3" },
    { id: "leave", label: "مرخصی و توجیه", icon: "bi-calendar2-check" },
    { id: "help", label: "کمک و ارتباط با ما", icon: "bi-headset" },
  ];

  const faqs = [
    {
      question: "چطور عکس پروفایلم را تغییر دهم؟",
      answer:
        "به بخش «پروفایل من» بروید، دکمهٔ «تغییر عکس پروفایل» را بزنید و یک تصویر روشن با فرمت JPG، PNG یا WebP (حداکثر ۵ مگابایت) انتخاب کنید. همین عکس هم آواتار شماست و هم عکس مرجع تشخیص چهره.",
    },
    {
      question: "وضعیت حضورم چطور محاسبه می‌شود؟",
      answer:
        "هر جلسه ابتدا برای همهٔ دانشجویان «غایب» ثبت می‌شود. سپس اگر با تشخیص چهره، صدا یا ثبت دستی حاضر شوید، وضعیت شما به «حاضر» یا «تأخیر» تغییر می‌کند. درصد حضور از نسبت حضورها به کل جلسات ثبت‌شده محاسبه می‌شود.",
    },
    {
      question: "اگر عکسم برای تشخیص چهره پذیرفته نشود چه کنم؟",
      answer:
        "از عکس روبه‌رو با نور یکنواخت، بدون عینک تیره یا ماسک و با پس‌زمینهٔ ساده استفاده کنید. فقط یک چهره در تصویر باشد و کیفیت آن واضح باشد. سپس از بخش پروفایل عکس را دوباره بارگذاری کنید.",
    },
    {
      question: "چرا بعضی جلسات برای من «غایب» ثبت شده است؟",
      answer:
        "اگر در جلسه‌ای حضور شما با هیچ روشی (چهره، صدا یا ثبت دستی) تأیید نشود، وضعیت پیش‌فرض «غایب» باقی می‌ماند. اگر حضورتان اشتباه ثبت شده، با مدیر یا استاد درس هماهنگ کنید.",
    },
    {
      question: "چه کسی اطلاعات من را می‌بیند؟",
      answer:
        "این پنل فقط اطلاعات مرتبط با شمارهٔ دانشجویی شما را نشان می‌دهد. مدیر سامانه و استاد درس برای ثبت و بررسی حضور به اطلاعات کلاس دسترسی دارند.",
    },
  ];

  const supportMailto = `mailto:admin@hozorban.local?subject=${encodeURIComponent(
    `درخواست پشتیبانی - ${student.name} - ${student.id}`,
  )}&body=${encodeURIComponent(
    `نام: ${student.name}\nشماره دانشجویی: ${student.id}\n\nمتن درخواست:\n`,
  )}`;

  const liveSession = sessions.find(
    (session) => session.liveStatus === "live",
  );
  const liveRecord = liveSession
    ? records.find((record) => record.sessionId === liveSession.id)
    : null;

  return (
    <div className="student-portal" dir="rtl">
      {portalToast ? (
        <div className="student-portal-toast" role="status">
          <Icon name="bi-check2-circle" />
          <span>{portalToast}</span>
          <button
            type="button"
            aria-label="بستن پیام"
            onClick={() => setPortalToast("")}
          >
            ×
          </button>
        </div>
      ) : null}
      <header className="student-portal-topbar">
        <div className="student-portal-brand">
          <span>
            <Icon name="bi-fingerprint" />
          </span>
          <div>
            <strong>حضوربان</strong>
            <small>پنل دانشجویی</small>
          </div>
        </div>
        <div className="student-portal-user">
          <button
            type="button"
            className="student-avatar-button"
            title="مشاهدهٔ پروفایل"
            aria-label="مشاهدهٔ پروفایل"
            onClick={() => setTab("profile")}
          >
            {photoSrc ? (
              <img src={photoSrc} alt="" />
            ) : (
              <span className="student-portal-avatar">
                {student.name.charAt(0)}
              </span>
            )}
          </button>
          <div>
            <strong>{student.name}</strong>
            <small>دانشجو · {student.id}</small>
          </div>
          <div className="notification-wrap">
            <button
              className="icon-button student-notification-button"
              type="button"
              title="اعلان‌ها"
              aria-label="اعلان‌ها"
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <Icon name="bi-bell" />
              {notifications.filter((item) => !item.isRead).length > 0 && (
                <span className="notification-count">
                  {notifications
                    .filter((item) => !item.isRead)
                    .length.toLocaleString("fa-IR")}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="notification-panel">
                <div className="notification-panel-head">
                  <strong>اعلان‌ها</strong>
                  <button
                    type="button"
                    onClick={() => onMarkAllNotificationsRead?.()}
                    disabled={
                      !notifications.some((item) => !item.isRead)
                    }
                  >
                    خواندن همه
                  </button>
                </div>
                <div className="notification-list">
                  {(() => {
                    const visibleNotifications = notifications.filter(
                      (item) => !item.isRead,
                    );
                    if (!visibleNotifications.length) {
                      return (
                        <div className="notification-empty">
                          <Icon name="bi-bell-slash" />
                          <span>اعلان جدیدی ندارید</span>
                        </div>
                      );
                    }
                    return visibleNotifications.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`notification-item ${item.isRead ? "" : "unread"}`}
                        onClick={() => {
                          onMarkNotificationRead?.(item.id);
                          setNotificationsOpen(false);
                        }}
                      >
                        <span className="notification-item-icon">
                          <Icon
                            name={
                              item.type === "leave"
                                ? "bi-calendar2-check"
                                : item.type === "objection"
                                  ? "bi-shield-exclamation"
                                  : "bi-bell"
                            }
                          />
                        </span>
                        <span className="notification-item-copy">
                          <strong>{item.title}</strong>
                          <p>{item.message}</p>
                          <small>
                            {new Date(item.createdAt).toLocaleString("fa-IR")}
                          </small>
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
          <button
            className="icon-button student-theme-toggle"
            type="button"
            aria-label={
              theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تیره"
            }
            title={theme === "dark" ? "تم روشن" : "تم تیره"}
            onClick={onToggleTheme}
          >
            <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
          </button>
          <button className="btn btn-light-outline" onClick={onLogout}>
            <Icon name="bi-box-arrow-left" /> خروج
          </button>
        </div>
      </header>
      <nav className="student-portal-tabs" aria-label="بخش‌های پنل دانشجویی">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <main className="student-portal-content">
        {tab === "overview" && (
          <>
        <LiveClassBanner
          session={liveSession}
          status={liveRecord?.status}
        />
        <section className="student-welcome-card">
          <div className="student-welcome-copy">
            <span className="student-welcome-eyebrow">
              <i /> پنل شخصی دانشجو
            </span>
            <h1>سلام، {student.name}</h1>
            <p>وضعیت حضور و درس‌های ثبت‌شدهٔ خودت را از اینجا پیگیری کن.</p>
          </div>
          <div className="student-welcome-mark">
            <Icon name="bi-mortarboard-fill" />
          </div>
          <div className="student-welcome-meta">
            <span>
              <Icon name="bi-person-vcard" /> شماره دانشجویی
            </span>
            <strong>{student.id}</strong>
            <span>
              <Icon name="bi-journal-check" /> رشته و نیم‌سال
            </span>
            <strong>
              {[student.major, student.term].filter(Boolean).join(" · ") || "—"}
            </strong>
          </div>
        </section>
        <section className="student-stat-grid" aria-label="خلاصهٔ حضور">
          <article className="student-stat-card">
            <span className="student-stat-icon blue">
              <Icon name="bi-calendar2-week" />
            </span>
            <div>
              <small>جلسات ثبت‌شده</small>
              <strong>{records.length.toLocaleString("fa-IR")}</strong>
            </div>
          </article>
          <article className="student-stat-card">
            <span className="student-stat-icon green">
              <Icon name="bi-person-check" />
            </span>
            <div>
              <small>حضورها</small>
              <strong>{presentCount.toLocaleString("fa-IR")}</strong>
            </div>
          </article>
          <article className="student-stat-card">
            <span className="student-stat-icon orange">
              <Icon name="bi-person-exclamation" />
            </span>
            <div>
              <small>غیبت‌ها</small>
              <strong>{absentCount.toLocaleString("fa-IR")}</strong>
            </div>
          </article>
          <article className="student-stat-card">
            <span className="student-stat-icon purple">
              <Icon name="bi-graph-up-arrow" />
            </span>
            <div>
              <small>درصد حضور</small>
              <strong>{attendanceRate.toLocaleString("fa-IR")}٪</strong>
            </div>
          </article>
        </section>
        <div className="student-portal-grid">
          <section className="content-card student-attendance-card">
            <div className="student-section-heading">
              <div>
                <span>گزارش شخصی</span>
                <h2>آخرین وضعیت حضور</h2>
              </div>
              <span className="student-section-badge">
                <Icon name="bi-shield-lock" /> فقط برای شما
              </span>
            </div>
            {recentRecords.length ? (
              <div className="student-record-list">
                {recentRecords.slice(0, 8).map((record, index) => {
                  const kind = attendanceStatusKind(record.status);
                  return (
                    <article
                      className="student-record-row"
                      key={`${record.sessionId || record.course}-${index}`}
                    >
                      <span className={`student-record-icon ${kind}`}>
                        <Icon
                          name={
                            kind === "present"
                              ? "bi-check2"
                              : kind === "late"
                                ? "bi-clock"
                                : "bi-x-lg"
                          }
                        />
                      </span>
                      <div className="student-record-main">
                        <strong>{record.course || "جلسهٔ درسی"}</strong>
                        <small>
                          {formatDate(record.sessionDate || record.date)}
                          {record.time ? ` · ${record.time}` : ""}
                        </small>
                      </div>
                      <span className={`student-record-status ${kind}`}>
                        {statusLabel(record.status)}
                      </span>
                      {record.databaseId && kind !== "present" ? (
                        <button
                          type="button"
                          className="btn btn-light-outline btn-sm student-record-action"
                          onClick={() => {
                            setObjectionNotice({ tone: "", text: "" });
                            setObjectionTarget(record);
                          }}
                        >
                          <Icon name="bi-exclamation-circle" /> اعتراض
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="student-portal-empty-state">
                <Icon name="bi-calendar2-x" />
                <strong>هنوز سابقه‌ای ثبت نشده</strong>
                <span>
                  بعد از ثبت اولین جلسه، گزارش حضور اینجا نمایش داده می‌شود.
                </span>
              </div>
            )}
          </section>
          <aside className="content-card student-courses-card">
            <div className="student-section-heading">
              <div>
                <span>برنامهٔ من</span>
                <h2>درس‌های ثبت‌شده</h2>
              </div>
              <span className="student-course-count">
                {courseNames.length.toLocaleString("fa-IR")}
              </span>
            </div>
            {courseNames.length ? (
              <div className="student-course-list">
                {courseNames.map((course, index) => (
                  <div className="student-course-item" key={course}>
                    <span className={`student-course-icon course-${index % 4}`}>
                      <Icon name="bi-journal-bookmark" />
                    </span>
                    <strong>{course}</strong>
                    <Icon name="bi-chevron-left" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="student-portal-empty-state compact">
                <Icon name="bi-journal-x" />
                <span>درسی برای این حساب ثبت نشده است.</span>
              </div>
            )}
            <div className="student-privacy-note">
              <Icon name="bi-lock-fill" />
              <span>
                این پنل فقط اطلاعات مرتبط با شماره دانشجویی شما را نمایش می‌دهد.
              </span>
            </div>
          </aside>
        </div>
          </>
          )}

        {tab === "fingerprint" && (
          <section className="content-card student-fingerprint-card">
            <div className="student-section-heading">
              <div>
                <span>حسگر فیزیکی</span>
                <h2>اثر انگشت من</h2>
              </div>
              <span className="student-section-badge">
                <Icon name="bi-fingerprint" /> احراز هویت فیزیکی
              </span>
            </div>
            <div className={`student-fingerprint-status ${myFingerprintState?.enrolled ? "ok" : "missing"}`}>
              <Icon name={myFingerprintState?.enrolled ? "bi-check2" : "bi-fingerprint"} />
              <div>
                <strong>
                  {myFingerprintState?.enrolled
                    ? "اثر انگشت شما ثبت و آمادهٔ استفاده است."
                    : "اثر انگشتی برای حساب شما ثبت نشده است."}
                </strong>
                <small>
                  {myFingerprintState?.enrolled
                    ? "برای ثبت حضور، اثر انگشت خود را روی حسگر همان دستگاهی که ثبت شده بزنید؛ credential به همین دستگاه و مرورگر گره می‌خورد."
                    : "با زدن دکمهٔ «ثبت اثر انگشت من»، روی حسگر همین دستگاه اثر انگشت بزنید. اگر می‌خواهید حضور را در ایستگاه کلاس ثبت کنید، ثبت را روی همان ایستگاه (توسط مدیر یا استاد) انجام دهید."}
                </small>
              </div>
            </div>
            <div className="student-fingerprint-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleMyFingerprintEnroll}
                disabled={myFingerprintBusy}
              >
                <Icon name="bi-fingerprint" />{" "}
                {myFingerprintBusy ? "در حال اتصال به حسگر…" : "ثبت اثر انگشت من"}
              </button>
            </div>
            {myFingerprintMessage.text ? (
              <p className={`student-photo-message ${myFingerprintMessage.tone}`}>
                {myFingerprintMessage.text}
              </p>
            ) : null}
          </section>
        )}

        {tab === "profile" && (
          <section className="student-profile-section">
            <div className="student-profile-hero content-card">
              <div>
                <span className="eyebrow">حساب دانشجویی</span>
                <h1>پروفایل من</h1>
                <p>عکس پروفایل و اطلاعات دانشجویی خود را مدیریت کنید.</p>
              </div>
              <span className="student-section-badge">
                <Icon name="bi-shield-check" /> یک عکس، دو کاربرد
              </span>
            </div>
            <div className="student-profile-grid">
              <article className="content-card student-photo-card">
                <div className="student-photo-preview">
                  {photoSrc ? (
                    <img src={photoSrc} alt="عکس پروفایل" />
                  ) : (
                    <span className="student-photo-placeholder">
                      <Icon name="bi-person-bounding-box" />
                    </span>
                  )}
                  {uploading && (
                    <div className="student-photo-overlay">
                      <span
                        className="spinner-border spinner-border-sm"
                        role="status"
                        aria-hidden="true"
                      />
                      <span>در حال بارگذاری…</span>
                    </div>
                  )}
                </div>
                <div className="student-photo-status-row">
                  <span
                    className={`student-photo-status ${photoSrc ? "ok" : "missing"}`}
                  >
                    <Icon
                      name={
                        photoSrc
                          ? "bi-check-circle-fill"
                          : "bi-exclamation-circle"
                      }
                    />
                    {photoSrc ? "عکس مرجع ثبت شده" : "عکس مرجع ثبت نشده"}
                  </span>
                </div>
                <div className="student-photo-controls">
                  <label
                    className="student-file-label"
                    title="انتخاب تصویر"
                    aria-label="انتخاب تصویر پروفایل"
                    style={{ direction: "ltr" }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoChange}
                      aria-hidden="true"
                    />
                    <Icon name="bi-cloud-arrow-up" />
                    <span>انتخاب فایل تصویر</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary w-100"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon name="bi-camera" />{" "}
                    {uploading
                      ? "در حال بارگذاری…"
                      : photoSrc
                        ? "تغییر عکس پروفایل"
                        : "ذخیره عکس پروفایل"}
                  </button>
                </div>
                {photoMessage.text && (
                  <p
                    className={`student-photo-message ${photoMessage.tone}`}
                    role="status"
                  >
                    {photoMessage.text}
                  </p>
                )}
                <p className="student-photo-note">
                  <Icon name="bi-info-circle" /> همین عکس هم آواتار پروفایل
                  شماست و هم عکس مرجع تشخیص چهره. با بارگذاری عکس جدید، عکس
                  قبلی جایگزین می‌شود.
                </p>
              </article>
              <article className="content-card student-info-card">
                <div className="student-section-heading">
                  <div>
                    <span>مشخصات ثبت‌شده</span>
                    <h2>اطلاعات دانشجویی</h2>
                  </div>
                </div>
                <dl className="student-info-list">
                  <div>
                    <dt>نام و نام خانوادگی</dt>
                    <dd>{student.name}</dd>
                  </div>
                  <div>
                    <dt>شماره دانشجویی</dt>
                    <dd>{student.id}</dd>
                  </div>
                  <div>
                    <dt>رشته تحصیلی</dt>
                    <dd>{student.major || "—"}</dd>
                  </div>
                  <div>
                    <dt>ترم</dt>
                    <dd>{student.term || "—"}</dd>
                  </div>
                  <div>
                    <dt>شماره تماس</dt>
                    <dd>{student.phone || "—"}</dd>
                  </div>
                  <div>
                    <dt>وضعیت عکس</dt>
                    <dd>{photoSrc ? "ثبت شده" : "ثبت نشده"}</dd>
                  </div>
                </dl>
                <p className="student-info-note">
                  <Icon name="bi-lock" /> برای ویرایش اطلاعات هویتی با مدیر
                  سامانه تماس بگیرید.
                </p>
              </article>
            </div>
            <article className="content-card student-photo-tips">
              <div className="student-section-heading">
                <div>
                  <span>دقت بیشتر</span>
                  <h2>راهنمای عکس مناسب برای تشخیص چهره</h2>
                </div>
              </div>
              <ul>
                <li>
                  <Icon name="bi-sun" /> نور یکنواخت و کافی؛ از نور پشت سر
                  خودداری کنید.
                </li>
                <li>
                  <Icon name="bi-person-bounding-box" /> چهرهٔ روبه‌رو، کامل و
                  بدون کلاه یا ماسک.
                </li>
                <li>
                  <Icon name="bi-eyeglasses" /> از عینک تیره یا بازتاب‌دار
                  استفاده نکنید.
                </li>
                <li>
                  <Icon name="bi-image" /> فرمت JPG، PNG یا WebP با حجم حداکثر
                  ۵ مگابایت.
                </li>
              </ul>
            </article>
          </section>
        )}

        {tab === "help" && (
          <section className="student-help-section">
            <div className="student-help-hero">
              <div className="student-help-copy">
                <span className="student-welcome-eyebrow">
                  <i /> پشتیبانی و راهنما
                </span>
                <h1>چطور می‌توانیم کمک کنیم؟</h1>
                <p>
                  دستیار هوشمند حضوربان دربارهٔ امکانات سامانه، حضور و غیاب،
                  عکس پروفایل و مشکلات رایج پاسخ می‌دهد.
                </p>
                <div className="student-help-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => setHelpOpen(true)}
                  >
                    <Icon name="bi-stars" /> گفت‌وگو با دستیار
                  </button>
                  <a className="btn btn-light-outline" href={supportMailto}>
                    <Icon name="bi-envelope" /> ارسال ایمیل به مدیر
                  </a>
                </div>
              </div>
              <span className="student-help-mark">
                <Icon name="bi-headset" />
              </span>
            </div>
            <div className="student-help-grid">
              <section className="content-card student-faq-card">
                <div className="student-section-heading">
                  <div>
                    <span>پاسخ سریع</span>
                    <h2>سؤال‌های پرتکرار</h2>
                  </div>
                </div>
                <div className="student-faq-list">
                  {faqs.map((item, index) => (
                    <details
                      className="student-faq-item"
                      key={item.question}
                      open={index === 0}
                    >
                      <summary>
                        <span>{item.question}</span>
                        <Icon name="bi-chevron-down" />
                      </summary>
                      <p>{item.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
              <aside className="content-card student-contact-card">
                <div className="student-section-heading">
                  <div>
                    <span>ارتباط با ما</span>
                    <h2>راه‌های تماس</h2>
                  </div>
                </div>
                <div className="student-contact-row">
                  <span>
                    <Icon name="bi-envelope-at" />
                  </span>
                  <div>
                    <strong>رایانامهٔ مدیر سامانه</strong>
                    <a href={supportMailto}>admin@hozorban.local</a>
                  </div>
                </div>
                <div className="student-contact-row">
                  <span>
                    <Icon name="bi-chat-dots" />
                  </span>
                  <div>
                    <strong>دستیار هوشمند</strong>
                    <small>
                      پاسخ فوری دربارهٔ امکانات سامانه، بدون محدودیت ساعت.
                    </small>
                  </div>
                </div>
                <div className="student-contact-row">
                  <span>
                    <Icon name="bi-clock-history" />
                  </span>
                  <div>
                    <strong>زمان پاسخ‌گویی</strong>
                    <small>در اولین فرصت کاری</small>
                  </div>
                </div>
                <div className="student-contact-row">
                  <span>
                    <Icon name="bi-shield-lock" />
                  </span>
                  <div>
                    <strong>حریم خصوصی</strong>
                    <small>
                      اطلاعات شما فقط برای خودتان و مدیر سامانه قابل مشاهده
                      است.
                    </small>
                  </div>
                </div>
                <p className="student-contact-note">
                  <Icon name="bi-info-circle" /> برای پیگیری سریع‌تر، شمارهٔ
                  دانشجویی و نام صفحه‌ای که مشکل دارد را ذکر کنید.
                </p>
              </aside>
            </div>
          </section>
        )}
        {tab === "tickets" && (
          <section className="student-help-section">
            <div className="student-help-hero">
              <div className="student-help-copy">
                <span className="student-welcome-eyebrow">
                  <i /> پشتیبانی و درخواست‌ها
                </span>
                <h1>ثبت تیکت پشتیبانی</h1>
                <p>
                  اگر سؤالی دارید یا مشکلی در ثبت یا پیگیری حضور دارید، درخواست
                  خود را ثبت کنید؛ مدیر سامانه آن را بررسی و برایتان پاسخ می‌دهد.
                </p>
                <div className="student-help-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => setTab("help")}
                  >
                    <Icon name="bi-headset" /> بخش کمک و راهنما
                  </button>
                </div>
              </div>
              <span className="student-help-mark">
                <Icon name="bi-ticket" />
              </span>
            </div>

            <div className="student-help-grid">
              <section className="content-card student-faq-card">
                <div className="student-section-heading">
                  <div>
                    <span>ثبت درخواست</span>
                    <h2>سوال یا درخواست جدید</h2>
                  </div>
                </div>
                <label className="form-label">
                  موضوع *
                  <input
                    className="form-control"
                    value={ticketSubject}
                    onChange={(event) => setTicketSubject(event.target.value)}
                    placeholder="مثلاً مشکل در ثبت حضور از طریق اثر انگشت"
                    maxLength={200}
                  />
                </label>
                <label className="form-label" style={{ marginTop: 12 }}>
                  متن درخواست *
                  <textarea
                    className="form-control"
                    rows={5}
                    value={ticketMessage}
                    onChange={(event) => setTicketMessage(event.target.value)}
                    placeholder="شرح دقیق مسئله یا سؤال خود را بنویسید…"
                  />
                </label>
                <div className="student-actions-cell" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={
                      ticketBusy ||
                      ticketSubject.trim().length < 3 ||
                      ticketMessage.trim().length < 10
                    }
                    onClick={handleCreateTicket}
                  >
                    <Icon name="bi-send" /> {ticketBusy ? "در حال ثبت…" : "ثبت تیکت"}
                  </button>
                </div>
                {ticketNotice.text ? (
                  <p
                    className={`student-photo-message ${ticketNotice.tone}`}
                    role="status"
                  >
                    {ticketNotice.text}
                  </p>
                ) : null}
              </section>

              <aside className="content-card student-contact-card">
                <div className="student-section-heading">
                  <div>
                    <span>وضعیت درخواست‌ها</span>
                    <h2>پیگیری پاسخ‌ها</h2>
                  </div>
                </div>
                {tickets.length ? (
                  <div className="student-contact-list">
                    {tickets.map((ticket) => (
                      <div className="student-contact-row" key={ticket.id}>
                        <span>
                          <Icon name="bi-ticket" />
                        </span>
                        <div>
                          <strong>{ticket.subject}</strong>
                          <small>
                            {ticket.studentNumber} ·{" "}
                            {new Date(ticket.createdAt).toLocaleDateString("fa-IR")}
                          </small>
                          <p>{ticket.message}</p>
                          {ticket.response ? (
                            <small>{ticket.response}</small>
                          ) : null}
                        </div>
                        <Badge
                          tone={
                            ticket.status === "open"
                              ? "warning"
                              : ticket.status === "answered"
                                ? ticket.outcome === "reject"
                                  ? "danger"
                                  : "success"
                                : "neutral"
                          }
                        >
                          {ticket.status === "open"
                            ? "باز"
                            : ticket.status === "answered"
                              ? "پاسخ داده شد"
                              : "بسته شد"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="student-portal-empty-state compact">
                    <Icon name="bi-ticket" />
                    <strong>تیکتی ثبت نشده</strong>
                    <span>
                      اولین درخواست پشتیبانی خود را از بخش بالا ثبت کنید.
                    </span>
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
        {tab === "calendar" && (
          <StudentCalendar
            sessions={sessions}
            records={records}
            leaveRequests={leaveRequests}
            onLoadTrend={onLoadTrend}
          />
        )}
        {tab === "exams" && (
          <StudentExams notify={setPortalToast} />
        )}
        {tab === "leave" && (
          <section className="student-help-section">
            <div className="student-help-hero">
              <div className="student-help-copy">
                <span className="student-welcome-eyebrow">
                  <i /> مرخصی و توجیه غیبت
                </span>
                <h1>ثبت درخواست مرخصی</h1>
                <p>
                  برای روزهایی که نمی‌توانید در کلاس حاضر شوید، درخواست مرخصی
                  یا توجیه غیبت ثبت کنید. پس از تایید مدیر، وضعیت حضور شما به
                  «موجه» تغییر می‌کند.
                </p>
              </div>
              <span className="student-help-mark">
                <Icon name="bi-calendar2-check" />
              </span>
            </div>

            <div className="student-help-grid">
              <section className="content-card student-faq-card">
                <div className="student-section-heading">
                  <div>
                    <span>ثبت درخواست</span>
                    <h2>درخواست جدید</h2>
                  </div>
                </div>
                <label className="form-label">
                  نوع درخواست
                  <select
                    className="form-select"
                    value={leaveForm.type}
                    onChange={(event) =>
                      setLeaveForm((current) => ({
                        ...current,
                        type: event.target.value,
                      }))
                    }
                  >
                    <option value="leave">مرخصی</option>
                    <option value="excuse">توجیه غیبت</option>
                  </select>
                </label>
                <div className="leave-date-grid">
                  <label className="form-label">
                    از تاریخ
                    <JalaliDateInput
                      value={leaveForm.startDate}
                      onChange={(next) =>
                        setLeaveForm((current) => ({
                          ...current,
                          startDate: next,
                          endDate:
                            current.endDate && current.endDate < next
                              ? ""
                              : current.endDate,
                        }))
                      }
                      ariaLabel="تاریخ شروع مرخصی"
                    />
                  </label>
                  <label className="form-label">
                    تا تاریخ (اختیاری)
                    <JalaliDateInput
                      value={leaveForm.endDate}
                      min={leaveForm.startDate}
                      clearable
                      placeholder="همان روز"
                      onChange={(next) =>
                        setLeaveForm((current) => ({
                          ...current,
                          endDate: next,
                        }))
                      }
                      ariaLabel="تاریخ پایان مرخصی"
                    />
                  </label>
                </div>
                <label className="form-label" style={{ marginTop: 12 }}>
                  دلیل *
                  <textarea
                    className="form-control"
                    rows={4}
                    value={leaveForm.reason}
                    onChange={(event) =>
                      setLeaveForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                    placeholder="دلیل مرخصی یا توضیح غیبت را بنویسید…"
                  />
                </label>
                <label className="form-label" style={{ marginTop: 12 }}>
                  فایل پیوست (اختیاری)
                  <input
                    type="file"
                    className="form-control"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(event) =>
                      setLeaveProof(event.target.files?.[0] || null)
                    }
                  />
                </label>
                <div className="student-actions-cell" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={leaveBusy || leaveForm.reason.trim().length < 5}
                    onClick={handleCreateLeave}
                  >
                    <Icon name="bi-send" />{" "}
                    {leaveBusy ? "در حال ثبت…" : "ثبت درخواست"}
                  </button>
                </div>
                {leaveNotice.text ? (
                  <p
                    className={`student-photo-message ${leaveNotice.tone}`}
                    role="status"
                  >
                    {leaveNotice.text}
                  </p>
                ) : null}
              </section>

              <aside className="content-card student-contact-card">
                <div className="student-section-heading">
                  <div>
                    <span>وضعیت درخواست‌ها</span>
                    <h2>پیگیری مرخصی‌ها</h2>
                  </div>
                </div>
                {leaveRequests.length ? (
                  <div className="student-contact-list">
                    {leaveRequests.map((request) => (
                      <div className="student-contact-row" key={request.id}>
                        <span>
                          <Icon name="bi-calendar2-check" />
                        </span>
                        <div>
                          <strong>
                            {request.type === "leave" ? "مرخصی" : "توجیه غیبت"}
                          </strong>
                          <small>
                            {new Date(request.startDate).toLocaleDateString(
                              "fa-IR",
                            )}
                            {request.endDate !== request.startDate
                              ? ` تا ${new Date(
                                  request.endDate,
                                ).toLocaleDateString("fa-IR")}`
                              : ""}
                          </small>
                          <p>{request.reason}</p>
                          {request.adminNote ? (
                            <small>پاسخ مدیر: {request.adminNote}</small>
                          ) : null}
                        </div>
                        {requestStatusBadge(request.status)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="student-portal-empty-state compact">
                    <Icon name="bi-calendar2-x" />
                    <strong>درخواستی ثبت نشده</strong>
                    <span>
                      اولین درخواست مرخصی یا توجیه خود را از بخش بالا ثبت کنید.
                    </span>
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
        {objectionTarget ? (
          <div
            className="modal-backdrop-custom"
            onClick={(event) => {
              if (event.target === event.currentTarget) setObjectionTarget(null);
            }}
          >
            <div className="custom-modal" role="dialog" aria-modal="true">
              <div className="ticket-modal-head">
                <div>
                  <span>اعتراض به وضعیت حضور</span>
                  <h3>{objectionTarget.course || "جلسهٔ درسی"}</h3>
                  <div className="ticket-modal-student">
                    <Icon name="bi-calendar-event" />
                    <div>
                      <strong>
                        {formatDate(
                          objectionTarget.sessionDate || objectionTarget.date,
                        )}
                        {objectionTarget.time ? ` · ${objectionTarget.time}` : ""}
                      </strong>
                      <span className="student-id-small">
                        وضعیت فعلی: {statusLabel(objectionTarget.status)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="ticket-modal-close"
                  aria-label="بستن"
                  onClick={() => setObjectionTarget(null)}
                >
                  <Icon name="bi-x-lg" />
                </button>
              </div>
              <label className="form-label ticket-modal-label">
                دلیل اعتراض
                <textarea
                  className="form-control"
                  rows={4}
                  value={objectionReason}
                  onChange={(event) => setObjectionReason(event.target.value)}
                  placeholder="توضیح دهید چرا معتقدید این وضعیت اشتباه ثبت شده است…"
                />
              </label>
              {objectionNotice.text ? (
                <p
                  className={`student-photo-message ${objectionNotice.tone}`}
                  role="status"
                >
                  {objectionNotice.text}
                </p>
              ) : null}
              <div className="ticket-modal-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={objectionBusy || objectionReason.trim().length < 5}
                  onClick={handleCreateObjection}
                >
                  <Icon name="bi-send" />{" "}
                  {objectionBusy ? "در حال ثبت…" : "ثبت اعتراض"}
                </button>
                <button
                  className="btn btn-light-outline"
                  type="button"
                  onClick={() => setObjectionTarget(null)}
                >
                  انصراف
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
      <button
        className="student-help-fab"
        type="button"
        onClick={() => setHelpOpen(true)}
        title="دستیار راهنما"
        aria-label="باز کردن دستیار راهنما"
      >
        <Icon name="bi-stars" />
        <span>کمک</span>
      </button>
      <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export function Teachers({
  teachers = [],
  loading = false,
  onRefresh,
  onCreate,
  onAddExisting,
  onLookup,
  onRemove,
  onToggleActive,
  onResetPassword,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("new");
  const [form, setForm] = useState({ fullName: "", email: "" });
  const [lookup, setLookup] = useState(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [resetResult, setResetResult] = useState(null);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const homeCount = teachers.filter((teacher) => teacher.isHome).length;
  const guestCount = teachers.length - homeCount;

  function openModal(nextMode) {
    setMode(nextMode);
    setForm({ fullName: "", email: "" });
    setLookup(null);
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (pending || lookupPending) return;
    setModalOpen(false);
    setLookup(null);
    setFormError("");
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setLookup(null);
    setFormError("");
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function runLookup() {
    const email = form.email.trim();
    if (!validEmail(email)) {
      setFormError("ایمیل معتبر وارد کنید.");
      return;
    }
    setFormError("");
    setLookupPending(true);
    try {
      const result = await onLookup(email);
      setLookup(result?.teacher || null);
    } catch (error) {
      setLookup(null);
      setFormError(error.message || "بررسی ایمیل انجام نشد.");
    } finally {
      setLookupPending(false);
    }
  }

  async function submit() {
    const email = form.email.trim();
    if (!validEmail(email)) {
      setFormError("ایمیل معتبر وارد کنید.");
      return;
    }
    setFormError("");
    setPending(true);
    try {
      if (mode === "new") {
        if (form.fullName.trim().length < 2) {
          setFormError("نام و نام خانوادگی استاد را وارد کنید.");
          return;
        }
        const result = await onCreate({
          fullName: form.fullName.trim(),
          email,
        });
        setModalOpen(false);
        setForm({ fullName: "", email: "" });
        setCreated(result);
      } else {
        if (!lookup) {
          setFormError("ابتدا ایمیل را بررسی کنید.");
          return;
        }
        if (lookup.isHome || lookup.isMember) {
          setFormError("این استاد از قبل عضو دانشکدهٔ شماست.");
          return;
        }
        if (!lookup.isActive) {
          setFormError("حساب این استاد غیرفعال است.");
          return;
        }
        await onAddExisting(lookup.email);
        setModalOpen(false);
        setLookup(null);
        setForm({ fullName: "", email: "" });
      }
    } catch (error) {
      setFormError(error.message || "عملیات انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  async function copyCredentials() {
    if (!created) return;
    const text = `ایمیل: ${created.teacher.email}\nرمز موقت: ${created.temporaryPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function resetPassword(teacherId) {
    if (!onResetPassword) return;
    try {
      const result = await onResetPassword(teacherId);
      if (result) setResetResult(result);
    } catch (error) {
      // Errors are shown by the parent caller via notify; optionally show here
      console.error(error);
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="مدیریت کاربران"
        title="اساتید دانشکده"
        description="استاد جدید بسازید یا استاد موجود در دانشکده‌های دیگر را به این دانشکده اضافه کنید."
        action={
          <div className="student-actions-cell">
            <button className="btn btn-primary" onClick={() => openModal("new")}>
              <Icon name="bi-plus-lg" /> افزودن استاد
            </button>
            <button className="btn btn-light-outline" onClick={onRefresh}>
              <Icon name="bi-arrow-clockwise" /> بروزرسانی
            </button>
          </div>
        }
      />

      <div className="stat-grid">
        <StatCard
          icon="bi-person-workspace"
          label="کل اساتید دانشکده"
          value={teachers.length.toLocaleString("fa-IR")}
          detail="استاد فعال و غیرفعال"
          color="blue"
        />
        <StatCard
          icon="bi-house-check"
          label="دانشکدهٔ اصلی"
          value={homeCount.toLocaleString("fa-IR")}
          detail="حساب متعلق به این دانشکده"
          color="green"
        />
        <StatCard
          icon="bi-people"
          label="عضو مهمان"
          value={guestCount.toLocaleString("fa-IR")}
          detail="افزوده‌شده از دانشکده‌های دیگر"
          color="orange"
        />
      </div>

      <div className="content-card data-card">
        {loading && !teachers.length ? (
          <SkeletonTable rows={4} columns={6} />
        ) : teachers.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle teachers-table">
              <thead>
                <tr>
                  <th>نام و نام خانوادگی</th>
                  <th>ایمیل (نام کاربری)</th>
                  <th>نوع عضویت</th>
                  <th>افزودن‌کننده</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td>
                      <strong>{teacher.fullName}</strong>
                    </td>
                    <td dir="ltr" style={{ textAlign: "right" }}>
                      {teacher.email}
                    </td>
                    <td>
                      <Badge tone={teacher.isHome ? "success" : "warning"}>
                        {teacher.isHome ? "دانشکدهٔ اصلی" : "عضو مهمان"}
                      </Badge>
                    </td>
                    <td title={teacher.addedByEmail || ""}>
                      {teacher.addedByName ? (
                        <>
                          <strong>{teacher.addedByName}</strong>
                          {teacher.addedAt && (
                            <span className="student-id-small">
                              {new Date(teacher.addedAt).toLocaleDateString("fa-IR", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              })}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="page-note" style={{ margin: 0 }}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={teacher.isActive ? "success" : "danger"}>
                        {teacher.isActive ? "فعال" : "غیرفعال"}
                      </Badge>
                    </td>
                    <td>
                      <div className="student-actions-cell">
                        {!teacher.isHome && (
                          <button
                            className="btn btn-light-outline"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `استاد «${teacher.fullName}» از این دانشکده حذف شود؟`,
                                )
                              )
                                onRemove(teacher.id);
                            }}
                          >
                            <Icon name="bi-person-dash" /> حذف عضویت
                          </button>
                        )}
                        {teacher.isHome && teacher.otherFaculties === 0 && (
                          <button
                            className="btn btn-light-outline"
                            onClick={() => {
                              if (
                                teacher.isActive &&
                                !window.confirm(
                                  `حساب استاد «${teacher.fullName}» غیرفعال شود؟ ورود او به سامانه مسدود می‌شود.`,
                                )
                              )
                                return;
                              onToggleActive(teacher.id, !teacher.isActive);
                            }}
                          >
                            <Icon
                              name={
                                teacher.isActive
                                  ? "bi-person-slash"
                                  : "bi-person-check"
                              }
                            />
                            {teacher.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                          </button>
                        )}
                        {teacher.isHome && (
                          <button
                            className="btn btn-light-outline"
                            onClick={() => resetPassword(teacher.id)}
                          >
                            <Icon name="bi-arrow-counterclockwise" /> بازنشانی رمز
                          </button>
                        )}
                        {teacher.isHome && teacher.otherFaculties > 0 && (
                          <span className="page-note">
                            عضو {teacher.otherFaculties.toLocaleString("fa-IR")}{" "}
                            دانشکدهٔ دیگر
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-person-workspace"
            title="استادی ثبت نشده است"
            text="با دکمهٔ «افزودن استاد» اولین استاد این دانشکده را بسازید."
          />
        )}
      </div>

      {modalOpen && (
        <div
          className="modal-backdrop-custom"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className="custom-modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 520 }}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">مدیریت اساتید</div>
                <h3>افزودن استاد به دانشکده</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={pending || lookupPending}
                onClick={closeModal}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>

            <div className="student-actions-cell" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`btn ${mode === "new" ? "btn-primary" : "btn-light-outline"}`}
                onClick={() => switchMode("new")}
              >
                <Icon name="bi-person-plus" /> استاد جدید
              </button>
              <button
                type="button"
                className={`btn ${mode === "existing" ? "btn-primary" : "btn-light-outline"}`}
                onClick={() => switchMode("existing")}
              >
                <Icon name="bi-person-check" /> افزودن استاد موجود
              </button>
            </div>

            {mode === "new" ? (
              <p className="page-note">
                رمز عبور توسط سامانه ساخته می‌شود و فقط یک‌بار به شما نمایش داده
                می‌شود؛ آن را به استاد تحویل دهید.
              </p>
            ) : (
              <p className="page-note">
                ایمیل استاد را بررسی کنید؛ اگر در دانشکدهٔ دیگری حساب داشته باشد،
                همان حساب و رمز قبلی به این دانشکده اضافه می‌شود.
              </p>
            )}

            <div className="course-form-grid" style={{ marginTop: 10 }}>
              {mode === "new" && (
                <label className="form-label">
                  نام و نام خانوادگی
                  <input
                    className="form-control"
                    value={form.fullName}
                    disabled={pending}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fullName: event.target.value,
                      }))
                    }
                    placeholder="مثلاً محمد رضایی"
                  />
                </label>
              )}
              <label className="form-label">
                ایمیل (نام کاربری)
                <input
                  className="form-control"
                  type="email"
                  dir="ltr"
                  value={form.email}
                  disabled={pending || lookupPending}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }));
                    setLookup(null);
                  }}
                  placeholder="teacher@example.com"
                />
              </label>
            </div>

            {mode === "existing" && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-light-outline"
                  disabled={lookupPending || pending || !form.email.trim()}
                  onClick={runLookup}
                >
                  <Icon name="bi-search" />{" "}
                  {lookupPending ? "در حال بررسی…" : "بررسی ایمیل"}
                </button>
                {lookup && (
                  <div className="page-note" style={{ marginTop: 10 }}>
                    <strong>{lookup.fullName}</strong> · دانشکدهٔ اصلی:{" "}
                    {lookup.homeFaculty}
                    {lookup.isHome || lookup.isMember ? (
                      <span> · از قبل عضو این دانشکده است</span>
                    ) : null}
                    {!lookup.isActive ? <span> · حساب غیرفعال است</span> : null}
                  </div>
                )}
                {lookup === null && !lookupPending && formError === "" && (
                  <span className="page-note">برای ادامه، ایمیل را بررسی کنید.</span>
                )}
              </div>
            )}

            {formError && (
              <p className="login-error" role="alert" style={{ marginTop: 10 }}>
                {formError}
              </p>
            )}

            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                disabled={
                  pending ||
                  lookupPending ||
                  (mode === "existing" &&
                    (!lookup || lookup.isHome || lookup.isMember || !lookup.isActive))
                }
                onClick={submit}
              >
                {pending
                  ? "در حال ذخیره…"
                  : mode === "new"
                    ? "ساخت استاد"
                    : "افزودن به دانشکده"}
              </button>
              <button
                className="btn btn-light"
                disabled={pending || lookupPending}
                onClick={closeModal}
              >
                انصراف
              </button>
            </div>
          </section>
        </div>
      )}

      {created && (
        <div
          className="modal-backdrop-custom"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreated(null);
          }}
        >
          <section
            className="custom-modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 480 }}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">استاد ساخته شد</div>
                <h3>اطلاعات ورود استاد</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setCreated(null)}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <p className="page-note">
              این رمز فقط یک‌بار نمایش داده می‌شود. آن را به استاد تحویل دهید تا از
              صفحهٔ ورود، دانشکدهٔ مربوطه را انتخاب کند.
            </p>
            <div className="teacher-credential">
              <div>
                <span>نام کاربری</span>
                <strong dir="ltr">{created.teacher.email}</strong>
              </div>
              <div>
                <span>رمز موقت</span>
                <strong dir="ltr">{created.temporaryPassword}</strong>
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={copyCredentials}>
                <Icon name="bi-clipboard" /> {copied ? "کپی شد" : "کپی اطلاعات"}
              </button>
              <button className="btn btn-light" onClick={() => setCreated(null)}>
                بستن
              </button>
            </div>
          </section>
        </div>
      )}

      {resetResult && (
        <div
          className="modal-backdrop-custom"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setResetResult(null);
          }}
        >
          <section
            className="custom-modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 520 }}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">مدیریت اساتید</div>
                <h3>رمز موقت استاد بازنشانی شد</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setResetResult(null)}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <p className="page-note">
              این رمز فقط یک‌بار نمایش داده می‌شود. آن را به استاد تحویل دهید تا
              وارد شود و سپس رمز خود را عوض کند.
            </p>
            <div className="teacher-credential">
              <div>
                <span>نام کاربری</span>
                <strong dir="ltr">{resetResult.teacher.email}</strong>
              </div>
              <div>
                <span>رمز موقت</span>
                <strong dir="ltr">{resetResult.temporaryPassword}</strong>
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => {
                const text = `ایمیل: ${resetResult.teacher.email}\nرمز موقت: ${resetResult.temporaryPassword}`;
                navigator.clipboard.writeText(text).then(() => {});
              }}>
                <Icon name="bi-clipboard" /> کپی اطلاعات
              </button>
              <button className="btn btn-light" onClick={() => setResetResult(null)}>
                بستن
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function Registrations({ registrations = [], onApprove, onReject, onRefresh }) {
  return (
    <>
      <PanelTitle
        eyebrow="مدیریت کاربران"
        title="پذیرش درخواست‌های ثبت‌نام"
        description="درخواست‌های ثبت‌نام دانشجویان جدید را بررسی و تأیید کنید."
        action={
          <button className="btn btn-light-outline" onClick={onRefresh}>
            <Icon name="bi-arrow-clockwise" /> بروزرسانی
          </button>
        }
      />
      <div className="content-card data-card">
        {registrations.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>نام و نام خانوادگی</th>
                  <th>نام کاربری</th>
                  <th>کد ملی</th>
                  <th>رشته/ترم</th>
                  <th>تلفن</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong></td>
                    <td>{r.username}</td>
                    <td>{r.nationalId || "—"}</td>
                    <td>{r.major || "—"} {r.term ? `· ترم ${r.term}` : ""}</td>
                    <td>{r.phone || "—"}</td>
                    <td>
                      <Badge
                        tone={
                          r.status === "approved"
                            ? "success"
                            : r.status === "rejected"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {r.status === "approved"
                          ? "تأیید شده"
                          : r.status === "rejected"
                            ? "رد شده"
                            : "در انتظار"}
                      </Badge>
                    </td>
                    <td>
                      {r.status === "pending" && (
                        <div className="student-actions-cell">
                          <button
                            className="btn btn-success-soft"
                            onClick={() => onApprove(r.id)}
                          >
                            <Icon name="bi-check-lg" /> تأیید
                          </button>
                          <button
                            className="btn btn-light-outline"
                            onClick={() => onReject(r.id)}
                          >
                            <Icon name="bi-x-lg" /> رد
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-person-check"
            title="درخواستی موجود نیست"
            text="هنوز درخواست ثبت‌نامی ثبت نشده است."
          />
        )}
      </div>
    </>
  );
}

export function Tickets({
  tickets = [],
  students = [],
  loading = false,
  onRespond,
  onClose,
  onRefresh,
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [respondingId, setRespondingId] = useState("");
  const [responseText, setResponseText] = useState("");
  const [outcome, setOutcome] = useState("accept");

  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    answered: tickets.filter((t) => t.status === "answered").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };

  const filteredTickets = tickets.filter((ticket) => {
    if (statusFilter !== "all" && ticket.status !== statusFilter) return false;
    const query = normalizeSearch(search);
    if (query) {
      const haystack = normalizeSearch(
        [
          ticket.subject,
          ticket.message,
          ticket.studentName,
          String(ticket.studentNumber || ""),
          ticket.response || "",
        ].join(" "),
      );
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const selectedTicket =
    tickets.find((ticket) => ticket.id === respondingId) || null;

  const photoByStudentNumber = new Map(
    students
      .filter((student) => student && student.id != null)
      .map((student) => [String(student.id).trim(), student.faceImage || ""]),
  );

  function photoForTicket(ticket) {
    if (!ticket) return "";
    const number = String(ticket.studentNumber || "").trim();
    const byNumber = number ? photoByStudentNumber.get(number) : "";
    if (byNumber) return byNumber;
    const byName = students.find(
      (student) => student.name === ticket.studentName,
    );
    return byName?.faceImage || "";
  }

  useEffect(() => {
    onRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function statusBadge(ticket) {
    if (ticket.status === "closed") {
      return <Badge tone="neutral">بسته شد</Badge>;
    }
    if (ticket.status === "answered") {
      return (
        <Badge tone={ticket.outcome === "reject" ? "danger" : "success"}>
          {ticket.outcome === "reject" ? "رد شده" : "پاسخ داده شد"}
        </Badge>
      );
    }
    return <Badge tone="warning">باز</Badge>;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function truncate(text, max = 90) {
    const value = String(text || "");
    return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
  }

  async function handleRespond() {
    if (!selectedTicket) return;
    if (responseText.trim().length < 2) return;
    await onRespond(selectedTicket.id, {
      response: responseText.trim(),
      outcome,
    });
    setRespondingId("");
    setResponseText("");
    setOutcome("accept");
  }

  const statCards = [
    { key: "all", icon: "bi-ticket-perforated", color: "blue", label: "کل تیکت‌ها", detail: "همهٔ درخواست‌های دریافتی" },
    { key: "open", icon: "bi-envelope-open", color: "orange", label: "باز", detail: "نیازمند بررسی و پاسخ" },
    { key: "answered", icon: "bi-patch-check", color: "green", label: "پاسخ داده", detail: "بررسی‌شده به‌صورت تایید/رد" },
    { key: "closed", icon: "bi-check2-circle", color: "purple", label: "بسته‌شده", detail: "کیس خاتمه‌یافته" },
  ];

  const filterChips = [
    { key: "all", label: "همه" },
    { key: "open", label: "باز" },
    { key: "answered", label: "پاسخ داده" },
    { key: "closed", label: "بسته‌شده" },
  ];

  return (
    <>
      <PanelTitle
        eyebrow="پشتیبانی دانشجویی"
        title="تیکت‌های پشتیبانی"
        description="درخواست‌های ثبت‌شده توسط دانشجویان، پاسخ و رهگیری وضعیت آن‌ها."
        action={
          <button className="btn btn-light-outline" onClick={onRefresh}>
            <Icon name="bi-arrow-clockwise" /> بروزرسانی
          </button>
        }
      />

      {loading && !tickets.length ? (
        <SkeletonCards />
      ) : (
        <div className="ticket-stat-grid">
          {statCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`ticket-stat-btn ${statusFilter === card.key ? "active" : ""}`}
              onClick={() => setStatusFilter(card.key)}
              title={`فیلتر بر اساس «${card.label}»`}
            >
              <StatCard
                icon={card.icon}
                color={card.color}
                label={card.label}
                value={counts[card.key].toLocaleString("fa-IR")}
                detail={card.detail}
              />
            </button>
          ))}
        </div>
      )}

      <div className="content-card data-card">
        <div className="table-toolbar ticket-toolbar">
          <div className="ticket-filter-chips" role="group" aria-label="فیلتر وضعیت">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={`ticket-chip ${statusFilter === chip.key ? "active" : ""}`}
                onClick={() => setStatusFilter(chip.key)}
              >
                {chip.label}
                <span>{counts[chip.key].toLocaleString("fa-IR")}</span>
              </button>
            ))}
          </div>
          <div className="search-wrap ticket-search">
            <Icon name="bi-search" />
            <input
              type="text"
              className="form-control"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
              placeholder="جستجو در موضوع، متن یا دانشجو…"
              aria-label="جستجو در تیکت‌ها"
            />
            {search ? (
              <button
                type="button"
                className="ticket-search-clear"
                aria-label="پاک کردن جستجو"
                onClick={() => setSearch("")}
              >
                <Icon name="bi-x-lg" />
              </button>
            ) : null}
          </div>
        </div>

        {loading && !tickets.length ? (
          <SkeletonTable rows={5} columns={6} />
        ) : filteredTickets.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>دانشجو</th>
                  <th>موضوع</th>
                  <th>متن درخواست</th>
                  <th>وضعیت</th>
                  <th>پاسخ</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket, index) => (
                  <tr key={ticket.id}>
                    <td>
                      <div className="student-cell">
                        <StudentAvatar
                          name={ticket.studentName}
                          photo={photoForTicket(ticket)}
                          index={index}
                        />
                        <div>
                          <strong>{ticket.studentName}</strong>
                          <span className="student-id-small">
                            {ticket.studentNumber}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ticket-subject-cell">
                        <strong
                          className={ticket.status === "open" ? "is-open" : ""}
                          title={
                            ticket.status === "open"
                              ? `${ticket.subject} — برای پاسخ کلیک کنید`
                              : ticket.subject
                          }
                          onClick={() => {
                            if (ticket.status === "open") {
                              setRespondingId(ticket.id);
                              setResponseText("");
                              setOutcome("accept");
                            }
                          }}
                        >
                          {ticket.subject}
                        </strong>
                        <span>{formatDate(ticket.createdAt)}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className="ticket-text-cell"
                        title={ticket.message}
                      >
                        {truncate(ticket.message, 80)}
                      </span>
                    </td>
                    <td>{statusBadge(ticket)}</td>
                    <td>
                      {ticket.response ? (
                        <span
                          className="ticket-text-cell"
                          title={ticket.response}
                        >
                          {truncate(ticket.response, 70)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {ticket.status === "open" ? (
                        <div className="ticket-actions-cell">
                          <button
                            className="btn btn-success-soft btn-sm"
                            onClick={() => {
                              setRespondingId(ticket.id);
                              setResponseText("");
                              setOutcome("accept");
                            }}
                          >
                            <Icon name="bi-chat-left-text" /> پاسخ
                          </button>
                          <button
                            className="btn btn-light-outline btn-sm"
                            onClick={() => onClose(ticket.id)}
                          >
                            <Icon name="bi-x-lg" /> بستن
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-ticket"
            title={search ? "نتیجه‌ای یافت نشد" : "تیکتی موجود نیست"}
            text={
              search
                ? "موردی مطابق جستجو یا فیلتر انتخابی پیدا نشد."
                : "هنوز درخواست پشتیبانی ثبت نشده است."
            }
          />
        )}
      </div>

      {selectedTicket ? (
        <div
          className="modal-backdrop-custom"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setRespondingId("");
              setResponseText("");
              setOutcome("accept");
            }
          }}
        >
          <div className="custom-modal" role="dialog" aria-modal="true">
            <div className="ticket-modal-head">
              <div>
                <span>پاسخ به درخواست</span>
                <h3>{selectedTicket.subject}</h3>
                <div className="ticket-modal-student">
                  <StudentAvatar
                    name={selectedTicket.studentName}
                    photo={photoForTicket(selectedTicket)}
                    index={0}
                  />
                  <div>
                    <strong>
                      {selectedTicket.studentName} · {selectedTicket.studentNumber}
                    </strong>
                    <time>{formatDate(selectedTicket.createdAt)}</time>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="ticket-modal-close"
                aria-label="بستن"
                onClick={() => {
                  setRespondingId("");
                  setResponseText("");
                  setOutcome("accept");
                }}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <div className="ticket-modal-message">
              <Icon name="bi-chat-left-quote" />
              <p>{selectedTicket.message}</p>
            </div>
            <label className="form-label ticket-modal-label">
              متن پاسخ
              <textarea
                className="form-control"
                rows={4}
                value={responseText}
                onChange={(event) => setResponseText(event.target.value)}
                placeholder="متن پاسخ یا نتیجهٔ بررسی را اینجا بنویسید…"
                autoFocus
              />
            </label>
            <div className="ticket-modal-label">
              نتیجهٔ بررسی
              <div className="ticket-outcome-toggle" role="group">
                <button
                  type="button"
                  className={outcome === "accept" ? "active" : ""}
                  onClick={() => setOutcome("accept")}
                >
                  <Icon name="bi-check2" /> تایید
                </button>
                <button
                  type="button"
                  className={outcome === "reject" ? "active" : ""}
                  onClick={() => setOutcome("reject")}
                >
                  <Icon name="bi-x-lg" /> رد
                </button>
              </div>
            </div>
            <div className="ticket-modal-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleRespond}
                disabled={responseText.trim().length < 2}
              >
                <Icon name="bi-send" /> ثبت پاسخ
              </button>
              <button
                className="btn btn-light-outline"
                type="button"
                onClick={() => {
                  setRespondingId("");
                  setResponseText("");
                  setOutcome("accept");
                }}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ================= پشتیبانی ================= */

export function Support({
  role = "teacher",
  tickets = [],
  loading = false,
  onRefresh,
  onOpenHelp,
  onNavigate,
}) {
  const isAdmin = role === "admin";
  const roleLabel = isAdmin ? "مدیر" : "استاد";
  const supportMailto = `mailto:admin@hozorban.local?subject=${encodeURIComponent(
    `درخواست پشتیبانی - پنل ${roleLabel}`,
  )}&body=${encodeURIComponent(
    `نام:\nنقش: ${roleLabel}\n\nمتن درخواست:\n`,
  )}`;

  const faqs = [
    {
      question: "چطور حضور دانشجویان را در کلاس ثبت کنم؟",
      answer:
        "از بخش «ثبت دستی حضور»، «تشخیص چهره»، «تشخیص صدا» یا «دوربین کلاس» استفاده کنید. پس از پایان کلاس، جلسه را نهایی کنید تا وضعیت‌ها قطعی شوند.",
    },
    {
      question: "اگر دوربین یا میکروفون کار نکند چه کنم؟",
      answer:
        "ابتدا از بخش «تنظیمات» بررسی مرورگر را انجام دهید و دسترسی دوربین/میکروفون را در مرورگر مجاز کنید. از مرورگر به‌روز و اتصال امن (localhost یا HTTPS) استفاده کنید.",
    },
    {
      question: "چرا دانشجویی در فهرست کلاس دیده نمی‌شود؟",
      answer:
        "دانشجو باید در همان دانشکده و در فهرست ثبت‌نام کلاس باشد. در صورت نیاز از مدیر سامانه بخواهید عضویت دانشجو را در درس اصلاح کند.",
    },
    {
      question: "جلسهٔ کلاس را چطور ایجاد یا نهایی کنم؟",
      answer:
        "در بخش «جلسات کلاس» جلسهٔ جدید بسازید و تاریخ و ساعت آن را مشخص کنید. پس از پایان، دکمهٔ نهایی‌سازی را بزنید تا گزارش‌ها به‌روز شوند.",
    },
    {
      question: "اگر تیکت یا درخواست دانشجویی نیاز به پیگیری داشت چه کنم؟",
      answer: isAdmin
        ? "از تب «تیکت‌ها» می‌توانید درخواست‌های دانشجویان را بررسی، پاسخ و بسته‌بندی کنید."
        : "درخواست‌های دانشجویان توسط مدیر سامانه بررسی می‌شود. در صورت مشاهدهٔ مشکل، از طریق ایمیل یا دستیار هوشمند به مدیر اطلاع دهید.",
    },
  ];

  const list = Array.isArray(tickets) ? tickets : [];

  function statusBadge(ticket) {
    if (!ticket) return null;
    if (ticket.status === "closed")
      return <Badge tone="neutral">بسته شد</Badge>;
    if (ticket.status === "answered")
      return (
        <Badge tone={ticket.outcome === "reject" ? "danger" : "success"}>
          {ticket.outcome === "reject" ? "رد شده" : "پاسخ داده شد"}
        </Badge>
      );
    return <Badge tone="warning">باز</Badge>;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function truncate(text, max = 90) {
    const value = String(text || "");
    return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
  }

  return (
    <>
      <PanelTitle
        eyebrow="پشتیبانی"
        title="پشتیبانی و راهنما"
        description="پاسخ سؤال‌های پرتکرار، ارتباط با مدیر سامانه و پیگیری درخواست‌های شما."
        action={
          <button
            className="btn btn-light-outline"
            type="button"
            onClick={onRefresh}
          >
            <Icon name="bi-arrow-clockwise" /> بروزرسانی
          </button>
        }
      />
      <section className="student-help-section">
        <div className="student-help-hero">
          <div className="student-help-copy">
            <span className="student-welcome-eyebrow">
              <i /> پشتیبانی و راهنما
            </span>
            <h1>چطور می‌توانیم کمک کنیم؟</h1>
            <p>
              دستیار هوشمند حضوربان دربارهٔ امکانات سامانه، حضور و غیاب و
              مشکلات رایج پاسخ می‌دهد. برای موارد خاص نیز می‌توانید به مدیر
              سامانه ایمیل بزنید.
            </p>
            <div className="student-help-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={onOpenHelp}
              >
                <Icon name="bi-stars" /> گفت‌وگو با دستیار
              </button>
              <a className="btn btn-light-outline" href={supportMailto}>
                <Icon name="bi-envelope" /> ارسال ایمیل به مدیر
              </a>
              {isAdmin ? (
                <button
                  className="btn btn-light-outline"
                  type="button"
                  onClick={() => onNavigate?.("tickets")}
                >
                  <Icon name="bi-ticket" /> مدیریت تیکت‌ها
                </button>
              ) : null}
            </div>
          </div>
          <span className="student-help-mark">
            <Icon name="bi-headset" />
          </span>
        </div>

        <div className="student-help-grid">
          <section className="content-card student-faq-card">
            <div className="student-section-heading">
              <div>
                <span>پاسخ سریع</span>
                <h2>سؤال‌های پرتکرار</h2>
              </div>
            </div>
            <div className="student-faq-list">
              {faqs.map((item, index) => (
                <details
                  className="student-faq-item"
                  key={item.question}
                  open={index === 0}
                >
                  <summary>
                    <span>{item.question}</span>
                    <Icon name="bi-chevron-down" />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <aside className="content-card student-contact-card">
            <div className="student-section-heading">
              <div>
                <span>ارتباط با ما</span>
                <h2>راه‌های تماس</h2>
              </div>
            </div>
            <div className="student-contact-row">
              <span>
                <Icon name="bi-envelope-at" />
              </span>
              <div>
                <strong>رایانامهٔ مدیر سامانه</strong>
                <a href={supportMailto}>admin@hozorban.local</a>
              </div>
            </div>
            <div className="student-contact-row">
              <span>
                <Icon name="bi-chat-dots" />
              </span>
              <div>
                <strong>دستیار هوشمند</strong>
                <small>
                  پاسخ فوری دربارهٔ امکانات سامانه، بدون محدودیت ساعت.
                </small>
              </div>
            </div>
            <div className="student-contact-row">
              <span>
                <Icon name="bi-clock-history" />
              </span>
              <div>
                <strong>زمان پاسخ‌گویی</strong>
                <small>در اولین فرصت کاری</small>
              </div>
            </div>
            <div className="student-contact-row">
              <span>
                <Icon name="bi-shield-lock" />
              </span>
              <div>
                <strong>حریم خصوصی</strong>
                <small>
                  اطلاعات درخواست‌های شما فقط برای خودتان و مدیر سامانه قابل
                  مشاهده است.
                </small>
              </div>
            </div>
            <p className="student-contact-note">
              <Icon name="bi-info-circle" /> برای پیگیری سریع‌تر، نام صفحه و
              شرح دقیق مشکل را ذکر کنید.
            </p>
          </aside>
        </div>

        <section className="content-card data-card">
          <div className="table-toolbar">
            <div>
              <strong>درخواست‌های من</strong>
            </div>
            <small className="text-muted">
              {isAdmin
                ? "برای پاسخ و مدیریت کامل، از تب «تیکت‌ها» استفاده کنید."
                : "درخواست‌های ثبت‌شده و پاسخ مدیر سامانه در این بخش نمایش داده می‌شود."}
            </small>
          </div>
          {loading && !list.length ? (
            <SkeletonTable rows={3} columns={4} />
          ) : list.length ? (
            <div className="table-responsive">
              <table className="table custom-table align-middle">
                <thead>
                  <tr>
                    <th>موضوع</th>
                    <th>متن درخواست</th>
                    <th>وضعیت</th>
                    <th>پاسخ</th>
                    <th>تاریخ</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((ticket) => (
                    <tr key={ticket.id}>
                      <td>
                        <strong>{ticket.subject}</strong>
                      </td>
                      <td>
                        <span className="ticket-text-cell" title={ticket.message}>
                          {truncate(ticket.message)}
                        </span>
                      </td>
                      <td>{statusBadge(ticket)}</td>
                      <td>
                        <span className="ticket-text-cell" title={ticket.response || ""}>
                          {ticket.response ? truncate(ticket.response) : "—"}
                        </span>
                      </td>
                      <td>{formatDate(ticket.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="bi-ticket"
              title="درخواستی ثبت نشده"
              text={
                isAdmin
                  ? "هنوز درخواستی از سوی کاربران ثبت نشده است."
                  : "برای ثبت درخواست جدید با مدیر سامانه تماس بگیرید."
              }
            />
          )}
        </section>
      </section>
    </>
  );
}

/* ================= مرخصی و اعتراض ================= */

function RequestReviewModal({
  title,
  subtitle,
  studentLabel,
  message,
  approveLabel = "تایید",
  rejectLabel = "رد",
  busy,
  groupTitle,
  onClose,
  onConfirm,
}) {
  const [status, setStatus] = useState("approved");
  const [note, setNote] = useState("");
  const [applyToGroup, setApplyToGroup] = useState(true);
  return (
    <div
      className="modal-backdrop-custom"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="custom-modal" role="dialog" aria-modal="true">
        <div className="ticket-modal-head">
          <div>
            <span>{subtitle}</span>
            <h3>{title}</h3>
            <div className="ticket-modal-student">
              <Icon name="bi-person-badge" />
              <div>
                <strong>{studentLabel}</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ticket-modal-close"
            aria-label="بستن"
            onClick={onClose}
          >
            <Icon name="bi-x-lg" />
          </button>
        </div>
        <div className="ticket-modal-message">
          <Icon name="bi-chat-left-quote" />
          <p>{message}</p>
        </div>
        <label className="form-label ticket-modal-label">
          یادداشت مدیر (اختیاری)
          <textarea
            className="form-control"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="توضیح یا دلیل تصمیم را بنویسید…"
          />
        </label>
        <div className="ticket-modal-label">
          نتیجهٔ بررسی
          <div className="ticket-outcome-toggle" role="group">
            <button
              type="button"
              className={status === "approved" ? "active" : ""}
              onClick={() => setStatus("approved")}
            >
              <Icon name="bi-check2" /> {approveLabel}
            </button>
            <button
              type="button"
              className={status === "rejected" ? "active" : ""}
              onClick={() => setStatus("rejected")}
            >
              <Icon name="bi-x-lg" /> {rejectLabel}
            </button>
          </div>
        </div>
        {groupTitle ? (
          <label className="request-group-option">
            <input
              type="checkbox"
              checked={applyToGroup}
              onChange={(event) => setApplyToGroup(event.target.checked)}
            />
            <span>
              اعمال این تصمیم روی همهٔ اعضای گروه «{groupTitle}»
            </span>
          </label>
        ) : null}
        <div className="ticket-modal-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                status,
                adminNote: note.trim(),
                applyToGroup: Boolean(groupTitle && applyToGroup),
              })
            }
          >
            <Icon name="bi-send" /> {busy ? "در حال ثبت…" : "ثبت تصمیم"}
          </button>
          <button className="btn btn-light-outline" type="button" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

function requestStatusBadge(status) {
  if (status === "approved") return <Badge tone="success">تایید شد</Badge>;
  if (status === "rejected") return <Badge tone="danger">رد شد</Badge>;
  return <Badge tone="warning">در انتظار</Badge>;
}

function recordStatusLabel(status) {
  return (
    {
      present: "حاضر",
      late: "تأخیر",
      absent: "غایب",
      excused: "موجه",
      left_early: "خروج زودهنگام",
      unmarked: "ثبت‌نشده",
    }[status] ||
    status ||
    "—"
  );
}

function GroupLeaveModal({ students = [], busy, onClose, onSubmit }) {
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("leave");
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [approveNow, setApproveNow] = useState(true);
  const [error, setError] = useState("");

  const filtered = students.filter((student) =>
    `${student.name} ${student.id}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function toggle(student) {
    if (!student.databaseId) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(student.databaseId)) next.delete(student.databaseId);
      else next.add(student.databaseId);
      return next;
    });
  }

  function toggleAll() {
    const assignable = filtered.filter((student) => student.databaseId);
    const allSelected =
      assignable.length > 0 &&
      assignable.every((student) => selected.has(student.databaseId));
    setSelected((current) => {
      const next = new Set(current);
      assignable.forEach((student) => {
        if (allSelected) next.delete(student.databaseId);
        else next.add(student.databaseId);
      });
      return next;
    });
  }

  async function submit() {
    if (!selected.size) return setError("حداقل یک دانشجو انتخاب کنید.");
    if (reason.trim().length < 5)
      return setError("دلیل را کامل‌تر بنویسید (حداقل ۵ کاراکتر).");
    if (endDate && endDate < startDate)
      return setError("تاریخ پایان نمی‌تواند قبل از شروع باشد.");
    setError("");
    await onSubmit({
      studentIds: Array.from(selected),
      title: title.trim(),
      type,
      startDate,
      endDate: endDate || startDate,
      reason: reason.trim(),
      approveNow,
    });
  }

  return (
    <div
      className="modal-backdrop-custom"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="custom-modal modal-wide" role="dialog" aria-modal="true">
        <div className="ticket-modal-head">
          <div>
            <span>ثبت نیابتی</span>
            <h3>درخواست مرخصی گروهی</h3>
          </div>
          <button
            type="button"
            className="ticket-modal-close"
            aria-label="بستن"
            onClick={onClose}
          >
            <Icon name="bi-x-lg" />
          </button>
        </div>

        <div className="group-leave-form">
          <label className="form-label">
            عنوان گروه (اختیاری)
            <input
              className="form-control"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="مثلاً اردوی علمی دانشکده"
            />
          </label>
          <label className="form-label">
            نوع درخواست
            <select
              className="form-select"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="leave">مرخصی</option>
              <option value="excuse">توجیه غیبت</option>
            </select>
          </label>
          <div className="leave-date-grid">
            <label className="form-label">
              از تاریخ
              <JalaliDateInput
                value={startDate}
                onChange={(next) => {
                  setStartDate(next);
                  setEndDate((current) =>
                    current && current < next ? "" : current,
                  );
                }}
                ariaLabel="تاریخ شروع مرخصی گروهی"
              />
            </label>
            <label className="form-label">
              تا تاریخ (اختیاری)
              <JalaliDateInput
                value={endDate}
                min={startDate}
                clearable
                placeholder="همان روز"
                onChange={(next) => setEndDate(next)}
                ariaLabel="تاریخ پایان مرخصی گروهی"
              />
            </label>
          </div>
          <label className="form-label">
            دلیل *
            <textarea
              className="form-control"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="دلیل مرخصی گروهی را بنویسید…"
            />
          </label>
          <label className="request-group-option">
            <input
              type="checkbox"
              checked={approveNow}
              onChange={(event) => setApproveNow(event.target.checked)}
            />
            <span>
              تایید فوری و تغییر رکوردهای حضور این بازه به «موجه»
            </span>
          </label>
        </div>

        <div className="group-leave-picker">
          <div className="table-toolbar ticket-toolbar">
            <div className="search-wrap">
              <Icon name="bi-search" />
              <input
                className="form-control"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="جست‌وجوی دانشجو…"
              />
            </div>
            <span className="result-count">
              {selected.size.toLocaleString("fa-IR")} انتخاب‌شده
            </span>
            <button type="button" className="ticket-chip" onClick={toggleAll}>
              انتخاب همه
            </button>
          </div>
          <div className="group-leave-list">
            {filtered.length ? (
              filtered.map((student) => (
                <label
                  key={student.id}
                  className={`group-leave-item ${
                    selected.has(student.databaseId) ? "selected" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(student.databaseId)}
                    disabled={!student.databaseId}
                    onChange={() => toggle(student)}
                  />
                  <StudentAvatar name={student.name} photo={student.faceImage} />
                  <span>
                    <strong>{student.name}</strong>
                    <small>{student.id}</small>
                  </span>
                </label>
              ))
            ) : (
              <p className="text-muted">دانشجویی با این جست‌وجو پیدا نشد.</p>
            )}
          </div>
        </div>

        {error ? (
          <p className="student-photo-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ticket-modal-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={submit}
          >
            <Icon name="bi-people" />{" "}
            {busy ? "در حال ثبت…" : "ثبت درخواست گروهی"}
          </button>
          <button className="btn btn-light-outline" type="button" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

export function LeaveRequests({
  requests = [],
  students = [],
  loading = false,
  onReview,
  onRefresh,
  onCreateGroup,
}) {
  const [filter, setFilter] = useState("all");
  const [reviewingId, setReviewingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);

  useEffect(() => {
    onRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };
  const filtered = requests.filter(
    (request) => filter === "all" || request.status === filter,
  );
  const selected = requests.find((request) => request.id === reviewingId);

  const photoByNumber = new Map(
    students.map((student) => [String(student.id), student.faceImage || ""]),
  );

  async function submitReview(payload) {
    if (!selected) return;
    setBusy(true);
    try {
      await onReview(selected.id, payload);
      setReviewingId("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="پشتیبانی آموزشی"
        title="درخواست‌های مرخصی و توجیه"
        description="درخواست‌های مرخصی و توجیه غیبت دانشجویان را بررسی و تایید کنید."
        action={
          <div className="page-action-row">
            {onCreateGroup ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setGroupOpen(true)}
              >
                <Icon name="bi-people" /> درخواست گروهی
              </button>
            ) : null}
            <button className="btn btn-light-outline" onClick={onRefresh}>
              <Icon name="bi-arrow-clockwise" /> بروزرسانی
            </button>
          </div>
        }
      />
      {loading && !requests.length ? (
        <SkeletonCards />
      ) : (
        <div className="ticket-stat-grid">
          {[
            { key: "all", icon: "bi-inbox", color: "blue", label: "کل درخواست‌ها" },
            { key: "pending", icon: "bi-hourglass-split", color: "orange", label: "در انتظار" },
            { key: "approved", icon: "bi-check2-circle", color: "green", label: "تایید شده" },
            { key: "rejected", icon: "bi-x-circle", color: "red", label: "رد شده" },
          ].map((card) => (
            <button
              key={card.key}
              type="button"
              className={`ticket-stat-btn ${filter === card.key ? "active" : ""}`}
              onClick={() => setFilter(card.key)}
            >
              <StatCard
                icon={card.icon}
                color={card.color}
                label={card.label}
                value={counts[card.key].toLocaleString("fa-IR")}
                detail="برای فیلتر کلیک کنید"
              />
            </button>
          ))}
        </div>
      )}
      <div className="content-card data-card">
        <div className="table-toolbar ticket-toolbar">
          <div className="ticket-filter-chips" role="group">
            {[
              ["all", "همه"],
              ["pending", "در انتظار"],
              ["approved", "تایید شده"],
              ["rejected", "رد شده"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`ticket-chip ${filter === key ? "active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label} <span>{counts[key].toLocaleString("fa-IR")}</span>
              </button>
            ))}
          </div>
        </div>
        {loading && !requests.length ? (
          <SkeletonTable rows={5} columns={6} />
        ) : filtered.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>دانشجو</th>
                  <th>نوع</th>
                  <th>تاریخ / جلسه</th>
                  <th>دلیل</th>
                  <th>پیوست</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((request, index) => (
                  <tr key={request.id}>
                    <td>
                      <div className="student-cell">
                        <StudentAvatar
                          name={request.studentName}
                          photo={photoByNumber.get(String(request.studentNumber)) || ""}
                          index={index}
                        />
                        <div>
                          <strong>{request.studentName}</strong>
                          <span className="student-id-small">
                            {request.studentNumber}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="request-type-cell">
                        <Badge tone={request.type === "leave" ? "purple" : "neutral"}>
                          {request.type === "leave" ? "مرخصی" : "توجیه غیبت"}
                        </Badge>
                        {request.groupId ? (
                          <Badge tone="info">
                            گروهی{request.groupTitle ? ` · ${request.groupTitle}` : ""}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="ticket-subject-cell">
                        <strong>{request.courseTitle || "همهٔ کلاس‌ها"}</strong>
                        <span>
                          {new Date(request.startDate).toLocaleDateString("fa-IR")}
                          {request.endDate !== request.startDate
                            ? ` تا ${new Date(request.endDate).toLocaleDateString("fa-IR")}`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="ticket-text-cell" title={request.reason}>
                        {request.reason}
                      </span>
                    </td>
                    <td>
                      {request.proofFile ? (
                        <a
                          className="btn btn-light-outline btn-sm"
                          href={request.proofFile}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Icon name="bi-paperclip" /> مشاهده
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {requestStatusBadge(request.status)}
                      {request.adminNote ? (
                        <span className="student-id-small" title={request.adminNote}>
                          {request.adminNote}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {request.status === "pending" ? (
                        <button
                          className="btn btn-success-soft btn-sm"
                          onClick={() => setReviewingId(request.id)}
                        >
                          <Icon name="bi-clipboard-check" /> بررسی
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-calendar2-check"
            title="درخواستی وجود ندارد"
            text="در حال حاضر درخواست مرخصی یا توجیهی با این فیلتر ثبت نشده است."
          />
        )}
      </div>
      {selected ? (
        <RequestReviewModal
          title={selected.type === "leave" ? "درخواست مرخصی" : "توجیه غیبت"}
          subtitle={selected.courseTitle || "بازهٔ انتخابی"}
          studentLabel={`${selected.studentName} · ${selected.studentNumber}`}
          message={selected.reason}
          approveLabel="تایید"
          busy={busy}
          groupTitle={
            selected.groupId
              ? selected.groupTitle || "بدون عنوان"
              : ""
          }
          onClose={() => setReviewingId("")}
          onConfirm={submitReview}
        />
      ) : null}
      {groupOpen ? (
        <GroupLeaveModal
          students={students}
          busy={groupBusy}
          onClose={() => setGroupOpen(false)}
          onSubmit={async (payload) => {
            setGroupBusy(true);
            try {
              await onCreateGroup?.(payload);
              setGroupOpen(false);
            } finally {
              setGroupBusy(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

export function AttendanceObjections({
  objections = [],
  loading = false,
  onReview,
  onRefresh,
}) {
  const [filter, setFilter] = useState("all");
  const [reviewingId, setReviewingId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = {
    all: objections.length,
    pending: objections.filter((o) => o.status === "pending").length,
    approved: objections.filter((o) => o.status === "approved").length,
    rejected: objections.filter((o) => o.status === "rejected").length,
  };
  const filtered = objections.filter(
    (objection) => filter === "all" || objection.status === filter,
  );
  const selected = objections.find((objection) => objection.id === reviewingId);

  async function submitReview(payload) {
    if (!selected) return;
    setBusy(true);
    try {
      await onReview(selected.id, payload);
      setReviewingId("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="پشتیبانی آموزشی"
        title="اعتراض‌های حضور"
        description="اعتراض دانشجویان به وضعیت حضور یک جلسه را بررسی و در صورت نیاز اصلاح کنید."
        action={
          <button className="btn btn-light-outline" onClick={onRefresh}>
            <Icon name="bi-arrow-clockwise" /> بروزرسانی
          </button>
        }
      />
      {loading && !objections.length ? (
        <SkeletonCards />
      ) : (
        <div className="ticket-stat-grid">
          {[
            { key: "all", icon: "bi-shield-exclamation", color: "blue", label: "کل اعتراض‌ها" },
            { key: "pending", icon: "bi-hourglass-split", color: "orange", label: "در انتظار" },
            { key: "approved", icon: "bi-check2-circle", color: "green", label: "اصلاح‌شده" },
            { key: "rejected", icon: "bi-x-circle", color: "red", label: "ردشده" },
          ].map((card) => (
            <button
              key={card.key}
              type="button"
              className={`ticket-stat-btn ${filter === card.key ? "active" : ""}`}
              onClick={() => setFilter(card.key)}
            >
              <StatCard
                icon={card.icon}
                color={card.color}
                label={card.label}
                value={counts[card.key].toLocaleString("fa-IR")}
                detail="برای فیلتر کلیک کنید"
              />
            </button>
          ))}
        </div>
      )}
      <div className="content-card data-card">
        <div className="table-toolbar ticket-toolbar">
          <div className="ticket-filter-chips" role="group">
            {[
              ["all", "همه"],
              ["pending", "در انتظار"],
              ["approved", "اصلاح‌شده"],
              ["rejected", "ردشده"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`ticket-chip ${filter === key ? "active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label} <span>{counts[key].toLocaleString("fa-IR")}</span>
              </button>
            ))}
          </div>
        </div>
        {loading && !objections.length ? (
          <SkeletonTable rows={5} columns={6} />
        ) : filtered.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>دانشجو</th>
                  <th>درس / جلسه</th>
                  <th>وضعیت ثبت‌شده</th>
                  <th>دلیل اعتراض</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((objection, index) => (
                  <tr key={objection.id}>
                    <td>
                      <div className="student-cell">
                        <StudentAvatar
                          name={objection.studentName}
                          index={index}
                        />
                        <div>
                          <strong>{objection.studentName}</strong>
                          <span className="student-id-small">
                            {objection.studentNumber}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ticket-subject-cell">
                        <strong>{objection.courseTitle || "جلسه"}</strong>
                        <span>
                          {new Date(objection.sessionDate).toLocaleDateString(
                            "fa-IR",
                          )}
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge tone="neutral">
                        {recordStatusLabel(objection.recordStatus)}
                      </Badge>
                    </td>
                    <td>
                      <span className="ticket-text-cell" title={objection.reason}>
                        {objection.reason}
                      </span>
                    </td>
                    <td>{requestStatusBadge(objection.status)}</td>
                    <td>
                      {objection.status === "pending" ? (
                        <button
                          className="btn btn-success-soft btn-sm"
                          onClick={() => setReviewingId(objection.id)}
                        >
                          <Icon name="bi-clipboard-check" /> بررسی
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-shield-check"
            title="اعتراضی وجود ندارد"
            text="در حال حاضر اعتراضی با این فیلتر ثبت نشده است."
          />
        )}
      </div>
      {selected ? (
        <RequestReviewModal
          title="اعتراض حضور"
          subtitle={selected.courseTitle || "جلسه"}
          studentLabel={`${selected.studentName} · ${selected.studentNumber}`}
          message={selected.reason}
          approveLabel="تایید و اصلاح"
          busy={busy}
          onClose={() => setReviewingId("")}
          onConfirm={submitReview}
        />
      ) : null}
    </>
  );
}

const IMPORT_ALIASES = {
  studentNumber: ["شماره دانشجویی", "شماره دانشجويی", "شماره", "studentnumber", "student_number", "id"],
  fullName: ["نام و نام خانوادگی", "نام کامل", "نام", "fullname", "full_name", "name"],
  major: ["رشته", "رشته تحصیلی", "major"],
  term: ["ترم", "نیم‌سال", "term"],
  phone: ["تلفن", "شماره تماس", "موبایل", "phone"],
  code: ["کد درس", "کد", "code"],
  title: ["عنوان درس", "نام درس", "عنوان", "title"],
  teacherName: ["استاد", "نام استاد", "teacher", "teachername", "teacher_name"],
  room: ["کلاس", "اتاق", "room"],
  weekday: ["روز", "روز هفته", "weekday"],
  startTime: ["ساعت شروع", "شروع", "starttime", "start_time"],
  endTime: ["ساعت پایان", "پایان", "endtime", "end_time"],
};

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function mapImportRow(raw) {
  const mapped = {};
  const entries = Object.entries(raw);
  for (const [field, aliases] of Object.entries(IMPORT_ALIASES)) {
    const match = entries.find(([key]) =>
      aliases.includes(normalizeHeader(key)),
    );
    if (match) mapped[field] = String(match[1] ?? "").trim();
  }
  if (mapped.startTime) mapped.startTime = toClock(mapped.startTime);
  if (mapped.endTime) mapped.endTime = toClock(mapped.endTime);
  return mapped;
}

function toClock(value) {
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  const number = Number(text);
  if (Number.isFinite(number) && number >= 0 && number < 1) {
    const minutes = Math.round(number * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
      minutes % 60,
    ).padStart(2, "0")}`;
  }
  return text;
}

export function ImportPanel({ kind = "students", onImport, onClose }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx-js-style");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const mapped = json.map(mapImportRow).filter((row) => Object.keys(row).length);
      if (!mapped.length)
        throw new Error("هیچ سطر قابل خواندنی در فایل پیدا نشد.");
      setRows(mapped);
    } catch (err) {
      setRows([]);
      setError(err?.message || "خواندن فایل ناموفق بود.");
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const outcome = await onImport(rows);
      setResult(outcome);
    } catch (err) {
      setError(err?.message || "ایمپورت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop-custom"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="custom-modal modal-wide" role="dialog" aria-modal="true">
        <div className="ticket-modal-head">
          <div>
            <span>ایمپورت اطلاعات</span>
            <h3>
              {kind === "students" ? "افزودن گروهی دانشجویان" : "افزودن گروهی درس‌ها"}
            </h3>
          </div>
          <button
            type="button"
            className="ticket-modal-close"
            aria-label="بستن"
            onClick={onClose}
          >
            <Icon name="bi-x-lg" />
          </button>
        </div>
        <div className="import-drop">
          <Icon name="bi-file-earmark-spreadsheet" />
          <strong>
            {fileName || "فایل اکسل (xlsx) یا CSV را انتخاب کنید"}
          </strong>
          <small>
            {kind === "students"
              ? "ستون‌ها: شماره دانشجویی، نام و نام خانوادگی، رشته، ترم، تلفن"
              : "ستون‌ها: کد درس، عنوان درس، استاد، کلاس، روز، ساعت شروع، ساعت پایان"}
          </small>
          <button
            type="button"
            className="btn btn-light-outline"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="bi-upload" /> انتخاب فایل
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={handleFile}
          />
        </div>
        {error ? (
          <p className="student-photo-message error" role="alert">
            {error}
          </p>
        ) : null}
        {rows.length ? (
          <>
            <div className="import-preview">
              <table className="table custom-table">
                <thead>
                  <tr>
                    {Object.keys(rows[0]).slice(0, 5).map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 6).map((row, index) => (
                    <tr key={index}>
                      {Object.keys(rows[0]).slice(0, 5).map((key) => (
                        <td key={key}>{row[key] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <small>
                {rows.length.toLocaleString("fa-IR")} سطر آمادهٔ ایمپورت
                {rows.length > 6 ? " (پیش‌نمایش ۶ سطر اول)" : ""}
              </small>
            </div>
            {result ? (
              <div className="import-result" role="status">
                <Badge tone="success">
                  {result.created.toLocaleString("fa-IR")} سطر ثبت شد
                </Badge>
                {result.errors?.length ? (
                  <Badge tone="danger">
                    {result.errors.length.toLocaleString("fa-IR")} خطا
                  </Badge>
                ) : null}
                {result.errors?.length ? (
                  <ul>
                    {result.errors.slice(0, 5).map((item, index) => (
                      <li key={index}>
                        سطر {item.row}: {item.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="ticket-modal-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!rows.length || busy || Boolean(result)}
            onClick={submit}
          >
            <Icon name="bi-cloud-arrow-up" />{" "}
            {busy ? "در حال ایمپورت…" : "ایمپورت کن"}
          </button>
          <button className="btn btn-light-outline" type="button" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

// Admin activity feed («چه کسی چه کاری کرد»), backed by the existing
// audit_logs table via GET /api/admin/activity, scoped to the current faculty.
export function AdminActivity({
  activity = [],
  loading = false,
  error = "",
  entityType = "",
  onEntityTypeChange,
  onRefresh,
}) {
  const [page, setPage] = useState(1);
  const pageSize = 15;
  useEffect(() => {
    setPage(1);
  }, [entityType, activity.length]);
  const pageCount = Math.max(1, Math.ceil(activity.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleActivity = activity.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  return (
    <>
      <PanelTitle
        eyebrow="سیستم"
        title="گزارش فعالیت مدیران"
        description="چه کسی چه کاری انجام داده است؛ از گزارش‌های حسابرسی این دانشکده."
        action={
          <button className="btn btn-light-outline" onClick={onRefresh}>
            <Icon name="bi-arrow-clockwise" /> بروزرسانی
          </button>
        }
      />
      <div className="content-card data-card">
        <div className="table-toolbar">
          <select
            className="form-select filter-select"
            value={entityType}
            aria-label="فیلتر بر اساس نوع موجودیت"
            onChange={(event) => onEntityTypeChange?.(event.target.value)}
          >
            {AUDIT_ENTITY_OPTIONS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="result-count">
            {activity.length.toLocaleString("fa-IR")} رکورد
          </span>
        </div>
        {loading && !activity.length ? (
          <SkeletonTable rows={6} columns={5} />
        ) : activity.length ? (
          <>
            <div className="table-responsive">
              <table className="table custom-table align-middle">
                <thead>
                  <tr>
                    <th>زمان</th>
                    <th>مدیر</th>
                    <th>عملیات</th>
                    <th>موجودیت</th>
                    <th>جزئیات</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleActivity.map((item, index) => (
                    <tr key={item.id || index}>
                      <td dir="ltr" style={{ textAlign: "right" }}>
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString("fa-IR")
                          : "—"}
                      </td>
                      <td>
                        <strong>{item.actorName || "سیستم"}</strong>
                        {item.actorEmail && (
                          <span className="student-id-small" dir="ltr">
                            {item.actorEmail}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={AUDIT_ACTION_TONES[item.action] || "neutral"}>
                          {AUDIT_ACTION_LABELS[item.action] || item.action}
                        </Badge>
                      </td>
                      <td title={item.entityId || ""}>
                        {AUDIT_ENTITY_LABELS[item.entityType] || item.entityType}
                      </td>
                      <td
                        className="text-truncate"
                        style={{ maxWidth: 320 }}
                        title={activityMetadataSummary(item.metadata)}
                      >
                        {activityMetadataSummary(item.metadata)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager
              page={safePage}
              pageSize={pageSize}
              total={activity.length}
              onPageChange={setPage}
              label="رکورد"
            />
          </>
        ) : (
          <EmptyState
            icon="bi-journal-text"
            title="فعالیتی ثبت نشده است"
            text="برای این دانشکده هنوز عملیاتی در گزارش‌های حسابرسی ثبت نشده است."
          />
        )}
        {error && (
          <p className="profile-error" role="alert" style={{ padding: "0 20px 16px" }}>
            {error}
          </p>
        )}
      </div>
    </>
  );
}

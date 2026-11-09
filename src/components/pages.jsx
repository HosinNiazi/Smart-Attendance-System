import React, { useEffect, useRef, useState } from "react";
import { Badge, EmptyState, Icon, PanelTitle, StatCard, StudentAvatar } from "./shared.jsx";
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

const PRESENT_STATUS = "\u062d\u0627\u0636\u0631";
const ABSENT_STATUS = "\u063a\u0627\u06cc\u0628";
const LATE_STATUS = "\u062a\u0623\u062e\u06cc\u0631";

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
          <button className="btn btn-light-outline" onClick={onExport}>
            <Icon name="bi-download" /> خروجی گزارش
          </button>

          <button
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
              <h3>وضعیت حضور امروز</h3>
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
                className="donut-chart"
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
              <h3>دسترسی سریع</h3>
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
            <h3>آخرین وضعیت حضور و غیاب</h3>
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
            <h3>کلاس‌های فعال</h3>
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

export function Students({ students, query, setQuery, onAdd, onDelete, onSavePhoto }) {
  return (
    <>
      <PanelTitle
        eyebrow="مدیریت آموزشی"
        title="مدیریت دانشجویان"
        description="فهرست دانشجویان را مشاهده، جست‌وجو و مدیریت کنید."
        action={
          <button className="btn btn-primary" onClick={onAdd}>
            <Icon name="bi-plus-lg" /> افزودن دانشجو
          </button>
        }
      />
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
                {students.map((s, i) => (
                  <tr key={s.id}>
                    <td>
                      <div className="student-cell">
                        <StudentAvatar
                          name={s.name}
                          photo={s.faceImage}
                          index={i}
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
  onNavigate,
  onAddCourse,
  onPlanCourse,
}) {
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [courseForm, setCourseForm] = useState({
    id: "",
    title: "",
    teacher: "",
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
      teacher: "",
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
          </div>
        }
      />
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
            <label className="form-label">
              استاد
              <input
                className="form-control"
                value={courseForm.teacher}
                maxLength={80}
                onChange={(event) =>
                  updateCourseForm("teacher", event.target.value)
                }
                placeholder="نام استاد"
              />
            </label>
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
            <input
              id="face-session-date"
              className="form-control"
              type="date"
              value={sessionDate}
              onChange={(event) => setSessionDate(event.target.value)}
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
  return (
    <div className="reports-page">
      <PanelTitle
        eyebrow="تحلیل و گزارش"
        title="گزارش‌های حضور و غیاب"
        description="تحلیل وضعیت حضور و دریافت خروجی از داده‌های ثبت‌شده."
        action={
          <div className="report-export-actions">
            <button
              className="btn btn-light-outline"
              onClick={() => onExport?.(filtered)}
            >
              <Icon name="bi-file-earmark-spreadsheet" /> خروجی Excel (CSV)
            </button>
            <button className="btn btn-primary" onClick={onPrint}>
              <Icon name="bi-file-earmark-pdf" /> چاپ / ذخیره PDF
            </button>
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
            <input
              className="form-control"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label>
            تا تاریخ
            <input
              className="form-control"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
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
    </div>
  );
}
export function Settings({
  settings,
  setSettings,
  onSave,
  onBackup,
  onRestore,
}) {
  const update = (key, value) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
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
            </p>
          </div>
        </div>
        <div className="backup-actions">
          <button className="btn btn-primary" onClick={onBackup}>
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
        <p className="backup-privacy-note">
          <Icon name="bi-shield-lock" /> فایل پشتیبان شامل اطلاعات دانشجویان،
          سوابق حضور، عکس‌های مرجع و الگوهای صوتی است. آن را در فضای امن نگه
          دارید. بازیابی، داده‌های فعلی را جایگزین می‌کند.
        </p>
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
            <input
              id="fingerprint-session-date"
              className="form-control"
              type="date"
              value={sessionDate}
              onChange={(event) => setSessionDate(event.target.value)}
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

export function Profile({ name, role, photo, onSave }) {
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
}) {
  const [tab, setTab] = useState("overview");
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
    { id: "fingerprint", label: "اثر انگشت", icon: "bi-fingerprint" },
    { id: "profile", label: "پروفایل من", icon: "bi-person-circle" },
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

  return (
    <div className="student-portal" dir="rtl">
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

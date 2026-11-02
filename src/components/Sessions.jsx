import React from "react";
import { Badge, Icon, PanelTitle, EmptyState } from "./shared.jsx";

const text = {
  title: "\u062a\u0642\u0648\u06cc\u0645 \u062c\u0644\u0633\u0627\u062a",
  description: "\u062c\u0644\u0633\u0647\u200c\u0647\u0627\u06cc \u062f\u0631\u0633 \u0631\u0627 \u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0631\u06cc\u0632\u06cc \u06a9\u0646\u06cc\u062f \u0648 \u0631\u0648\u06cc \u062a\u0642\u0648\u06cc\u0645 \u0628\u0628\u06cc\u0646\u06cc\u062f.",
  today: "\u0627\u0645\u0631\u0648\u0632", selected: "\u062c\u0644\u0633\u0627\u062a \u0627\u06cc\u0646 \u0631\u0648\u0632",
  schedule: "\u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0631\u06cc\u0632\u06cc \u062c\u0644\u0633\u0647", empty: "\u0628\u0631\u0627\u06cc \u0627\u06cc\u0646 \u0631\u0648\u0632 \u062c\u0644\u0633\u0647\u200c\u0627\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647.",
  add: "\u062f\u0631\u0633 \u0631\u0627 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f \u0648 \u0628\u0631\u0646\u0627\u0645\u0647 \u0631\u0627 \u062b\u0628\u062a \u06a9\u0646\u06cc\u062f.",
  start: "\u0634\u0631\u0648\u0639 \u062b\u0628\u062a \u062d\u0636\u0648\u0631", present: "\u0646\u0641\u0631 \u062d\u0627\u0636\u0631", records: "\u0631\u06a9\u0648\u0631\u062f",
  classTitle: "\u0628\u0631\u0646\u0627\u0645\u0647 \u06a9\u0644\u0627\u0633", previous: "\u0645\u0627\u0647 \u0642\u0628\u0644", next: "\u0645\u0627\u0647 \u0628\u0639\u062f", course: "\u062f\u0631\u0633 / \u06a9\u0644\u0627\u0633", session: "\u062c\u0644\u0633\u0647", hasSession: "\u062f\u0627\u0631\u0627\u06cc \u062c\u0644\u0633\u0647",
  filterCourse: "\u0641\u06cc\u0644\u062a\u0631 \u062a\u0642\u0648\u06cc\u0645 \u0628\u0631 \u0627\u0633\u0627\u0633 \u062f\u0631\u0633", allCourses: "\u0647\u0645\u0647 \u062f\u0631\u0633\u200c\u0647\u0627", scheduleCourse: "\u062f\u0631\u0633 \u0628\u0631\u0627\u06cc \u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0631\u06cc\u0632\u06cc"
};
const ALL_COURSES = "__all_courses__";
const dateKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const isDateKey = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
};
const persianPartsFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric" });
const persianDayFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric" });
function persianParts(date) { return Object.fromEntries(persianPartsFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])); }
function persianMonthStart(date) {
  const target = persianParts(date);
  for (let offset = -35; offset <= 2; offset++) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    const parts = persianParts(candidate);
    if (parts.year === target.year && parts.month === target.month && parts.day === 1) return candidate;
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function Sessions({ courses = [], students = [], attendance = [], sessions = {}, onSchedule, onOpenSession, onFinalizeSession }) {
  const safeCourses = Array.isArray(courses) ? courses : [];
  const safeAttendance = Array.isArray(attendance) ? attendance : [];
  const safeSessions = sessions && typeof sessions === "object" && !Array.isArray(sessions) ? sessions : {};
  const [month, setMonth] = React.useState(() => persianMonthStart(new Date()));
  const [selectedDate, setSelectedDate] = React.useState(() => dateKey(new Date()));
  const [filterCourse, setFilterCourse] = React.useState(ALL_COURSES);
  const [scheduleCourse, setScheduleCourse] = React.useState(safeCourses[0]?.title || "");
  const [startTime, setStartTime] = React.useState("10:00");
  const [endTime, setEndTime] = React.useState("12:00");
  const [graceMinutes, setGraceMinutes] = React.useState(10);
  const [openBeforeMinutes, setOpenBeforeMinutes] = React.useState(15);
  const [closeAfterMinutes, setCloseAfterMinutes] = React.useState(30);
  const [rosterIds, setRosterIds] = React.useState(() => {
    const course = safeCourses.find((item) => item.title === safeCourses[0]?.title);
    const activeIds = students.filter((student) => student.status !== "غیرفعال").map((student) => student.id);
    return Array.isArray(course?.studentIds) ? course.studentIds.filter((id) => activeIds.includes(id)) : activeIds;
  });
  const title = new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(month);
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat("fa-IR", { weekday: "short" }).format(new Date(2024, 0, 6 + index)));
  const offset = (month.getDay() + 1) % 7;
  const dates = Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), month.getDate() + index - offset));
  const targetPersianMonth = persianParts(month);
  const sessionsByCourseAndDate = new Map();
  Object.values(safeSessions).forEach((session) => {
    if (isDateKey(session?.date) && typeof session?.course === "string" && session.course.trim()) {
      const normalizedSession = { ...session, id: session.id || `${session.course}::${session.date}` };
      sessionsByCourseAndDate.set(`${session.course}::${session.date}`, normalizedSession);
    }
  });
  safeAttendance.forEach((record) => {
    const sessionIdDate = typeof record.sessionId === "string" ? record.sessionId.split("::").at(-1) : "";
    const date = record.sessionDate || record.date || sessionIdDate;
    if (!isDateKey(date) || typeof record.course !== "string" || !record.course.trim()) return;
    const key = `${record.course}::${date}`;
    if (!sessionsByCourseAndDate.has(key)) {
      sessionsByCourseAndDate.set(key, { id: record.sessionId || key, course: record.course, date, scheduled: false });
    }
  });
  const sessionsByDate = [...sessionsByCourseAndDate.values()].reduce((map, session) => {
    map[session.date] = [...(map[session.date] || []), session];
    return map;
  }, {});
  const selectedDateEvents = sessionsByDate[selectedDate] || [];
  const events = selectedDateEvents
    .filter((event) => filterCourse === ALL_COURSES || event.course === filterCourse)
    .sort((a, b) => a.course.localeCompare(b.course));
  const today = dateKey(new Date());
  const selectedLabel = new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(selectedDate + "T12:00:00"));
  const moveMonth = (step) => {
    const next = persianMonthStart(new Date(month.getFullYear(), month.getMonth(), month.getDate() + step * 35));
    setMonth(next); setSelectedDate(dateKey(next));
  };
  const selectDate = (date) => {
    setSelectedDate(dateKey(date));
    const parts = persianParts(date);
    if (parts.year !== targetPersianMonth.year || parts.month !== targetPersianMonth.month) {
      setMonth(persianMonthStart(date));
    }
  };
  const addSession = () => {
    if (scheduleCourse && !selectedDateEvents.some((event) => event.course === scheduleCourse)) {
      const course = safeCourses.find((item) => item.title === scheduleCourse);
      onSchedule?.(scheduleCourse, selectedDate, { teacher: course?.teacher || "استاد تعیین‌نشده", startTime, endTime, graceMinutes: Number(graceMinutes), openBeforeMinutes: Number(openBeforeMinutes), closeAfterMinutes: Number(closeAfterMinutes), studentIds: rosterIds });
    }
  };

  React.useEffect(() => {
    const activeIds = students.filter((student) => student.status !== "غیرفعال").map((student) => student.id);
    const course = safeCourses.find((item) => item.title === scheduleCourse);
    const defaults = Array.isArray(course?.studentIds) ? course.studentIds.filter((id) => activeIds.includes(id)) : activeIds;
    setRosterIds((current) => current.filter((id) => activeIds.includes(id)).length ? current.filter((id) => activeIds.includes(id)) : defaults);
  }, [students]);
  React.useEffect(() => {
    const course = safeCourses.find((item) => item.title === scheduleCourse);
    const times = (course?.time || "").match(/(\d{1,2}:\d{2})/g) || [];
    if (times[0]) setStartTime(times[0].padStart(5, "0"));
    if (times[1]) setEndTime(times[1].padStart(5, "0"));
    if (course) {
      const activeIds = students.filter((student) => student.status !== "غیرفعال").map((student) => student.id);
      setRosterIds(Array.isArray(course.studentIds) ? course.studentIds.filter((id) => activeIds.includes(id)) : activeIds);
    }
  }, [scheduleCourse, safeCourses, students]);

  return <>
    <PanelTitle eyebrow={text.title} title={text.title} description={text.description} />
    <div className="calendar-page-grid">
      <section className="content-card calendar-card">
        <header className="calendar-toolbar"><div><span className="eyebrow">{text.classTitle}</span><h3>{title}</h3></div><div className="calendar-nav"><button className="icon-button" aria-label={text.previous} onClick={() => moveMonth(-1)}><Icon name="bi-chevron-right" /></button><button className="btn btn-light-outline" onClick={() => { const now = new Date(); setMonth(persianMonthStart(now)); setSelectedDate(today); }}>{text.today}</button><button className="icon-button" aria-label={text.next} onClick={() => moveMonth(1)}><Icon name="bi-chevron-left" /></button></div></header>
        <div className="calendar-grid" role="grid">{weekdays.map((day, index) => <div className="calendar-weekday" role="columnheader" key={day + index}>{day}</div>)}{dates.map((date) => {
          const key = dateKey(date), dayEvents = sessionsByDate[key] || [], count = dayEvents.filter((event) => filterCourse === ALL_COURSES || event.course === filterCourse).length, dateParts = persianParts(date);
          const inMonth = dateParts.year === targetPersianMonth.year && dateParts.month === targetPersianMonth.month;
          return <button type="button" role="gridcell" aria-selected={key === selectedDate} className={["calendar-day", !inMonth && "outside", key === selectedDate && "selected", key === today && "today", count > 0 && "has-events"].filter(Boolean).join(" ")} key={key} onClick={() => selectDate(date)}><span>{persianDayFormatter.format(date)}</span>{count > 0 && <small>{new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(count)} {text.session}</small>}</button>;
        })}</div>
        <div className="calendar-legend"><span><i className="legend-event" /> {text.hasSession}</span><span><i className="legend-today" /> {text.today}</span></div>
      </section>
      <aside className="calendar-side">
        <section className="content-card calendar-schedule-card"><div className="calendar-selected-date"><span className="calendar-date-icon"><Icon name="bi-calendar-event" /></span><div><span className="eyebrow">{text.selected}</span><h3>{selectedLabel}</h3></div></div><div className="calendar-schedule-form"><label className="form-label" htmlFor="calendar-filter">{text.filterCourse}</label><select id="calendar-filter" className="form-select" value={filterCourse} onChange={(event) => setFilterCourse(event.target.value)}><option value={ALL_COURSES}>{text.allCourses}</option>{safeCourses.map((item) => <option value={item.title} key={`filter-${item.id}`}>{item.title}</option>)}</select><label className="form-label" htmlFor="calendar-course">{text.scheduleCourse}</label><select id="calendar-course" className="form-select" value={scheduleCourse} onChange={(event) => setScheduleCourse(event.target.value)}>{safeCourses.map((item) => <option value={item.title} key={item.id}>{item.title}</option>)}</select>
          {!safeCourses.length && <EmptyState icon="bi-journal-x" title="درسی برای برنامه‌ریزی نیست" text="پس از اضافه‌شدن درس، می‌توانید جلسه تعریف کنید." />}
          <div className="session-schedule-fields"><label className="form-label">شروع جلسه<input className="form-control" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="form-label">پایان جلسه<input className="form-control" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><label className="form-label">مهلت تأخیر (دقیقه)<input className="form-control" type="number" min="0" max="180" value={graceMinutes} onChange={(event) => setGraceMinutes(event.target.value)} /></label><label className="form-label">شروع مجاز قبل از کلاس<input className="form-control" type="number" min="0" max="180" value={openBeforeMinutes} onChange={(event) => setOpenBeforeMinutes(event.target.value)} /></label><label className="form-label">پایان ثبت بعد از کلاس<input className="form-control" type="number" min="0" max="180" value={closeAfterMinutes} onChange={(event) => setCloseAfterMinutes(event.target.value)} /></label></div>
          <div className="session-roster-picker"><strong>فهرست دانشجویان این جلسه</strong><div>{students.filter((student) => student.status !== "غیرفعال").map((student) => <label key={student.id}><input type="checkbox" checked={rosterIds.includes(student.id)} onChange={(event) => setRosterIds((current) => event.target.checked ? [...new Set([...current, student.id])] : current.filter((id) => id !== student.id))} /> {student.name}</label>)}</div></div><button className="btn btn-primary w-100" onClick={addSession} disabled={!scheduleCourse || !startTime || !endTime || endTime <= startTime || !rosterIds.length || selectedDateEvents.some((event) => event.course === scheduleCourse)}><Icon name="bi-plus-lg" /> {text.schedule}</button></div></section>
        <section className="content-card calendar-events-card"><div className="card-heading"><div><h3>{text.selected}</h3><p>{events.length.toLocaleString("fa-IR")} {text.session}</p></div><Badge tone={events.length ? "success" : "neutral"}>{events.length.toLocaleString("fa-IR")}</Badge></div>{events.length ? <div className="calendar-event-list">{events.map((event) => { const rows = safeAttendance.filter((row) => row.sessionId === event.id || (row.course === event.course && (row.sessionDate === event.date || row.date === event.date))); const present = rows.filter((row) => ["حاضر", "با تأخیر", "تأخیر", "خروج زودهنگام"].includes(row.status)).length; const roster = (event.studentIds || []).length; return <article className="calendar-event" key={`${event.course}::${event.date}`}><span className="calendar-event-icon"><Icon name="bi-journal-bookmark" /></span><div className="calendar-event-copy"><strong>{event.course}</strong><small>{event.teacher || "استاد تعیین‌نشده"} · {event.startTime || "—"} تا {event.endTime || "—"}</small><small>{present.toLocaleString("fa-IR")} حاضر از {roster || rows.length} دانشجو · {rows.length.toLocaleString("fa-IR")} رکورد</small></div><div className="session-event-actions"><button className="btn btn-light-outline" onClick={() => onOpenSession?.(event)}>{event.started ? "ادامه ثبت حضور" : text.start} <Icon name="bi-arrow-left" /></button>{event.started && !event.finalized && <button className="btn btn-light-outline" onClick={() => onFinalizeSession?.(event.id)}>پایان جلسه</button>}{event.finalized && <Badge tone="neutral">پایان‌یافته</Badge>}</div></article>; })}</div> : <div className="calendar-empty"><span><Icon name="bi-calendar2-plus" /></span><strong>{text.empty}</strong><p>{text.add}</p></div>}</section>
      </aside>
    </div>
  </>;
}

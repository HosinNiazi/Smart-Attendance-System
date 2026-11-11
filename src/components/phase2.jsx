import React, { useEffect, useMemo, useState } from "react";
import {
  Badge,
  EmptyState,
  Icon,
  PanelTitle,
  SkeletonCards,
  SkeletonTable,
  StatCard,
} from "./shared.jsx";
import { JalaliDateInput } from "./JalaliDateInput.jsx";
import { toEnStatus } from "../api/adapter.js";
import {
  JALALI_WEEKDAYS,
  addJalaliMonths,
  buildJalaliMonth,
  formatJalali,
  jalaliLabel,
  toJalali,
  todayIso,
} from "../calendar/jalali.js";

const STATUS_LABELS = {
  present: "حاضر",
  late: "تأخیر",
  absent: "غایب",
  excused: "موجه",
  left_early: "خروج زودهنگام",
  unmarked: "ثبت‌نشده",
};

const STATUS_KIND = {
  present: "present",
  late: "late",
  excused: "excused",
  left_early: "late",
  absent: "absent",
  unmarked: "absent",
};

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function rateOf(present, late, total) {
  if (!total) return 0;
  return Math.round(((present + late) / total) * 100);
}

function TrendChart({ rows = [] }) {
  const width = 720;
  const height = 230;
  const padX = 34;
  const padY = 22;
  const points = rows.map((row, index) => {
    const rate = rateOf(row.present, row.late, row.total);
    const x =
      rows.length <= 1
        ? width / 2
        : padX + (index / (rows.length - 1)) * (width - padX * 2);
    const y = height - padY - (rate / 100) * (height - padY * 2);
    return { x, y, rate, row };
  });
  if (!points.length) {
    return (
      <EmptyState
        icon="bi-graph-up"
        title="داده‌ای برای این بازه نیست"
        text="برای مشاهدهٔ روند، بازه‌ای انتخاب کنید که در آن جلسه ثبت شده باشد."
      />
    );
  }
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `M ${points[0].x} ${height - padY} L ${points
    .map((point) => `${point.x} ${point.y}`)
    .join(" L ")} L ${points[points.length - 1].x} ${height - padY} Z`;
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="نمودار روند حضور">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = height - padY - (tick / 100) * (height - padY * 2);
          return (
            <g key={tick}>
              <line
                x1={padX}
                y1={y}
                x2={width - padX}
                y2={y}
                className="trend-grid-line"
              />
              <text x={padX - 8} y={y + 3} className="trend-axis-text">
                {tick.toLocaleString("fa-IR")}
              </text>
            </g>
          );
        })}
        <path d={area} className="trend-area" />
        <polyline points={line} className="trend-line" />
        {points.map((point) => (
          <g key={point.row.bucket}>
            <circle cx={point.x} cy={point.y} r="4" className="trend-dot">
              <title>
                {formatJalali(point.row.bucket, true)} —{" "}
                {point.rate.toLocaleString("fa-IR")}٪
              </title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="trend-legend">
        <span>
          <i className="dot present" /> نرخ حضور (حاضر + تأخیر) به کل رکوردها
        </span>
      </div>
    </div>
  );
}

export function MiniTrendChart({ rows = [], title = "روند حضور ۳۰ روز گذشته" }) {
  return (
    <section className="content-card trend-mini-card">
      <div className="student-section-heading">
        <div>
          <span>تحلیل شخصی</span>
          <h2>{title}</h2>
        </div>
      </div>
      <TrendChart rows={rows} />
    </section>
  );
}

export function TrendAnalysis({
  courses = [],
  onLoadTrend,
  onLoadCourses,
}) {
  const [from, setFrom] = useState(() => daysAgoIso(29));
  const [to, setTo] = useState(() => todayIso());
  const [granularity, setGranularity] = useState("day");
  const [courseId, setCourseId] = useState("");
  const [rows, setRows] = useState([]);
  const [courseRows, setCourseRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      onLoadTrend?.({ from, to, granularity, courseId }) || Promise.resolve({ rows: [] }),
      onLoadCourses?.({ from, to }) || Promise.resolve({ rows: [] }),
    ])
      .then(([trend, coursesResult]) => {
        if (!active) return;
        setRows(trend?.rows || []);
        setCourseRows(coursesResult?.rows || []);
      })
      .catch((err) => {
        if (active) setError(err?.message || "دریافت تحلیل انجام نشد.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, granularity, courseId]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (accumulator, row) => {
          accumulator.total += row.total || 0;
          accumulator.present += row.present || 0;
          accumulator.late += row.late || 0;
          accumulator.absent += row.absent || 0;
          accumulator.excused += row.excused || 0;
          return accumulator;
        },
        { total: 0, present: 0, late: 0, absent: 0, excused: 0 },
      ),
    [rows],
  );
  const rate = rateOf(totals.present, totals.late, totals.total);

  return (
    <>
      <PanelTitle
        eyebrow="تحلیل و گزارش"
        title="تحلیل روند حضور"
        description="نرخ حضور، غیبت و تأخیر را در بازه‌های زمانی و به تفکیک درس بررسی کنید."
      />
      <div className="content-card trend-filter-card">
        <label className="form-label">
          از تاریخ
          <JalaliDateInput
            value={from}
            max={to}
            onChange={(next) => setFrom(next)}
            ariaLabel="از تاریخ"
          />
        </label>
        <label className="form-label">
          تا تاریخ
          <JalaliDateInput
            value={to}
            min={from}
            onChange={(next) => setTo(next)}
            ariaLabel="تا تاریخ"
          />
        </label>
        <label className="form-label">
          بازهٔ تجمیع
          <select
            className="form-select"
            value={granularity}
            onChange={(event) => setGranularity(event.target.value)}
          >
            <option value="day">روزانه</option>
            <option value="week">هفتگی</option>
            <option value="month">ماهانه</option>
          </select>
        </label>
        <label className="form-label">
          درس
          <select
            className="form-select"
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
          >
            <option value="">همهٔ درس‌ها</option>
            {courses.map((course) => (
              <option key={course.databaseId || course.id} value={course.databaseId || ""}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
        <div className="trend-filter-actions">
          {[
            { label: "۷ روز", days: 6 },
            { label: "۳۰ روز", days: 29 },
            { label: "۹۰ روز", days: 89 },
          ].map((preset) => (
            <button
              key={preset.days}
              type="button"
              className="ticket-chip"
              onClick={() => {
                setTo(todayIso());
                setFrom(daysAgoIso(preset.days));
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="student-photo-message error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !rows.length ? (
        <SkeletonCards />
      ) : (
        <div className="ticket-stat-grid">
          <StatCard
            icon="bi-collection"
            color="blue"
            label="کل رکوردهای حضور"
            value={totals.total.toLocaleString("fa-IR")}
            detail={`${rows.length.toLocaleString("fa-IR")} بازه`}
          />
          <StatCard
            icon="bi-check2-circle"
            color="green"
            label="حاضر و تأخیر"
            value={(totals.present + totals.late).toLocaleString("fa-IR")}
            detail={`${rate.toLocaleString("fa-IR")}٪ نرخ حضور`}
          />
          <StatCard
            icon="bi-x-circle"
            color="red"
            label="غایب"
            value={totals.absent.toLocaleString("fa-IR")}
            detail={
              totals.total
                ? `${Math.round((totals.absent / totals.total) * 100).toLocaleString("fa-IR")}٪`
                : "—"
            }
          />
          <StatCard
            icon="bi-shield-check"
            color="purple"
            label="موجه"
            value={totals.excused.toLocaleString("fa-IR")}
            detail="تاییدشده توسط مدیر"
          />
        </div>
      )}

      <div className="content-card trend-panel">
        <div className="card-heading">
          <div>
            <strong>نمودار روند حضور</strong>
            <span>
              از {formatJalali(from)} تا {formatJalali(to)}
            </span>
          </div>
          {loading ? <span className="trend-updating">در حال بروزرسانی…</span> : null}
        </div>
        {loading && !rows.length ? (
          <div className="trend-chart-skeleton">
            <span className="skeleton skeleton-line" style={{ height: 180 }} />
          </div>
        ) : (
          <TrendChart rows={rows} />
        )}
      </div>

      <div className="content-card data-card">
        <div className="card-heading">
          <div>
            <strong>مقایسهٔ درس‌ها</strong>
            <span>نرخ حضور در بازهٔ انتخاب‌شده</span>
          </div>
        </div>
        {loading && !courseRows.length ? (
          <SkeletonTable rows={4} columns={5} />
        ) : courseRows.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>درس</th>
                  <th>کل رکورد</th>
                  <th>حاضر</th>
                  <th>غایب</th>
                  <th>نرخ حضور</th>
                </tr>
              </thead>
              <tbody>
                {courseRows.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <strong>{course.title}</strong>
                    </td>
                    <td>{course.total.toLocaleString("fa-IR")}</td>
                    <td>{(course.present + course.late).toLocaleString("fa-IR")}</td>
                    <td>{course.absent.toLocaleString("fa-IR")}</td>
                    <td>
                      <div className="trend-rate-cell">
                        <span className="trend-rate-bar">
                          <i style={{ width: `${course.rate}%` }} />
                        </span>
                        <strong>{course.rate.toLocaleString("fa-IR")}٪</strong>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-journal-x"
            title="درسی در این بازه نیست"
            text="برای این بازه هیچ رکورد حضوری ثبت نشده است."
          />
        )}
      </div>
    </>
  );
}

const LIVE_LABELS = {
  scheduled: "شروع‌نشده",
  live: "در حال برگزاری",
  ended: "پایان‌یافته",
};

export function LiveClass({
  onLoadSessions,
  onLoadSession,
  onStartSession,
  onEndSession,
  onMarkStudent,
}) {
  const [date, setDate] = useState(() => todayIso());
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadSessions(nextDate = date) {
    try {
      const rows = await onLoadSessions?.(nextDate);
      const list = Array.isArray(rows) ? rows : [];
      setSessions(list);
      setSelectedId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const live = list.find((item) => item.liveStatus === "live");
        return live?.id || list[0]?.id || "";
      });
      setError("");
    } catch (err) {
      setError(err?.message || "دریافت جلسات انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id = selectedId) {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const data = await onLoadSession?.(id);
      setDetail(data || null);
    } catch (err) {
      setError(err?.message || "دریافت وضعیت زنده انجام نشد.");
    }
  }

  useEffect(() => {
    setLoading(true);
    loadSessions(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadSessions(date);
      loadDetail(selectedId);
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, selectedId]);

  const selected = sessions.find((item) => item.id === selectedId) || null;

  async function changeLive(action) {
    if (!selectedId) return;
    setBusy(true);
    try {
      if (action === "start") await onStartSession?.(selectedId);
      else await onEndSession?.(selectedId);
      await loadSessions(date);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err?.message || "تغییر وضعیت جلسه انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function mark(student, status) {
    setBusy(true);
    try {
      await onMarkStudent?.(selectedId, student.studentId, status);
      await loadDetail(selectedId);
      await loadSessions(date);
    } catch (err) {
      setError(err?.message || "ثبت حضور انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="حضور و غیاب"
        title="پنل زندهٔ کلاس"
        description="جلسه را شروع کنید، وضعیت حضور دانشجویان را به‌صورت زنده ببینید و ثبت کنید."
        action={
          <div className="page-action-row live-date-row">
            <JalaliDateInput
              className="live-date-field"
              value={date}
              onChange={(next) => setDate(next)}
              ariaLabel="تاریخ جلسات"
            />
            <button
              type="button"
              className="btn btn-light-outline"
              onClick={() => loadSessions(date)}
            >
              <Icon name="bi-arrow-clockwise" /> بروزرسانی
            </button>
          </div>
        }
      />
      {error ? (
        <p className="student-photo-message error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !sessions.length ? (
        <SkeletonCards />
      ) : sessions.length ? (
        <div className="live-session-grid">
          {sessions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`live-session-card ${selectedId === item.id ? "active" : ""}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="live-session-head">
                <span className={`live-pill ${item.liveStatus}`}>
                  <i /> {LIVE_LABELS[item.liveStatus] || item.liveStatus}
                </span>
                <span className="live-session-time">
                  {item.startTime} تا {item.endTime}
                </span>
              </div>
              <strong>{item.courseTitle}</strong>
              <small>
                {item.courseCode} · {item.teacherName}
              </small>
              <div className="live-session-counts">
                <span className="present">
                  <Icon name="bi-check2" /> {item.present.toLocaleString("fa-IR")}
                </span>
                <span className="late">
                  <Icon name="bi-clock" /> {item.late.toLocaleString("fa-IR")}
                </span>
                <span className="absent">
                  <Icon name="bi-x-lg" /> {item.absent.toLocaleString("fa-IR")}
                </span>
                <span className="excused">
                  <Icon name="bi-shield-check" /> {item.excused.toLocaleString("fa-IR")}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="content-card">
          <EmptyState
            icon="bi-calendar-x"
            title="جلسه‌ای برای این روز نیست"
            text="تاریخ دیگری را انتخاب کنید یا ابتدا از بخش «جلسات کلاس» جلسه بسازید."
          />
        </div>
      )}

      {selected ? (
        <div className="content-card live-panel">
          <div className="live-panel-head">
            <div>
              <span className={`live-pill ${selected.liveStatus}`}>
                <i /> {LIVE_LABELS[selected.liveStatus] || selected.liveStatus}
              </span>
              <h2>{selected.courseTitle}</h2>
              <p>
                {formatJalali(selected.date)} · {selected.startTime} تا{" "}
                {selected.endTime} · {selected.teacherName}
              </p>
            </div>
            <div className="live-panel-actions">
              {selected.liveStatus === "live" ? (
                <button
                  type="button"
                  className="btn btn-danger-soft"
                  disabled={busy}
                  onClick={() => changeLive("end")}
                >
                  <Icon name="bi-stop-circle" /> پایان کلاس
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => changeLive("start")}
                >
                  <Icon name="bi-broadcast" />{" "}
                  {selected.liveStatus === "ended"
                    ? "شروع دوبارهٔ کلاس"
                    : "شروع کلاس زنده"}
                </button>
              )}
            </div>
          </div>
          <div className="ticket-stat-grid live-stat-grid">
            {[
              { key: "present", label: "حاضر", icon: "bi-check2", color: "green" },
              { key: "late", label: "تأخیر", icon: "bi-clock", color: "orange" },
              { key: "absent", label: "غایب", icon: "bi-x-lg", color: "red" },
              { key: "excused", label: "موجه", icon: "bi-shield-check", color: "purple" },
            ].map((card) => (
              <StatCard
                key={card.key}
                icon={card.icon}
                color={card.color}
                label={card.label}
                value={(selected[card.key] || 0).toLocaleString("fa-IR")}
                detail={`از ${selected.total.toLocaleString("fa-IR")} دانشجو`}
              />
            ))}
          </div>
          <div className="live-roster">
            {detail?.students?.length ? (
              detail.students.map((student) => (
                <div className="live-roster-row" key={student.attendanceId}>
                  <div>
                    <strong>{student.fullName}</strong>
                    <small>{student.studentNumber}</small>
                  </div>
                  <Badge tone={student.status === "present" ? "success" : student.status === "late" ? "warning" : student.status === "excused" ? "purple" : "danger"}>
                    {STATUS_LABELS[student.status] || student.status}
                  </Badge>
                  <div className="live-roster-actions">
                    {[
                      ["present", "bi-check2", "حاضر"],
                      ["late", "bi-clock", "تأخیر"],
                      ["absent", "bi-x-lg", "غایب"],
                      ["excused", "bi-shield-check", "موجه"],
                    ].map(([status, icon, label]) => (
                      <button
                        key={status}
                        type="button"
                        className={`live-mark-btn ${status} ${student.status === status ? "active" : ""}`}
                        disabled={busy}
                        title={label}
                        onClick={() => mark(student, status)}
                      >
                        <Icon name={icon} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon="bi-people"
                title="دانشجویی در این جلسه نیست"
                text="فهرست دانشجویان جلسه خالی است."
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function StudentCalendar({
  sessions = [],
  records = [],
  leaveRequests = [],
  onLoadTrend,
}) {
  const today = toJalali(todayIso());
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [selectedIso, setSelectedIso] = useState(todayIso());
  const [trendRows, setTrendRows] = useState([]);

  useEffect(() => {
    let active = true;
    onLoadTrend?.({ from: daysAgoIso(29), to: todayIso(), granularity: "day" })
      .then((data) => {
        if (active) setTrendRows(data?.rows || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calendar = useMemo(() => buildJalaliMonth(year, month), [year, month]);

  const sessionsByDate = useMemo(() => {
    const map = new Map();
    for (const session of sessions) {
      if (!session?.date) continue;
      if (!map.has(session.date)) map.set(session.date, []);
      map.get(session.date).push(session);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    }
    return map;
  }, [sessions]);

  const statusBySession = useMemo(() => {
    const map = new Map();
    for (const record of records) {
      if (record.sessionId) map.set(record.sessionId, toEnStatus(record.status));
    }
    return map;
  }, [records]);

  const leaveByDate = useMemo(() => {
    const map = new Map();
    const approvedOrPending = leaveRequests.filter(
      (request) => request.status !== "rejected",
    );
    for (const request of approvedOrPending) {
      const start = new Date(`${request.startDate}T00:00:00Z`);
      const end = new Date(
        `${request.endDate || request.startDate}T00:00:00Z`,
      );
      const cursor = new Date(start);
      let guard = 0;
      while (cursor <= end && guard < 400) {
        map.set(cursor.toISOString().slice(0, 10), request);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard += 1;
      }
    }
    return map;
  }, [leaveRequests]);

  const selectedSessions = sessionsByDate.get(selectedIso) || [];
  const selectedLeave = leaveByDate.get(selectedIso);

  function shiftMonth(delta) {
    const next = addJalaliMonths(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  }

  return (
    <section className="student-calendar-section">
      <div className="student-help-hero">
        <div className="student-help-copy">
          <span className="student-welcome-eyebrow">
            <i /> تقویم شخصی
          </span>
          <h1>تقویم حضور من</h1>
          <p>
            کلاس‌ها، وضعیت حضور و مرخصی‌های خود را روی تقویم شمسی ببینید و روزها
            را برای جزئیات انتخاب کنید.
          </p>
        </div>
        <span className="student-help-mark">
          <Icon name="bi-calendar3" />
        </span>
      </div>

      <div className="content-card student-calendar-card">
        <div className="calendar-toolbar">
          <div>
            <strong>{jalaliLabel(year, month)}</strong>
            <small>
              {calendar.cells.filter((cell) => cell.inMonth).length.toLocaleString(
                "fa-IR",
              )}{" "}
              روز
            </small>
          </div>
          <div className="calendar-toolbar-actions">
            <button type="button" className="btn btn-light-outline" onClick={() => shiftMonth(1)}>
              <Icon name="bi-chevron-right" /> ماه بعد
            </button>
            <button
              type="button"
              className="ticket-chip"
              onClick={() => {
                const current = toJalali(todayIso());
                setYear(current.year);
                setMonth(current.month);
                setSelectedIso(todayIso());
              }}
            >
              امروز
            </button>
            <button type="button" className="btn btn-light-outline" onClick={() => shiftMonth(-1)}>
              ماه قبل <Icon name="bi-chevron-left" />
            </button>
          </div>
        </div>
        <div className="calendar-grid" role="grid" aria-label="تقویم ماهانه">
          {JALALI_WEEKDAYS.map((day) => (
            <span className="calendar-weekday" key={day}>
              {day}
            </span>
          ))}
          {calendar.cells.map((cell) => {
            const daySessions = sessionsByDate.get(cell.iso) || [];
            const leave = leaveByDate.get(cell.iso);
            const presentCount = daySessions.filter(
              (session) => statusBySession.get(session.id) === "present",
            ).length;
            return (
              <button
                key={cell.iso}
                type="button"
                role="gridcell"
                className={`calendar-cell ${cell.inMonth ? "" : "outside"} ${
                  cell.iso === selectedIso ? "selected" : ""
                } ${cell.isToday ? "today" : ""}`}
                onClick={() => setSelectedIso(cell.iso)}
              >
                <span className="calendar-day">{cell.day.toLocaleString("fa-IR")}</span>
                <span className="calendar-dots">
                  {daySessions.length ? (
                    <i className="dot session">{daySessions.length.toLocaleString("fa-IR")}</i>
                  ) : null}
                  {presentCount ? <i className="dot present" /> : null}
                  {leave ? <i className={`dot ${leave.status === "approved" ? "excused" : "pending"}`} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="calendar-legend">
          <span><i className="dot session" /> جلسه</span>
          <span><i className="dot present" /> حضور ثبت‌شده</span>
          <span><i className="dot excused" /> مرخصی تاییدشده</span>
          <span><i className="dot pending" /> مرخصی در انتظار</span>
        </div>
      </div>

      <div className="student-help-grid">
        <section className="content-card student-faq-card">
          <div className="student-section-heading">
            <div>
              <span>برنامهٔ روز</span>
              <h2>{formatJalali(selectedIso)}</h2>
            </div>
          </div>
          {selectedSessions.length ? (
            <div className="calendar-day-list">
              {selectedSessions.map((session) => {
                const status = statusBySession.get(session.id);
                return (
                  <div className="calendar-day-row" key={session.id}>
                    <span className={`student-record-icon ${STATUS_KIND[status] || "absent"}`}>
                      <Icon
                        name={
                          status === "present"
                            ? "bi-check2"
                            : status === "late"
                              ? "bi-clock"
                              : status === "excused"
                                ? "bi-shield-check"
                                : "bi-x-lg"
                        }
                      />
                    </span>
                    <div>
                      <strong>{session.course}</strong>
                      <small>
                        {session.startTime} تا {session.endTime}
                        {session.teacher ? ` · ${session.teacher}` : ""}
                      </small>
                    </div>
                    <Badge
                      tone={
                        status === "present"
                          ? "success"
                          : status === "late"
                            ? "warning"
                            : status === "excused"
                              ? "purple"
                              : status
                                ? "danger"
                                : "neutral"
                      }
                    >
                      {STATUS_LABELS[status] || "ثبت‌نشده"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="student-portal-empty-state compact">
              <Icon name="bi-calendar-x" />
              <strong>کلاسی در این روز نیست</strong>
              <span>برای مشاهدهٔ جزئیات، روز دیگری را انتخاب کنید.</span>
            </div>
          )}
          {selectedLeave ? (
            <div className="calendar-leave-note">
              <Icon name="bi-calendar2-check" />
              <span>
                {selectedLeave.type === "leave" ? "مرخصی" : "توجیه غیبت"} —{" "}
                {selectedLeave.status === "approved"
                  ? "تاییدشده"
                  : "در انتظار بررسی"}
                <small>{selectedLeave.reason}</small>
              </span>
            </div>
          ) : null}
        </section>

        <MiniTrendChart rows={trendRows} />
      </div>
    </section>
  );
}

export function LiveClassBanner({ session, status }) {
  if (!session) return null;
  const kind = toEnStatus(status);
  return (
    <section className="student-live-banner">
      <span className="live-pill live">
        <i /> در حال برگزاری
      </span>
      <div>
        <strong>{session.course}</strong>
        <small>
          {session.startTime} تا {session.endTime}
          {session.teacher ? ` · ${session.teacher}` : ""}
        </small>
      </div>
      <Badge
        tone={
          kind === "present"
            ? "success"
            : kind === "late"
              ? "warning"
              : kind === "excused"
                ? "purple"
                : "danger"
        }
      >
        وضعیت شما: {STATUS_LABELS[kind] || "ثبت‌نشده"}
      </Badge>
    </section>
  );
}

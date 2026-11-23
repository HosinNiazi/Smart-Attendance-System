import React from "react";
import { Icon, Select } from "./shared.jsx";

const STATE_CONTENT = {
  none: {
    tone: "neutral",
    icon: "bi-calendar-x",
    title: "امروز کلاسی برای این درس نیست",
  },
  unscheduled: {
    tone: "warning",
    icon: "bi-clock-history",
    title: "ساعت کلاس مشخص نیست",
  },
  missing: {
    tone: "warning",
    icon: "bi-calendar-plus",
    title: "جلسهٔ امروز هنوز ساخته نشده",
  },
  not_started: {
    tone: "warning",
    icon: "bi-hourglass-split",
    title: "کلاس هنوز شروع نشده",
  },
  open: {
    tone: "success",
    icon: "bi-broadcast",
    title: "ثبت حضور باز است",
  },
  ended: {
    tone: "warning",
    icon: "bi-clock-history",
    title: "زمان ثبت این جلسه تمام شده",
  },
  cancelled: {
    tone: "danger",
    icon: "bi-x-octagon",
    title: "این جلسه لغو شده است",
  },
  finalized: {
    tone: "danger",
    icon: "bi-lock",
    title: "این جلسه نهایی شده است",
  },
};

const STATUS_LABELS = {
  none: "بدون جلسه",
  unscheduled: "بدون ساعت",
  missing: "ایجاد نشده",
  not_started: "در انتظار شروع",
  open: "در حال برگزاری",
  ended: "پایان‌یافته",
  cancelled: "لغوشده",
  finalized: "نهایی‌شده",
};

/**
 * Shared "course + today's session" selector for the face, voice and classroom
 * attendance pages. It only ever exposes today's sessions, so an arbitrary
 * course/date pair can no longer be used to record attendance.
 */
export function TodaySessionPicker({
  courses = [],
  course = "",
  onCourseChange,
  session = null,
  windowInfo,
  date,
  disabled = false,
  onCreateSession,
  creating = false,
  idPrefix = "attendance",
}) {
  const info = windowInfo || {};
  const state = info.state || "none";
  const content = STATE_CONTENT[state] || STATE_CONTENT.none;
  const sessionId = `${idPrefix}-session`;
  const showCreate = state === "missing" && typeof onCreateSession === "function";
  const sessionOptionLabel = session
    ? `${info.startLabel || session.startTime || "—"} تا ${
        info.endLabel || session.endTime || "—"
      } — ${STATUS_LABELS[state] || "جلسه"}`
    : state === "missing"
      ? "جلسه‌ای ثبت نشده — از دکمهٔ زیر ایجاد کنید"
      : "جلسه‌ای برای امروز ثبت نشده";

  return (
    <div className="today-session-picker">
      <label className="form-label" htmlFor={`${idPrefix}-course`}>
        درس / کلاس
      </label>
      <Select
        id={`${idPrefix}-course`}
        className="form-select"
        value={course}
        disabled={disabled}
        onChange={(event) => onCourseChange?.(event.target.value)}
      >
        {courses.map((item) => (
          <option key={item.id || item.title} value={item.title}>
            {item.title}
          </option>
        ))}
      </Select>

      <div className="session-date-lock">
        <Icon name="bi-lock" />
        <span>
          تاریخ جلسه: <strong>{info.dateLabel || "—"}</strong> — فقط جلسه‌های
          امروز
        </span>
      </div>

      <label className="form-label" htmlFor={sessionId}>
        جلسهٔ امروز
      </label>
      <Select
        id={sessionId}
        className="form-select"
        value={session?.id || ""}
        disabled
        aria-label="جلسهٔ امروز"
      >
        <option value={session?.id || ""}>{sessionOptionLabel}</option>
      </Select>

      <div
        className={`session-state-card is-${content.tone}`}
        role="status"
        aria-live="polite"
      >
        <span className="session-state-icon">
          <Icon name={content.icon} />
        </span>
        <div className="session-state-copy">
          <strong>{content.title}</strong>
          <small>{info.message || ""}</small>
          {state === "open" && info.closeLabel ? (
            <small>ثبت خودکار تا ساعت {info.closeLabel} باز است.</small>
          ) : null}
        </div>
        {showCreate ? (
          <button
            type="button"
            className="btn btn-primary btn-sm session-create-button"
            disabled={creating}
            onClick={() => onCreateSession?.()}
          >
            <Icon name={creating ? "bi-hourglass-split" : "bi-calendar-plus"} />
            {creating ? "در حال ایجاد…" : "ایجاد جلسهٔ امروز"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

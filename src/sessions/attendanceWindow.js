import { formatJalali, todayIso } from "../calendar/jalali.js";

// JavaScript's getDay() starts on Sunday; the courses table stores the Persian
// weekday name (as the course form produces it) or the English name (imports).
const PERSIAN_WEEKDAYS_BY_JS_DAY = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
  "شنبه",
];

const ENGLISH_WEEKDAYS = {
  saturday: "شنبه",
  sunday: "یکشنبه",
  monday: "دوشنبه",
  tuesday: "سه‌شنبه",
  wednesday: "چهارشنبه",
  thursday: "پنجشنبه",
  friday: "جمعه",
};

function weekdayKey(value) {
  return String(value || "")
    .trim()
    .replace(/[\s\u200c\u200f\u200e]+/g, "")
    .replace(/ك/g, "ک");
}

export function normalizeWeekday(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const english = ENGLISH_WEEKDAYS[text.toLowerCase()];
  if (english) return english;
  const key = weekdayKey(text);
  return (
    PERSIAN_WEEKDAYS_BY_JS_DAY.find((day) => weekdayKey(day) === key) || text
  );
}

export function persianWeekdayOf(isoDate) {
  const date = new Date(`${String(isoDate || todayIso()).slice(0, 10)}T12:00:00`);
  return PERSIAN_WEEKDAYS_BY_JS_DAY[date.getDay()] || "";
}

export function isCourseScheduledToday(course, isoDate = todayIso()) {
  if (!course?.weekday) return false;
  return (
    weekdayKey(normalizeWeekday(course.weekday)) ===
    weekdayKey(persianWeekdayOf(isoDate))
  );
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function atTime(isoDate, clock) {
  const [year, month, day] = String(isoDate).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, clock.hours, clock.minutes, 0, 0);
}

function clockLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Resolves whether attendance may be recorded right now for one session.
 *
 * The session row wins over the course schedule because a rescheduled class may
 * sit on a different day, and the row carries the per-session grace/close
 * windows. When no row exists yet, the course schedule is used only to decide
 * whether the session *could* exist today ("missing" state).
 */
export function resolveSessionWindow({
  session = null,
  course = null,
  date = todayIso(),
  now = new Date(),
} = {}) {
  const isoDate = String(date || todayIso()).slice(0, 10);
  const scheduledToday = isCourseScheduledToday(course, isoDate);
  const hasSession = Boolean(session?.databaseId);
  const startSource = session?.startTime || course?.startTime || "";
  const endSource = session?.endTime || course?.endTime || "";
  const startClock = parseClock(startSource);
  const endClock = parseClock(endSource);
  const base = {
    date: isoDate,
    dateLabel: formatJalali(isoDate),
    hasSession,
    scheduledToday,
    startLabel: startClock ? clockLabel(startClock.hours * 60 + startClock.minutes) : "",
    endLabel: endClock ? clockLabel(endClock.hours * 60 + endClock.minutes) : "",
    graceMinutes: Number(session?.graceMinutes ?? 10),
    closeAfterMinutes: Number(session?.closeAfterMinutes ?? 30),
    canRecord: false,
  };

  if (!hasSession && !scheduledToday) {
    return { ...base, state: "none", message: "این درس امروز کلاس ندارد." };
  }

  if (!startClock || !endClock) {
    return {
      ...base,
      state: "unscheduled",
      message: "برای این درس ساعت شروع و پایان ثبت نشده است.",
    };
  }

  if (!hasSession) {
    return {
      ...base,
      state: "missing",
      message: "جلسهٔ امروز هنوز ایجاد نشده است.",
    };
  }

  const start = atTime(isoDate, startClock);
  const end = atTime(isoDate, endClock);
  const closeAt = new Date(
    end.getTime() + base.closeAfterMinutes * 60_000,
  );
  const closeLabel = `${clockLabel(
    endClock.hours * 60 + endClock.minutes + base.closeAfterMinutes,
  )}`;
  const cancelled =
    session?.cancelled === true || session?.status === "cancelled";
  const finalized =
    session?.finalized === true || session?.status === "finalized";

  let state = "open";
  let message = "ثبت حضور باز است.";
  if (cancelled) {
    state = "cancelled";
    message = "این جلسه لغو شده است و ثبت حضور در آن ممکن نیست.";
  } else if (finalized) {
    state = "finalized";
    message = "این جلسه نهایی شده است و ثبت جدید در آن ممکن نیست.";
  } else if (now < start) {
    state = "not_started";
    message = `کلاس هنوز شروع نشده است؛ شروع ساعت ${base.startLabel}.`;
  } else if (now > closeAt) {
    state = "ended";
    message = `زمان ثبت این جلسه تمام شده است؛ پایان ساعت ${base.endLabel}.`;
  }

  return {
    ...base,
    state,
    message,
    start,
    end,
    closeAt,
    closeLabel,
    canRecord: state === "open",
  };
}

// Messages shown after an automatic recognition was blocked. The same wording
// is used by the face popup, the classroom box tooltip and the voice page.
export function attendanceBlockMessage(reason, { name = "", windowInfo } = {}) {
  void name;
  switch (reason) {
    case "before_start":
      return {
        tone: "early",
        title: "کلاس هنوز شروع نشده",
        detail: `شناسایی انجام شد؛ شروع کلاس ${
          windowInfo?.startLabel || "—"
        } است و حضور ثبت نمی‌شود.`,
      };
    case "after_end":
      return {
        tone: "ended",
        title: "زمان ثبت تمام شده",
        detail: `شناسایی انجام شد؛ اما ثبت حضور تا ${
          windowInfo?.closeLabel || windowInfo?.endLabel || "—"
        } بود.`,
      };
    case "session_cancelled":
      return {
        tone: "ended",
        title: "جلسه لغو شده",
        detail: "برای جلسهٔ لغوشده امکان ثبت حضور وجود ندارد.",
      };
    case "session_finalized":
      return {
        tone: "ended",
        title: "جلسه نهایی شده",
        detail: "این جلسه بسته شده و ثبت جدید در آن ممکن نیست.",
      };
    case "no_session":
      return {
        tone: "ended",
        title: "جلسه‌ای برای امروز نیست",
        detail:
          "ابتدا جلسهٔ امروز این درس را ایجاد کنید؛ سپس حضور ثبت می‌شود.",
      };
    default:
      return {
        tone: "ended",
        title: "ثبت حضور انجام نشد",
        detail: "وضعیت جلسه یا بازهٔ زمانی را بررسی کنید.",
      };
  }
}

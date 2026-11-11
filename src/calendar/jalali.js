const DAY_MS = 86400000;
const jalaliFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});
const faDateFormatter = new Intl.DateTimeFormat("fa-IR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const faShortFormatter = new Intl.DateTimeFormat("fa-IR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export const JALALI_WEEKDAYS = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
];

function toUtcDate(value) {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  }
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
}

export function toJalali(value) {
  const date = toUtcDate(value);
  const parts = jalaliFormatter.formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function toIsoDate(value) {
  return toUtcDate(value).toISOString().slice(0, 10);
}

export function formatJalali(value, short = false) {
  if (!value) return "—";
  return (short ? faShortFormatter : faDateFormatter).format(toUtcDate(value));
}

export function todayIso() {
  return toIsoDate(new Date());
}

function monthStart(year, month) {
  // The Persian year starts around 21 March; scan forward from mid-March.
  const guess = new Date(Date.UTC(year + 621, 2, 15));
  for (let index = 0; index < 400; index += 1) {
    const candidate = new Date(guess.getTime() + index * DAY_MS);
    const jalali = toJalali(candidate);
    if (
      jalali.year === year &&
      jalali.month === month &&
      jalali.day === 1
    ) {
      return candidate;
    }
  }
  return guess;
}

export function addJalaliMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function buildJalaliMonth(year, month) {
  const start = monthStart(year, month);
  // Persian week starts on Saturday: getUTCDay() 6 = Saturday → index 0.
  const leading = (start.getUTCDay() + 1) % 7;
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getTime() + (index - leading) * DAY_MS);
    const iso = date.toISOString().slice(0, 10);
    const jalali = toJalali(date);
    cells.push({
      iso,
      day: jalali.day,
      inMonth: jalali.month === month && jalali.year === year,
      isToday: iso === todayIso(),
    });
  }
  return {
    year,
    month,
    label: `${JALALI_MONTHS[month - 1]} ${year}`,
    cells,
  };
}

export function jalaliLabel(year, month) {
  return `${JALALI_MONTHS[month - 1]} ${Number(year).toLocaleString("fa-IR", {
    useGrouping: false,
  })}`;
}

export function jalaliToIso(year, month, day) {
  const start = monthStart(year, month);
  return new Date(start.getTime() + (day - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function jalaliMonthLength(year, month) {
  const next = addJalaliMonths(year, month, 1);
  return Math.round(
    (monthStart(next.year, next.month) - monthStart(year, month)) / DAY_MS,
  );
}

export function formatJalaliNumeric(value) {
  if (!value) return "";
  const { year, month, day } = toJalali(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${year}/${pad(month)}/${pad(day)}`.replace(
    /\d/g,
    (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)],
  );
}

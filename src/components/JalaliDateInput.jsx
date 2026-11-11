import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  JALALI_WEEKDAYS,
  addJalaliMonths,
  buildJalaliMonth,
  formatJalali,
  formatJalaliNumeric,
  jalaliLabel,
  toJalali,
  todayIso,
} from "../calendar/jalali.js";

const SHORT_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const POPOVER_WIDTH = 308;
const POPOVER_HEIGHT = 394;

function safeIso(value) {
  return value ? String(value).slice(0, 10) : "";
}

export function JalaliDateInput({
  value = "",
  onChange,
  min = "",
  max = "",
  placeholder = "انتخاب تاریخ",
  disabled = false,
  clearable = false,
  id,
  className = "",
  ariaLabel,
}) {
  const currentIso = safeIso(value);
  const minIso = safeIso(min);
  const maxIso = safeIso(max);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() =>
    toJalali(currentIso || minIso || todayIso()),
  );
  const [position, setPosition] = useState(null);
  const fieldRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) setView(toJalali(currentIso || minIso || todayIso()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIso, minIso, open]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event) {
      if (fieldRef.current?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function updatePosition() {
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 24);
      const left = Math.max(
        12,
        Math.min(rect.right - width, window.innerWidth - width - 12),
      );
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const maxTop = Math.max(window.innerHeight - POPOVER_HEIGHT - 12, 12);
      let top;
      if (spaceBelow >= POPOVER_HEIGHT + 12) {
        top = rect.bottom + 8;
      } else if (spaceAbove >= POPOVER_HEIGHT + 12) {
        top = rect.top - POPOVER_HEIGHT - 8;
      } else {
        top = Math.min(rect.bottom + 8, maxTop);
      }
      top = Math.min(Math.max(top, 12), maxTop);
      setPosition({ top, left, width });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const calendar = useMemo(
    () => buildJalaliMonth(view.year, view.month),
    [view.year, view.month],
  );

  function toggle() {
    if (disabled) return;
    if (!open) {
      const anchor = toJalali(currentIso || minIso || todayIso());
      setView({ year: anchor.year, month: anchor.month });
    }
    setPosition(null);
    setOpen((current) => !current);
  }

  function pick(iso) {
    if (!iso) return;
    onChange?.(iso);
    setOpen(false);
  }

  function shift(delta) {
    setView((current) => addJalaliMonths(current.year, current.month, delta));
  }

  const today = todayIso();
  const todayBlocked =
    (minIso && today < minIso) || (maxIso && today > maxIso);

  const popover =
    open && position
      ? createPortal(
          <div
            ref={popoverRef}
            className="jalali-calendar-popover"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            role="dialog"
            aria-label="انتخاب تاریخ شمسی"
            dir="rtl"
          >
            <div className="jalali-calendar-head">
              <button
                type="button"
                className="jalali-nav-btn"
                aria-label="ماه قبل"
                title="ماه قبل"
                onClick={() => shift(-1)}
              >
                <i className="bi bi-chevron-right" />
              </button>
              <div className="jalali-month-title">
                <strong>{jalaliLabel(view.year, view.month)}</strong>
                <small>تقویم شمسی</small>
              </div>
              <button
                type="button"
                className="jalali-nav-btn"
                aria-label="ماه بعد"
                title="ماه بعد"
                onClick={() => shift(1)}
              >
                <i className="bi bi-chevron-left" />
              </button>
            </div>

            <div className="jalali-weekdays" aria-hidden="true">
              {JALALI_WEEKDAYS.map((day, index) => (
                <span key={day} title={day}>
                  {SHORT_WEEKDAYS[index]}
                </span>
              ))}
            </div>

            <div className="jalali-days" role="grid">
              {calendar.cells.map((cell) => {
                const blocked =
                  (minIso && cell.iso < minIso) ||
                  (maxIso && cell.iso > maxIso);
                const selected = cell.iso === currentIso;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    role="gridcell"
                    disabled={Boolean(blocked)}
                    className={`jalali-day ${cell.inMonth ? "" : "outside"} ${
                      cell.isToday ? "today" : ""
                    } ${selected ? "selected" : ""}`}
                    aria-label={`${formatJalali(cell.iso)}${
                      selected ? "، انتخاب‌شده" : ""
                    }`}
                    aria-selected={selected}
                    onClick={() => pick(cell.iso)}
                  >
                    {cell.day.toLocaleString("fa-IR", {
                      useGrouping: false,
                    })}
                  </button>
                );
              })}
            </div>

            <div className="jalali-calendar-foot">
              <button
                type="button"
                className="jalali-foot-btn"
                disabled={Boolean(todayBlocked)}
                onClick={() => pick(today)}
              >
                <i className="bi bi-crosshair" /> امروز
              </button>
              <div className="jalali-foot-side">
                <span className="jalali-selected-label">
                  {currentIso ? formatJalali(currentIso) : "بدون تاریخ"}
                </span>
                {clearable && currentIso ? (
                  <button
                    type="button"
                    className="jalali-clear-btn"
                    onClick={() => {
                      onChange?.("");
                      setOpen(false);
                    }}
                  >
                    پاک کردن
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={`jalali-date-field ${open ? "open" : ""} ${className}`.trim()}
      ref={fieldRef}
    >
      <button
        id={id}
        type="button"
        className="jalali-date-trigger"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span
          className={`jalali-date-value ${currentIso ? "" : "placeholder"}`}
        >
          {currentIso ? formatJalaliNumeric(currentIso) : placeholder}
        </span>
        <i className="bi bi-calendar3 jalali-date-icon" aria-hidden="true" />
      </button>
      {popover}
    </div>
  );
}

export default JalaliDateInput;

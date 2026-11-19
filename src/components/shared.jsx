import React from 'react';
import { createPortal } from 'react-dom';
export class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error("Application render failed", error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="fatal-error-screen" dir="rtl" role="alert"><span><i className="bi bi-exclamation-triangle" /></span><h1>صفحه با خطا روبه‌رو شد</h1><p>اطلاعات ذخیره‌شده پاک نشده است. صفحه را دوباره بارگذاری کنید؛ اگر مشکل ادامه داشت، نسخهٔ پشتیبان را بازیابی کنید.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>بارگذاری دوباره</button></main>;
  }
}
export function Icon({ name, className = "" }) {
  return <i className={`bi ${name} ${className}`} aria-hidden="true" />;
}
export function Badge({ children, tone = "success" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
export function PanelTitle({ eyebrow, title, description, action }) {
  return (
    <div className="panel-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function StatCard({ icon, label, value, detail, trend, color = "blue" }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon name={icon} />
      </div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>
          {trend && <b>{trend}</b>} {detail}
        </small>
      </div>
      <div className="stat-decoration" />
    </div>
  );
}
/**
 * صفحه‌بندی سبک جدول‌ها. اگر همهٔ ردیف‌ها در یک صفحه جا شوند، چیزی رندر نمی‌شود.
 */
export function TablePager({ page = 1, pageSize = 10, total = 0, onPageChange, label = "مورد" }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const start = Math.max(1, Math.min(current - 2, pageCount - 4));
  const numbers = [];
  for (let i = start; i <= Math.min(pageCount, start + 4); i += 1) numbers.push(i);

  return (
    <nav className="table-pager" aria-label="صفحه‌بندی جدول">
      <span className="table-pager-info">
        نمایش {from.toLocaleString("fa-IR")} تا {to.toLocaleString("fa-IR")} از{" "}
        {total.toLocaleString("fa-IR")} {label}
      </span>
      <div className="table-pager-actions">
        <button
          type="button"
          className="pager-btn"
          onClick={() => onPageChange?.(current - 1)}
          disabled={current <= 1}
          aria-label="صفحهٔ قبل"
        >
          <Icon name="bi-chevron-right" />
        </button>
        {numbers.map((number) => (
          <button
            key={number}
            type="button"
            className={`pager-btn ${number === current ? "active" : ""}`}
            onClick={() => onPageChange?.(number)}
            aria-current={number === current ? "page" : undefined}
            aria-label={`صفحهٔ ${number.toLocaleString("fa-IR")}`}
          >
            {number.toLocaleString("fa-IR")}
          </button>
        ))}
        <button
          type="button"
          className="pager-btn"
          onClick={() => onPageChange?.(current + 1)}
          disabled={current >= pageCount}
          aria-label="صفحهٔ بعد"
        >
          <Icon name="bi-chevron-left" />
        </button>
      </div>
    </nav>
  );
}
export function EmptyState({ icon = "bi-inbox", title, text }) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
export function Skeleton({ className = "", style }) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}
export function SkeletonTable({ rows = 5, columns = 5 }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }).map((_, row) => (
        <div className="skeleton-row" key={row}>
          {Array.from({ length: columns }).map((__, column) => (
            <Skeleton
              key={column}
              className="skeleton-line"
              style={{ width: `${[42, 28, 52, 20, 24][column % 5]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
export function SkeletonCards({ count = 4 }) {
  return (
    <div className="ticket-stat-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div className="stat-card skeleton-card" key={index}>
          <Skeleton className="skeleton-icon" />
          <div className="stat-copy">
            <Skeleton className="skeleton-line" style={{ width: "55%" }} />
            <Skeleton className="skeleton-line lg" style={{ width: "30%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
/** آواتار دانشجو: عکس پروفایل (عکس تشخیص چهره) یا حرف اول نام. */
export function StudentAvatar({ name = "", photo = "", index = 0, className = "" }) {
  const cls = className || `student-avatar avatar-${index % 5}`;
  if (photo)
    return (
      <a
        href={photo}
        target="_blank"
        rel="noopener noreferrer"
        className={`${cls} has-photo`}
        title="مشاهدهٔ عکس پروفایل"
      >
        <img src={photo} alt={name} loading="lazy" />
      </a>
    );
  return <span className={cls}>{name.charAt(0) || "—"}</span>;
}


function selectOptionText(children) {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(selectOptionText).join("");
  if (React.isValidElement(children)) return selectOptionText(children.props.children);
  return "";
}

// A dropdown that keeps the project look in both themes. Native <select>
// popups are drawn by the operating system, so they stay light and out of
// place in dark mode; this component renders its own accessible listbox.
export function Select({
  value: controlledValue,
  defaultValue,
  onChange,
  children,
  className = "form-select",
  disabled = false,
  name,
  id,
  required = false,
  placeholder,
  ...rest
}) {
  const autoId = React.useId();
  const triggerId = id || `select-${autoId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const options = React.useMemo(() => {
    const list = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child) || child.type !== "option") return;
      const label = selectOptionText(child.props.children)
        .replace(/\s+/g, " ")
        .trim();
      const rawValue = child.props.value;
      list.push({
        value: rawValue == null ? label : String(rawValue),
        label,
        disabled: Boolean(child.props.disabled),
      });
    });
    return list;
  }, [children]);

  const uncontrolled = controlledValue === undefined;
  const firstValue = options.length ? options[0].value : "";
  const [innerValue, setInnerValue] = React.useState(() =>
    defaultValue == null ? firstValue : String(defaultValue),
  );
  const currentValue = uncontrolled ? innerValue : String(controlledValue ?? "");
  const selectedIndex = options.findIndex(
    (option) => option.value === currentValue,
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const display =
    selected?.label || options[0]?.label || placeholder || "";

  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(-1);
  const [menuPos, setMenuPos] = React.useState(null);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);

  const positionMenu = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const width = Math.max(rect.width, 160);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    // Prefer the measured menu height; fall back to an estimate on first paint.
    const content = menuRef.current
      ? menuRef.current.scrollHeight
      : Math.min(288, options.length * 42 + 10);
    const want = Math.min(288, content);
    const openUp = want > below && above > below;
    const maxHeight = Math.max(96, Math.min(288, openUp ? above : below));
    const height = Math.min(want, maxHeight);
    const top = openUp
      ? Math.max(8, rect.top - height - gap)
      : Math.min(window.innerHeight - height - 8, rect.bottom + gap);
    setMenuPos((prev) =>
      prev &&
      prev.left === left &&
      prev.top === top &&
      prev.width === width &&
      prev.maxHeight === maxHeight
        ? prev
        : { left, top, width, maxHeight },
    );
  }, [options.length]);

  // Re-measure once the listbox is mounted so the gap stays exactly `6px`.
  React.useLayoutEffect(() => {
    if (open && menuRef.current) positionMenu();
  }, [open, positionMenu]);

  function openMenu() {
    if (disabled) return;
    positionMenu();
    setHighlighted(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function commit(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (uncontrolled) setInnerValue(option.value);
    onChange?.({
      target: { value: option.value, name },
      currentTarget: { value: option.value, name },
    });
    setOpen(false);
    triggerRef.current?.focus();
  }

  React.useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (triggerRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onReposition(event) {
      if (event?.target && menuRef.current?.contains(event.target)) return;
      positionMenu();
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, positionMenu]);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector(`[data-select-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  function onKeyDown(event) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => Math.min(options.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setHighlighted(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setHighlighted(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(highlighted);
    }
  }

  return (
    <>
      <button
        {...rest}
        ref={triggerRef}
        type="button"
        id={triggerId}
        className={`select-field ${className}`.trim()}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${triggerId}-menu` : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{display || "\u00a0"}</span>
        <i className="bi bi-chevron-down select-chevron" aria-hidden="true" />
      </button>
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              id={`${triggerId}-menu`}
              className="select-menu"
              role="listbox"
              dir="rtl"
              style={{
                left: menuPos.left,
                top: menuPos.top,
                width: menuPos.width,
                maxHeight: menuPos.maxHeight,
              }}
            >
              {options.map((option, index) => (
                <button
                  key={`${option.value}-${index}`}
                  type="button"
                  data-select-index={index}
                  className={`select-option${index === selectedIndex ? " is-selected" : ""}${index === highlighted ? " is-active" : ""}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => commit(index)}
                >
                  <span>{option.label}</span>
                  {index === selectedIndex ? (
                    <i className="bi bi-check2" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

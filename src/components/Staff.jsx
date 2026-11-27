import React, { useCallback, useEffect, useState } from "react";
import {
  Badge,
  EmptyState,
  Icon,
  PanelTitle,
  Select,
  SkeletonTable,
} from "./shared.jsx";
import {
  createStaff,
  fetchStaff,
  resetStaffPassword,
  updateStaff,
} from "../api/client.js";

// Mirrors the server-side role catalogue in `server/src/permissions.js`.
const ROLE_META = [
  {
    value: "owner",
    label: "مدیر دانشکده",
    icon: "bi-shield-check",
    tone: "success",
    summary: "دسترسی کامل به دانشکده و تعیین سطح دسترسی کارمندان.",
  },
  {
    value: "manager",
    label: "مدیر آموزش",
    icon: "bi-mortarboard",
    tone: "info",
    summary:
      "همهٔ بخش‌های آموزشی، آزمون‌ها، اساتید و تنظیمات؛ بدون تعیین سطح دسترسی.",
  },
  {
    value: "operator",
    label: "کارمند آموزش",
    icon: "bi-clipboard-check",
    tone: "neutral",
    summary:
      "ثبت دستی حضور و مشاهدهٔ دانشجویان، درس‌ها، جلسات و گزارش‌ها؛ بدون چهره، صدا و آزمون.",
  },
  {
    value: "viewer",
    label: "کارمند آموزش (فقط مشاهده)",
    icon: "bi-eye",
    tone: "neutral",
    summary: "همان دسترسی کارمند آموزش، اما بدون ثبت یا تغییر داده.",
  },
];

const ROLE_BY_VALUE = Object.fromEntries(
  ROLE_META.map((role) => [role.value, role]),
);

function roleLabel(value) {
  return ROLE_BY_VALUE[value]?.label || "کارمند";
}

function faDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("fa-IR");
  } catch {
    return "—";
  }
}

export function Staff({ onNotify }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    level: "operator",
  });
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchStaff();
      setStaff(data?.staff || []);
      setError("");
    } catch (err) {
      setError(err.message || "دریافت فهرست کارمندان انجام نشد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm({ fullName: "", email: "", level: "operator" });
    setFormError("");
    setCreateOpen(true);
  }

  async function submitCreate(event) {
    event.preventDefault();
    const email = form.email.trim();
    if (form.fullName.trim().length < 2) {
      setFormError("نام و نام خانوادگی کارمند را وارد کنید.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("ایمیل معتبر وارد کنید.");
      return;
    }
    setFormError("");
    setPending(true);
    try {
      const result = await createStaff({
        fullName: form.fullName.trim(),
        email,
        level: form.level,
      });
      setCreateOpen(false);
      setCredentials({
        title: "حساب کارمند ساخته شد",
        username: result?.account?.username || email,
        password: result?.account?.temporaryPassword || "",
        emailSent: result?.account?.emailSent === true,
      });
      await load();
    } catch (err) {
      setFormError(err.message || "ساخت حساب کارمند انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  async function changeLevel(member, level) {
    if (level === member.level) return;
    setBusyId(member.id);
    try {
      await updateStaff(member.id, { level });
      onNotify?.(`سطح دسترسی «${member.fullName}» به «${roleLabel(level)}» تغییر کرد.`);
      await load();
    } catch (err) {
      onNotify?.(err.message || "تغییر سطح دسترسی انجام نشد.");
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function toggleActive(member) {
    setBusyId(member.id);
    try {
      await updateStaff(member.id, { isActive: !member.isActive });
      onNotify?.(
        member.isActive
          ? `حساب «${member.fullName}» غیرفعال شد.`
          : `حساب «${member.fullName}» فعال شد.`,
      );
      await load();
    } catch (err) {
      onNotify?.(err.message || "تغییر وضعیت حساب انجام نشد.");
    } finally {
      setBusyId("");
    }
  }

  async function resetPassword(member) {
    const ok = window.confirm(
      `رمز عبور «${member.fullName}» بازنشانی شود؟ رمز فعلی دیگر کار نخواهد کرد.`,
    );
    if (!ok) return;
    setBusyId(member.id);
    try {
      const result = await resetStaffPassword(member.id);
      setCopied(false);
      setCredentials({
        title: "رمز موقت جدید",
        username: result?.username || member.email,
        password: result?.temporaryPassword || "",
        emailSent: result?.emailSent === true,
      });
    } catch (err) {
      onNotify?.(err.message || "بازنشانی رمز انجام نشد.");
    } finally {
      setBusyId("");
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    const text = credentials.password
      ? `نام کاربری: ${credentials.username}\nرمز موقت: ${credentials.password}`
      : `نام کاربری: ${credentials.username}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
      onNotify?.("کپی خودکار ممکن نشد؛ متن را دستی انتخاب کنید.");
    }
  }

  return (
    <>
      <PanelTitle
        eyebrow="سیستم"
        title="کارمندان و سطوح دسترسی"
        description="نقش هر کارمند را انتخاب کنید؛ همان سطح دسترسی در سرور و منوی برنامه اعمال می‌شود."
        action={
          <button className="btn btn-primary" type="button" onClick={openCreate}>
            <Icon name="bi-person-plus" /> افزودن کارمند
          </button>
        }
      />

      <div className="staff-role-grid" aria-label="معرفی سطوح دسترسی">
        {ROLE_META.map((role) => (
          <article className="staff-role-card" key={role.value}>
            <span className="staff-role-icon">
              <Icon name={role.icon} />
            </span>
            <strong>{role.label}</strong>
            <p>{role.summary}</p>
          </article>
        ))}
      </div>

      <div className="content-card data-card">
        <div className="table-toolbar">
          <div>
            <h3 className="card-heading">فهرست کارمندان دانشکده</h3>
            <small className="staff-hint">
              فقط مدیر دانشکده می‌تواند این سطوح را تعیین یا تغییر دهد.
            </small>
          </div>
          <span className="result-count">
            {staff.length.toLocaleString("fa-IR")} کارمند
          </span>
        </div>

        {error && (
          <div className="settings-warning" role="alert">
            <Icon name="bi-exclamation-triangle" /> {error}
          </div>
        )}

        {loading && !staff.length ? (
          <SkeletonTable rows={4} columns={5} />
        ) : staff.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>کارمند</th>
                  <th>ایمیل</th>
                  <th>سطح دسترسی</th>
                  <th>وضعیت</th>
                  <th>آخرین ورود</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="staff-person">
                        <span className="staff-avatar">
                          {member.fullName?.trim().charAt(0) || "م"}
                        </span>
                        <div>
                          <strong>{member.fullName}</strong>
                          {member.isSelf && (
                            <small className="staff-self">حساب شما</small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td dir="ltr" style={{ textAlign: "right" }}>
                      {member.email}
                    </td>
                    <td style={{ minWidth: 190 }}>
                      <Select
                        className="form-select"
                        value={member.level}
                        disabled={busyId === member.id}
                        aria-label={`سطح دسترسی ${member.fullName}`}
                        onChange={(event) =>
                          changeLevel(member, event.target.value)
                        }
                      >
                        {ROLE_META.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Badge tone={member.isActive ? "success" : "neutral"}>
                        {member.isActive ? "فعال" : "غیرفعال"}
                      </Badge>
                    </td>
                    <td>{faDate(member.lastLoginAt)}</td>
                    <td>
                      <div className="student-actions-cell">
                        <button
                          className="btn btn-light-outline btn-sm"
                          type="button"
                          disabled={busyId === member.id}
                          onClick={() => resetPassword(member)}
                        >
                          <Icon name="bi-key" /> رمز
                        </button>
                        <button
                          className="btn btn-light-outline btn-sm"
                          type="button"
                          disabled={busyId === member.id || member.isSelf}
                          title={
                            member.isSelf
                              ? "غیرفعال‌کردن حساب خودتان مجاز نیست."
                              : undefined
                          }
                          onClick={() => toggleActive(member)}
                        >
                          <Icon
                            name={
                              member.isActive
                                ? "bi-person-dash"
                                : "bi-person-check"
                            }
                          />
                          {member.isActive ? "غیرفعال" : "فعال"}
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
            icon="bi-people"
            title="هنوز کارمندی تعریف نشده است"
            description="با «افزودن کارمند» اولین حساب مدیر آموزش یا کارمند آموزش را بسازید."
          />
        )}
      </div>

      {createOpen && (
        <div
          className="modal-backdrop-custom"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending)
              setCreateOpen(false);
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
                <div className="eyebrow">دسترسی کارمندان</div>
                <h3>افزودن کارمند جدید</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={pending}
                onClick={() => setCreateOpen(false)}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>

            <form onSubmit={submitCreate}>
              <label className="form-label">
                نام و نام خانوادگی
                <input
                  className="form-control"
                  value={form.fullName}
                  autoFocus
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fullName: event.target.value,
                    }))
                  }
                  placeholder="مثلاً مریم رضایی"
                />
              </label>
              <label className="form-label">
                ایمیل (نام کاربری)
                <input
                  className="form-control"
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="staff@faculty.ac.ir"
                />
              </label>
              <label className="form-label">
                سطح دسترسی
                <Select
                  className="form-select"
                  value={form.level}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      level: event.target.value,
                    }))
                  }
                >
                  {ROLE_META.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="staff-form-hint">
                {ROLE_BY_VALUE[form.level]?.summary}
              </p>

              {formError && (
                <div className="settings-warning" role="alert">
                  <Icon name="bi-exclamation-triangle" /> {formError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-light-outline"
                  disabled={pending}
                  onClick={() => setCreateOpen(false)}
                >
                  انصراف
                </button>
                <button className="btn btn-primary" disabled={pending}>
                  {pending ? "در حال ساخت…" : "ساخت حساب"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {credentials && (
        <div
          className="modal-backdrop-custom"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCredentials(null);
          }}
        >
          <section
            className="custom-modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 460 }}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">رمز موقت</div>
                <h3>{credentials.title}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setCredentials(null)}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <p className="staff-form-hint">
              {credentials.password
                ? "این رمز فقط یک‌بار نمایش داده می‌شود و در اولین ورود باید تغییر کند."
                : "رمز موقت در پاسخ API نمایش داده نمی‌شود و فقط به ایمیل کاربر ارسال شده است."}
            </p>
            <div className="staff-credential-box" dir="ltr">
              <span>{credentials.username}</span>
              {credentials.password ? (
                <strong>{credentials.password}</strong>
              ) : (
                <strong>
                  {credentials.emailSent
                    ? "رمز موقت به ایمیل کاربر ارسال شد."
                    : "ارسال ایمیل انجام نشد؛ با مدیر سامانه تماس بگیرید."}
                </strong>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-light-outline"
                onClick={copyCredentials}
              >
                <Icon name={copied ? "bi-check2" : "bi-clipboard"} />
                {copied ? "کپی شد" : "کپی"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCredentials(null)}
              >
                متوجه شدم
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

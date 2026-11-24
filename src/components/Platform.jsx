import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState, Icon, Select, SkeletonTable, StatCard, TablePager } from "./shared.jsx";
import {
  archivePlatformFaculty,
  clearPlatformSession,
  createFacultyAdmin,
  createPlatformAdmin,
  createPlatformFaculty,
  enterFaculty,
  fetchPlatformAdmins,
  fetchPlatformAudit,
  fetchPlatformFaculty,
  fetchPlatformFaculties,
  fetchPlatformImpersonations,
  fetchPlatformOverview,
  getPlatformToken,
  getPlatformUser,
  platformChangePassword,
  platformSignIn,
  resetFacultyAdminPassword,
  resetPlatformAdminPassword,
  revokeImpersonation,
  setPlatformSession,
  updateFacultyAdmin,
  updatePlatformAdmin,
  updatePlatformFaculty,
} from "../api/client.js";

const FACULTY_LEVEL_LABELS = {
  owner: "مدیر دانشکده",
  manager: "مدیر آموزش",
  operator: "کارمند آموزش",
  viewer: "کارمند آموزش (فقط مشاهده)",
};
const FACULTY_LEVEL_HINTS = {
  owner: "دسترسی کامل به همهٔ بخش‌های دانشکده و مدیریت کارکنان",
  manager: "مدیریت آموزش، کلاس‌ها، حضور و گزارش‌ها بدون تغییر تنظیمات حساس",
  operator: "ثبت و پیگیری روزمرهٔ آموزشی و حضور، بدون حذف و تنظیمات",
  viewer: "فقط مشاهدهٔ اطلاعات و گزارش‌ها؛ بدون هیچ تغییری",
};
const PLATFORM_LEVEL_LABELS = {
  owner: "مالک سامانه",
  operator: "اپراتور سامانه",
  auditor: "ناظر سامانه",
};
const PLATFORM_LEVEL_TONES = { owner: "success", operator: "info", auditor: "neutral" };
const PLATFORM_LEVEL_HINTS = {
  owner: "کنترل کامل سامانه، ساخت و تغییر مدیران و همهٔ دانشکده‌ها",
  operator: "مدیریت و ورود به دانشکده‌ها، بدون مدیریت حساب‌های سامانه",
  auditor: "فقط مشاهدهٔ دانشکده‌ها، نشست‌ها و گزارش فعالیت",
};
const PLATFORM_LEVEL_ICONS = {
  owner: "bi-shield-check",
  operator: "bi-sliders",
  auditor: "bi-eye",
};

const faNumber = (value) => Number(value || 0).toLocaleString("fa-IR");
const faDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const faRelative = (value) => {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${faNumber(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNumber(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${faNumber(days)} روز پیش`;
  return faDateTime(value);
};

const AUDIT_ACTION_LABELS = {
  "platform.faculty.create": "ساخت دانشکده",
  "platform.faculty.update": "ویرایش دانشکده",
  "platform.faculty.archive": "آرشیو دانشکده",
  "platform.faculty.admin.create": "ساخت مدیر دانشکده",
  "platform.faculty.admin.update": "تغییر دسترسی مدیر دانشکده",
  "platform.faculty.admin.reset_password": "بازنشانی رمز مدیر دانشکده",
  "platform.impersonation.start": "ورود مدیر سامانه به دانشکده",
  "platform.impersonation.end": "خروج مدیر سامانه از دانشکده",
  "platform.impersonation.revoke": "پایان اجباری نشست ورود",
  "platform.admin.create": "ساخت مدیر سامانه",
  "platform.admin.update": "تغییر دسترسی مدیر سامانه",
  "platform.admin.reset_password": "بازنشانی رمز مدیر سامانه",
  create: "ایجاد",
  update: "ویرایش",
  delete: "حذف",
  publish: "انتشار",
  cancel: "لغو",
  close: "بستن",
  reset_password: "بازنشانی رمز",
  provision_account: "ساخت حساب کاربری",
  provision_accounts: "ساخت حساب‌های کاربری",
  grant_accommodation: "ثبت تسهیلات آموزشی",
  "staff.create": "ساخت کارمند دانشکده",
  "staff.update": "ویرایش کارمند دانشکده",
  "staff.delete": "حذف کارمند دانشکده",
  "staff.reset_password": "بازنشانی رمز کارمند دانشکده",
};
const AUDIT_ACTION_ICONS = {
  create: "bi-plus-circle",
  update: "bi-pencil-square",
  delete: "bi-trash3",
  publish: "bi-send-check",
  cancel: "bi-x-circle",
  close: "bi-lock",
  reset_password: "bi-key",
  provision_account: "bi-person-plus",
  provision_accounts: "bi-people",
  grant_accommodation: "bi-award",
};
const auditActionIcon = (action) => {
  if (action?.startsWith("platform.impersonation")) return "bi-box-arrow-in-left";
  if (action?.startsWith("platform.faculty")) return "bi-buildings";
  if (action?.startsWith("platform.admin")) return "bi-person-gear";
  if (action?.startsWith("staff.")) return "bi-person-badge";
  return AUDIT_ACTION_ICONS[action] || "bi-activity";
};
const AUDIT_ENTITY_LABELS = {
  faculty: "دانشکده",
  organization: "دانشکده",
  platform_admin: "مدیر سامانه",
  admin: "کارمند دانشکده",
  staff: "کارمند دانشکده",
  user: "کاربر",
  student: "دانشجو",
  teacher: "استاد",
  course: "درس",
  session: "جلسهٔ کلاس",
  exam: "آزمون",
  registration: "درخواست ثبت‌نام",
  leave_request: "درخواست مرخصی",
  objection: "اعتراض حضور",
  ticket: "تیکت پشتیبانی",
  attendance: "حضور و غیاب",
  voice_sample: "نمونهٔ صدا",
};
const auditEntityLabel = (value) => AUDIT_ENTITY_LABELS[value] || value || "—";
const AUDIT_ACTION_OPTIONS = Object.entries(AUDIT_ACTION_LABELS).sort((a, b) =>
  a[1].localeCompare(b[1], "fa"),
);

function ModalAlert({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="platform-modal-alert" role="alert">
      <Icon name="bi-exclamation-triangle" />
      <span>{message}</span>
      {onClose && (
        <button type="button" aria-label="بستن پیام" onClick={onClose}>
          <Icon name="bi-x-lg" />
        </button>
      )}
    </div>
  );
}

function useModalBehavior(onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialogRef.current;
    const getFocusable = () =>
      [...(node?.querySelectorAll(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ) || [])].filter((el) => el.offsetParent !== null);
    const focusFirst = () => {
      const list = getFocusable();
      (list[0] || node)?.focus?.();
    };
    focusFirst();
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const list = getFocusable();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);
  return dialogRef;
}

function Modal({ title, eyebrow, onClose, children, wide = false, error }) {
  const dialogRef = useModalBehavior(onClose);
  const titleId = useId();
  return (
    <div
      className="modal-backdrop-custom"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`custom-modal ${wide ? "platform-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h3 id={titleId}>{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="بستن">
            <Icon name="bi-x-lg" />
          </button>
        </div>
        <ModalAlert message={error} />
        {children}
      </section>
    </div>
  );
}

function PasswordInput({ id, name, value, onChange, autoComplete, placeholder, required, defaultValue, minLength }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="platform-password-field">
      <input
        id={id}
        name={name}
        className="form-control"
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        minLength={minLength}
        dir="ltr"
      />
      <button
        type="button"
        className="platform-password-toggle"
        aria-label={visible ? "پنهان کردن رمز" : "نمایش رمز"}
        title={visible ? "پنهان کردن رمز" : "نمایش رمز"}
        onClick={() => setVisible((current) => !current)}
        tabIndex={-1}
      >
        <Icon name={visible ? "bi-eye-slash" : "bi-eye"} />
      </button>
    </div>
  );
}

function CredentialsModal({ title, rows, onClose }) {
  const dialogRef = useModalBehavior(onClose);
  const [copied, setCopied] = useState("");
  const titleId = useId();
  const copy = (row) => {
    const text = `نام کاربری: ${row.username}\nرمز موقت: ${row.temporaryPassword}`;
    if (!navigator.clipboard?.writeText) {
      setCopied("copy-failed");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(row.username))
      .catch(() => setCopied("copy-failed"));
  };
  return (
    <div
      className="modal-backdrop-custom"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="custom-modal credentials-modal platform-print-credentials"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">اعتبارنامهٔ ورود</span>
            <h3 id={titleId}>{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="بستن">
            <Icon name="bi-x-lg" />
          </button>
        </div>
        <p className="credentials-warning">
          <Icon name="bi-shield-exclamation" /> این رمزها فقط همین یک‌بار نمایش داده
          می‌شوند؛ در پایگاه داده تنها نسخهٔ هش‌شده ذخیره شده است.
        </p>
        <div className="credentials-list">
          {rows.map((row, index) => (
            <div className="credentials-row" key={`${row.username}-${index}`}>
              <div className="credentials-who">
                <strong>{row.fullName}</strong>
                <small>{row.note || "در اولین ورود، رمز باید تغییر کند."}</small>
              </div>
              <div className="credentials-values">
                <span>
                  <span className="credentials-label">نام کاربری</span>
                  <code>{row.username}</code>
                </span>
                <span>
                  <span className="credentials-label">رمز موقت</span>
                  <code>{row.temporaryPassword}</code>
                </span>
                <button type="button" className="btn btn-light-outline" onClick={() => copy(row)}>
                  <Icon name={copied === row.username ? "bi-check2" : "bi-clipboard"} />{" "}
                  {copied === row.username ? "کپی شد" : "کپی"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {copied === "copy-failed" && (
          <p className="platform-inline-note is-danger">
            مرورگر اجازهٔ کپی خودکار نداد؛ متن را دستی انتخاب و کپی کنید.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            متوجه شدم
          </button>
          <button type="button" className="btn btn-light" onClick={() => window.print()}>
            <Icon name="bi-printer" /> چاپ
          </button>
        </div>
      </section>
    </div>
  );
}

export function ImpersonationBanner({ impersonation, remainingSeconds, onExit, exiting }) {
  if (!impersonation) return null;
  const minutes = Math.max(0, Math.floor(remainingSeconds / 60));
  const seconds = Math.max(0, remainingSeconds % 60);
  const urgent = remainingSeconds <= 5 * 60;
  return (
    <div className={`impersonation-banner ${urgent ? "is-urgent" : ""}`} role="status">
      <span className="impersonation-icon">
        <Icon name="bi-shield-lock" />
      </span>
      <div className="impersonation-copy">
        <strong>
          شما با دسترسی مدیر در دانشکدهٔ «{impersonation.facultyName}» هستید
        </strong>
        <small>
          همهٔ اقدامات با نام مدیر سامانه ثبت می‌شود · زمان باقی‌مانده:{" "}
          {minutes.toLocaleString("fa-IR")}:
          {String(seconds).padStart(2, "0").replace(/\d/g, (d) =>
            "۰۱۲۳۴۵۶۷۸۹"[Number(d)],
          )}
        </small>
      </div>
      <button
        type="button"
        className="btn btn-light-outline"
        onClick={onExit}
        disabled={exiting}
      >
        <Icon name="bi-box-arrow-right" /> بازگشت به پنل سامانه
      </button>
    </div>
  );
}

export default function PlatformArea({ theme, onToggleTheme, onEnterFaculty, onExitToSite, page: routePage = "overview", onNavigate }) {
  const [token, setToken] = useState(() => getPlatformToken());
  const [sessionUser, setSessionUser] = useState(() => getPlatformUser());
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [passwordChange, setPasswordChange] = useState(null);
  const [page, setPage] = useState(routePage || "overview");
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [faculties, setFaculties] = useState([]);
  const [platformAdmins, setPlatformAdmins] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [activeSessions, setActiveSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [auditItems, setAuditItems] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilters, setAuditFilters] = useState({ organizationId: "", action: "" });
  const [facultyQuery, setFacultyQuery] = useState("");
  const [facultyStatus, setFacultyStatus] = useState("all");
  const [facultySort, setFacultySort] = useState("newest");
  const [facultyPage, setFacultyPage] = useState(1);
  const [mobileNav, setMobileNav] = useState(false);
  const [facultyModal, setFacultyModal] = useState(null);
  const [adminModal, setAdminModal] = useState(null);
  const [enterModal, setEnterModal] = useState(null);
  const [platformAdminModal, setPlatformAdminModal] = useState(null);
  const [accountModal, setAccountModal] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef(null);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // The active page is also part of the URL (#/platform/<page>); keep the
  // local state in step with back/forward navigation.
  useEffect(() => {
    if (routePage && routePage !== page) setPage(routePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePage]);

  const level = sessionUser?.platformLevel || "auditor";
  const canManage = level === "owner" || level === "operator";
  const isOwner = level === "owner";
  const passwordRequired = Boolean(passwordChange) || Boolean(sessionUser?.mustChangePassword);

  function showError(message) {
    const text = message || "عملیات انجام نشد.";
    const modalOpen = Boolean(
      facultyModal || adminModal || enterModal || platformAdminModal || accountModal || confirmState,
    );
    if (modalOpen) setModalError(text);
    else setError(text);
  }

  function openModal(setter, value) {
    setModalError("");
    setter(value);
  }

  function closeModal(setter) {
    setModalError("");
    setter(null);
  }

  const reloadFaculties = useCallback(async () => {
    const data = await fetchPlatformFaculties();
    setFaculties(data?.faculties || []);
  }, []);
  const reloadOverview = useCallback(async () => {
    const data = await fetchPlatformOverview();
    setOverview(data);
  }, []);
  const reloadAdmins = useCallback(async () => {
    setAdminLoading(true);
    try {
      const data = await fetchPlatformAdmins();
      setPlatformAdmins(data?.admins || []);
    } finally {
      setAdminLoading(false);
    }
  }, []);
  const reloadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const { sessions } = await fetchPlatformImpersonations();
      setActiveSessions(sessions || []);
    } catch {
      setActiveSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);
  const loadAudit = useCallback(async (filters, pageNumber = 1) => {
    setAuditLoading(true);
    try {
      const data = await fetchPlatformAudit({
        ...filters,
        limit: 20,
        offset: (pageNumber - 1) * 20,
      });
      setAuditItems(data?.items || []);
      setAuditTotal(Number(data?.total) || 0);
      setAuditPage(pageNumber);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [overviewData, facultiesData, sessionsData] = await Promise.all([
        fetchPlatformOverview(),
        fetchPlatformFaculties(),
        fetchPlatformImpersonations().catch(() => ({ sessions: [] })),
      ]);
      setOverview(overviewData);
      setFaculties(facultiesData?.faculties || []);
      setActiveSessions(sessionsData?.sessions || []);
    } catch (loadError) {
      setError(loadError.message || "دریافت اطلاعات پنل سامانه انجام نشد.");
    } finally {
      setLoading(false);
      setSessionsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token && sessionUser && !sessionUser.mustChangePassword) refreshAll();
  }, [token, sessionUser, refreshAll]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.mustChangePassword) return;
    if (page === "admins") reloadAdmins().catch((e) => setError(e.message));
    if (page === "audit") {
      setAuditPage(1);
      loadAudit(auditFilters, 1).catch((e) => setError(e.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, token, sessionUser]);

  // A stale platform token should return the user to the sign-in screen instead
  // of leaving an empty panel behind.
  useEffect(() => {
    const handleUnauthorized = () => {
      clearPlatformSession();
      setToken("");
      setSessionUser(null);
      setOverview(null);
      setFaculties([]);
      setActiveSessions([]);
      setLoginError("نشست شما منقضی شده است؛ دوباره وارد شوید.");
    };
    window.addEventListener("platform:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("platform:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    setFacultyPage(1);
  }, [facultyQuery, facultyStatus, facultySort]);

  async function submitLogin(event) {
    event.preventDefault();
    setLoginError("");
    setLoginPending(true);
    try {
      const result = await platformSignIn(loginName.trim(), loginPassword);
      setToken(result.token);
      setSessionUser(result.user);
      setLoginPassword("");
      if (result.user?.mustChangePassword) {
        setPasswordChange({ currentPassword: loginPassword, forced: true });
      }
    } catch (loginFailure) {
      setLoginError(loginFailure.message || "ورود به پنل سامانه انجام نشد.");
    } finally {
      setLoginPending(false);
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirm = String(form.get("confirmPassword") || "");
    if (!currentPassword) {
      setError("رمز عبور فعلی را وارد کنید.");
      return;
    }
    if (newPassword.length < 8) {
      setError("رمز عبور جدید باید حداقل ۸ کاراکتر باشد.");
      return;
    }
    if (newPassword !== confirm) {
      setError("تکرار رمز عبور جدید مطابقت ندارد.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await platformChangePassword(currentPassword, newPassword);
      const next = { ...sessionUser, mustChangePassword: false };
      setSessionUser(next);
      if (token) setPlatformSession(token, next);
      setPasswordChange(null);
      notify("رمز عبور سامانه تغییر کرد.");
    } catch (changeError) {
      setError(changeError.message || "تغییر رمز عبور انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  const logout = () => {
    clearPlatformSession();
    setToken("");
    setSessionUser(null);
    setOverview(null);
    setFaculties([]);
    setActiveSessions([]);
    setPage("overview");
    onNavigate?.("overview");
    setMobileNav(false);
    setConfirmState(null);
    setAccountModal(false);
  };

  function goTo(nextPage) {
    setPage(nextPage);
    onNavigate?.(nextPage);
    setMobileNav(false);
    setError("");
  }

  function requestConfirm(options) {
    setModalError("");
    setConfirmState(options);
  }

  async function runConfirm() {
    if (!confirmState) return;
    setConfirmBusy(true);
    setModalError("");
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch (confirmError) {
      setModalError(confirmError.message || confirmState.errorMessage || "عملیات انجام نشد.");
    } finally {
      setConfirmBusy(false);
    }
  }

  async function saveFaculty(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true);
    setModalError("");
    try {
      if (facultyModal?.mode === "edit") {
        await updatePlatformFaculty(facultyModal.faculty.id, {
          name: values.name,
          code: values.code,
          contactName: values.contactName,
          contactEmail: values.contactEmail,
          contactPhone: values.contactPhone,
        });
        setFacultyModal(null);
        notify("اطلاعات دانشکده به‌روزرسانی شد.");
        await Promise.all([reloadFaculties(), reloadOverview()]);
      } else {
        const result = await createPlatformFaculty({
          name: values.name,
          code: values.code,
          contactName: values.contactName,
          contactEmail: values.contactEmail,
          contactPhone: values.contactPhone,
          adminFullName: values.adminFullName,
          adminEmail: values.adminEmail,
          adminLevel: values.adminLevel,
        });
        setFacultyModal(null);
        setCredentials({
          title: `دانشکدهٔ «${result.faculty?.name || values.name}» ساخته شد`,
          rows: [
            {
              fullName: result.admin?.fullName || values.adminFullName,
              username: result.account?.username,
              temporaryPassword: result.account?.temporaryPassword,
              note: "مدیر دانشکده؛ رمز باید در اولین ورود تغییر کند.",
            },
          ],
        });
        await refreshAll();
      }
    } catch (saveError) {
      showError(saveError.message || "ذخیرهٔ دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  function archiveFaculty(faculty) {
    requestConfirm({
      title: `آرشیو «${faculty.name}»`,
      message:
        "با آرشیو شدن این دانشکده، ورود همهٔ کاربران آن بسته می‌شود و دانشکده از فهرست فعال خارج می‌شود. بعداً می‌توانید آن را دوباره فعال کنید.",
      confirmLabel: "آرشیو دانشکده",
      tone: "danger",
      onConfirm: async () => {
        await archivePlatformFaculty(faculty.id);
        notify("دانشکده آرشیو شد.");
        await Promise.all([reloadFaculties(), reloadOverview()]);
      },
    });
  }

  async function restoreFaculty(faculty) {
    setBusy(true);
    try {
      await updatePlatformFaculty(faculty.id, { isActive: true });
      notify("دانشکده دوباره فعال شد.");
      await Promise.all([reloadFaculties(), reloadOverview()]);
    } catch (restoreError) {
      showError(restoreError.message || "فعال‌سازی دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function openAdmins(faculty) {
    setBusy(true);
    setError("");
    setModalError("");
    try {
      const data = await fetchPlatformFaculty(faculty.id);
      setAdminModal({ faculty: data.faculty, admins: data.admins || [], mode: "list" });
    } catch (loadError) {
      setError(loadError.message || "دریافت مدیران دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function addFacultyAdmin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true);
    setModalError("");
    try {
      const result = await createFacultyAdmin(adminModal.faculty.id, {
        fullName: values.fullName,
        email: values.email,
        level: values.level,
      });
      setCredentials({
        title: "کارمند جدید دانشکده",
        rows: [
          {
            fullName: result.admin?.fullName,
            username: result.account?.username,
            temporaryPassword: result.account?.temporaryPassword,
            note: `سطح دسترسی: ${FACULTY_LEVEL_LABELS[result.admin?.level] || result.admin?.level}`,
          },
        ],
      });
      event.currentTarget.reset();
      await openAdmins(adminModal.faculty);
      await reloadFaculties();
    } catch (createError) {
      showError(createError.message || "ساخت کارمند دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function changeFacultyAdmin(admin, patch) {
    setBusy(true);
    setModalError("");
    try {
      await updateFacultyAdmin(adminModal.faculty.id, admin.id, patch);
      notify("سطح دسترسی به‌روزرسانی شد.");
      await openAdmins(adminModal.faculty);
      await reloadFaculties();
    } catch (updateError) {
      showError(updateError.message || "تغییر دسترسی انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  function resetFacultyAdmin(admin) {
    requestConfirm({
      title: "بازنشانی رمز کارمند دانشکده",
      message: `برای «${admin.fullName}» یک رمز موقت جدید ساخته می‌شود و باید در اولین ورود آن را تغییر دهد.`,
      confirmLabel: "ساخت رمز موقت",
      onConfirm: async () => {
        const result = await resetFacultyAdminPassword(adminModal.faculty.id, admin.id);
        setCredentials({
          title: "رمز موقت جدید کارمند دانشکده",
          rows: [
            {
              fullName: admin.fullName,
              username: result.username,
              temporaryPassword: result.temporaryPassword,
              note: "رمز باید در اولین ورود تغییر کند.",
            },
          ],
        });
      },
    });
  }

  async function enterSelectedFaculty(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (reason.length < 5) {
      setModalError("دلیل ورود را کامل‌تر بنویسید (حداقل ۵ کاراکتر).");
      return;
    }
    setBusy(true);
    setModalError("");
    try {
      const result = await enterFaculty(enterModal.id, reason);
      setEnterModal(null);
      onEnterFaculty?.(result);
    } catch (enterError) {
      showError(enterError.message || "ورود به دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function addPlatformAdmin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true);
    setModalError("");
    try {
      const result = await createPlatformAdmin({
        fullName: values.fullName,
        email: values.email,
        level: values.level,
      });
      setCredentials({
        title: "مدیر جدید سامانه",
        rows: [
          {
            fullName: result.admin?.fullName,
            username: result.account?.username,
            temporaryPassword: result.account?.temporaryPassword,
            note: `سطح دسترسی: ${PLATFORM_LEVEL_LABELS[result.admin?.level] || result.admin?.level}`,
          },
        ],
      });
      event.currentTarget.reset();
      setPlatformAdminModal(null);
      await reloadAdmins();
    } catch (createError) {
      showError(createError.message || "ساخت مدیر سامانه انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function changePlatformAdmin(admin, patch) {
    setBusy(true);
    try {
      await updatePlatformAdmin(admin.id, patch);
      notify("دسترسی مدیر سامانه به‌روزرسانی شد.");
      await reloadAdmins();
    } catch (updateError) {
      setError(updateError.message || "تغییر دسترسی انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  function resetPlatformAdmin(admin) {
    requestConfirm({
      title: "بازنشانی رمز مدیر سامانه",
      message: `برای «${admin.fullName}» یک رمز موقت جدید ساخته می‌شود و باید در اولین ورود آن را تغییر دهد.`,
      confirmLabel: "ساخت رمز موقت",
      onConfirm: async () => {
        const result = await resetPlatformAdminPassword(admin.id);
        setCredentials({
          title: "رمز موقت جدید مدیر سامانه",
          rows: [
            {
              fullName: admin.fullName,
              username: result.username,
              temporaryPassword: result.temporaryPassword,
              note: "رمز باید در اولین ورود تغییر کند.",
            },
          ],
        });
      },
    });
  }

  function endSession(session) {
    requestConfirm({
      title: "پایان نشست ورود",
      message: `نشست «${session.platformName}» در دانشکدهٔ «${session.facultyName}» پایان یابد؟`,
      confirmLabel: "پایان نشست",
      tone: "danger",
      onConfirm: async () => {
        await revokeImpersonation(session.id);
        notify("نشست پایان یافت.");
        await reloadSessions();
      },
    });
  }

  async function submitAccountPassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirm = String(form.get("confirmPassword") || "");
    if (newPassword.length < 8) {
      setModalError("رمز عبور جدید باید حداقل ۸ کاراکتر باشد.");
      return;
    }
    if (newPassword !== confirm) {
      setModalError("تکرار رمز عبور جدید مطابقت ندارد.");
      return;
    }
    setBusy(true);
    setModalError("");
    try {
      await platformChangePassword(currentPassword, newPassword);
      const next = { ...sessionUser, mustChangePassword: false };
      setSessionUser(next);
      if (token) setPlatformSession(token, next);
      setAccountModal(false);
      notify("رمز عبور شما تغییر کرد.");
    } catch (changeError) {
      showError(changeError.message || "تغییر رمز عبور انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function exportAuditCsv() {
    setBusy(true);
    setError("");
    try {
      const data = await fetchPlatformAudit({ ...auditFilters, limit: 200, offset: 0 });
      const items = data?.items || [];
      if (!items.length) {
        notify("موردی برای خروجی وجود ندارد.", "error");
        return;
      }
      const rows = [
        ["تاریخ", "دانشکده", "کاربر", "اقدام", "نوع موجودیت", "شناسه"],
        ...items.map((item) => [
          faDateTime(item.createdAt),
          item.organizationName,
          item.actorName || "—",
          AUDIT_ACTION_LABELS[item.action] || item.action,
          auditEntityLabel(item.entityType),
          item.entityId || "",
        ]),
      ];
      const csv =
        "\ufeff" +
        rows
          .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
          .join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "platform-audit.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      notify(
        items.length < Number(data?.total || 0)
          ? "خروجی CSV ساخته شد؛ برای حفظ سرعت، حداکثر ۲۰۰ ردیف اول صادر شد."
          : "خروجی CSV ساخته شد.",
      );
    } catch (exportError) {
      setError(exportError.message || "ساخت خروجی CSV انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  const filteredFaculties = useMemo(() => {
    const query = facultyQuery.trim().toLocaleLowerCase("fa-IR");
    const list = faculties.filter((faculty) => {
      if (facultyStatus === "active" && !faculty.isActive) return false;
      if (facultyStatus === "archived" && faculty.isActive) return false;
      if (!query) return true;
      return [faculty.name, faculty.code, faculty.managerName, faculty.contactName, faculty.contactEmail]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("fa-IR").includes(query));
    });
    const sorted = [...list];
    if (facultySort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "fa"));
    else if (facultySort === "students") sorted.sort((a, b) => Number(b.students || 0) - Number(a.students || 0));
    else if (facultySort === "lastActivity")
      sorted.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
    else sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return sorted;
  }, [faculties, facultyQuery, facultyStatus, facultySort]);

  const facultyPageCount = Math.max(1, Math.ceil(filteredFaculties.length / 10));
  const facultyPageSafe = Math.min(facultyPage, facultyPageCount);
  const visibleFaculties = filteredFaculties.slice(
    (facultyPageSafe - 1) * 10,
    facultyPageSafe * 10,
  );

  const currentFacultyStats = useMemo(() => {
    const totals = { faculties: 0, active: 0, students: 0, teachers: 0 };
    faculties.forEach((faculty) => {
      totals.faculties += 1;
      if (faculty.isActive) totals.active += 1;
      totals.students += Number(faculty.students || 0);
      totals.teachers += Number(faculty.teachers || 0);
    });
    return totals;
  }, [faculties]);

  /* ------------------------------- login ------------------------------- */

  const loginHero = (
    <aside className="platform-login-hero" aria-hidden="true">
      <div className="platform-login-hero-brand">
        <span className="brand-mark">
          <Icon name="bi-buildings" />
        </span>
        <div>
          <strong>حضوربان</strong>
          <small>مرکز کنترل سامانه</small>
        </div>
      </div>
      <h2>یک نقطهٔ کنترل برای همهٔ دانشکده‌ها</h2>
      <p>
        دانشکده‌ها، کارکنان، مدیران و گزارش فعالیت سامانه را از یک پنل امن مدیریت
        کنید.
      </p>
      <ul className="platform-login-points">
        <li>
          <span><Icon name="bi-buildings" /></span>
          ساخت و مدیریت دانشکده‌ها و کارکنان آن‌ها
        </li>
        <li>
          <span><Icon name="bi-box-arrow-in-left" /></span>
          ورود کنترل‌شده و زمان‌دار به هر دانشکده
        </li>
        <li>
          <span><Icon name="bi-clock-history" /></span>
          گزارش کامل و قابل پیگیری همهٔ اقدامات
        </li>
      </ul>
      <div className="platform-login-hero-foot">
        <span className="status-badge success">اتصال امن</span>
        <small>هر ورود و اقدام مدیریتی در گزارش فعالیت ثبت می‌شود.</small>
      </div>
    </aside>
  );

  if (!token || !sessionUser) {
    return (
      <div className="platform-login-screen">
        <button
          className="icon-button theme-toggle login-theme-toggle"
          type="button"
          aria-label="تغییر تم"
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
        </button>
        <div className="platform-login-layout">
          {loginHero}
          <form className="platform-login-card" onSubmit={submitLogin}>
            <div className="platform-brand">
              <span className="brand-mark">
                <Icon name="bi-buildings" />
              </span>
              <div>
                <strong>حضوربان</strong>
                <small>پنل مدیریت سامانه</small>
              </div>
            </div>
            <h1>ورود مدیر سامانه</h1>
            <p>
              این بخش فقط برای مدیران سامانه است و به همهٔ دانشکده‌ها دسترسی مدیریتی
              می‌دهد.
            </p>
            <label className="form-label" htmlFor="platform-username">
              ایمیل مدیر سامانه
            </label>
            <div className="input-icon-wrap">
              <Icon name="bi-envelope" />
              <input
                id="platform-username"
                className="form-control"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                type="email"
                autoComplete="username"
                placeholder="platform@example.com"
                dir="ltr"
                required
              />
            </div>
            <label className="form-label mt-3" htmlFor="platform-password">
              رمز عبور
            </label>
            <PasswordInput
              id="platform-password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="رمز عبور خود را وارد کنید"
              required
            />
            {loginError && (
              <p className="login-error" role="alert">
                <Icon name="bi-exclamation-circle" />
                <span>{loginError}</span>
              </p>
            )}
            <button className="btn btn-primary w-100" type="submit" disabled={loginPending}>
              {loginPending ? "در حال ورود…" : "ورود به پنل سامانه"}
              <Icon name="bi-arrow-left-short" />
            </button>
            <div className="platform-login-meta">
              <span><Icon name="bi-shield-lock" /> نشست ۸ ساعته</span>
              <span><Icon name="bi-journal-text" /> ثبت در گزارش فعالیت</span>
            </div>
            <button
              type="button"
              className="login-home-link"
              onClick={() => {
                window.location.hash = "#/login";
                onExitToSite?.();
              }}
            >
              <Icon name="bi-arrow-right" /> بازگشت به ورود دانشکده‌ها
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="platform-login-screen">
        <button
          className="icon-button theme-toggle login-theme-toggle"
          type="button"
          aria-label="تغییر تم"
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
        </button>
        <div className="platform-login-layout">
          {loginHero}
          <form className="platform-login-card" onSubmit={submitPasswordChange}>
            <div className="platform-brand">
              <span className="brand-mark">
                <Icon name="bi-shield-lock" />
              </span>
              <div>
                <strong>حضوربان</strong>
                <small>پنل مدیریت سامانه</small>
              </div>
            </div>
            <span className="eyebrow">ورود اولیه</span>
            <h1>تعیین رمز عبور جدید</h1>
            <p>
              برای ادامهٔ کار در پنل سامانه، رمز موقت خود را تغییر دهید. تا تکمیل این
              مرحله، سایر بخش‌های پنل در دسترس نیست.
            </p>
            <label className="form-label" htmlFor="pc-current">
              رمز موقت
            </label>
            <PasswordInput
              id="pc-current"
              name="currentPassword"
              autoComplete="current-password"
              defaultValue={passwordChange?.currentPassword || ""}
              placeholder="رمز موقتی که دریافت کرده‌اید"
              required
            />
            <label className="form-label mt-3" htmlFor="pc-new">
              رمز عبور جدید
            </label>
            <PasswordInput
              id="pc-new"
              name="newPassword"
              autoComplete="new-password"
              placeholder="حداقل ۸ کاراکتر"
              minLength={8}
              required
            />
            <label className="form-label mt-3" htmlFor="pc-confirm">
              تکرار رمز عبور جدید
            </label>
            <PasswordInput
              id="pc-confirm"
              name="confirmPassword"
              autoComplete="new-password"
              placeholder="تکرار رمز جدید"
              minLength={8}
              required
            />
            {error && (
              <p className="login-error" role="alert">
                <Icon name="bi-exclamation-circle" />
                <span>{error}</span>
              </p>
            )}
            <button className="btn btn-primary w-100" type="submit" disabled={busy}>
              {busy ? "در حال ذخیره…" : "ذخیرهٔ رمز و ادامه"}
            </button>
            <button type="button" className="login-home-link" onClick={logout}>
              <Icon name="bi-box-arrow-right" /> خروج از حساب
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* -------------------------------- shell -------------------------------- */

  const navItems = [
    { id: "overview", label: "داشبورد سامانه", icon: "bi-grid-1x2" },
    { id: "faculties", label: "دانشکده‌ها", icon: "bi-buildings" },
    { id: "admins", label: "مدیران سامانه", icon: "bi-person-gear" },
    { id: "audit", label: "گزارش فعالیت", icon: "bi-clock-history" },
  ];

  return (
    <div className="app-shell platform-shell">
      {mobileNav && (
        <button
          className="mobile-overlay"
          aria-label="بستن منو"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark platform-brand-mark">
            <Icon name="bi-buildings" />
          </span>
          <div>
            <strong>پنل سامانه</strong>
            <small>مدیریت دانشکده‌ها</small>
          </div>
          <button
            type="button"
            className="sidebar-close"
            aria-label="بستن منو"
            onClick={() => setMobileNav(false)}
          >
            <Icon name="bi-x-lg" />
          </button>
        </div>
        <nav className="side-nav">
          <div className="nav-group">
            <div className="nav-group-title">مدیریت سامانه</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-link-custom ${page === item.id ? "active" : ""}`}
                onClick={() => goTo(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="platform-user-card">
            <span className="avatar">{(sessionUser.name || "م").charAt(0)}</span>
            <div>
              <strong>{sessionUser.name || "مدیر سامانه"}</strong>
              <small>{PLATFORM_LEVEL_LABELS[level] || level}</small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-light-outline w-100 platform-account-btn"
            onClick={() => {
              setModalError("");
              setAccountModal(true);
              setMobileNav(false);
            }}
          >
            <Icon name="bi-person-circle" /> حساب من
          </button>
          <button type="button" className="btn btn-light w-100" onClick={logout}>
            <Icon name="bi-box-arrow-right" /> خروج از پنل سامانه
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-right">
            <button
              type="button"
              className="mobile-menu-btn"
              aria-label="باز کردن منو"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(true)}
            >
              <Icon name="bi-list" />
            </button>
            <div className="breadcrumb-text">
              <span>پنل سامانه</span>
              <Icon name="bi-chevron-left" />
              <strong>{navItems.find((item) => item.id === page)?.label}</strong>
            </div>
          </div>
          <div className="topbar-left">
            <span className={`status-badge ${PLATFORM_LEVEL_TONES[level] || "neutral"}`}>
              {PLATFORM_LEVEL_LABELS[level] || level}
            </span>
            <button
              className="icon-button theme-toggle"
              type="button"
              aria-label="تغییر تم"
              onClick={onToggleTheme}
            >
              <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
            </button>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="storage-warning platform-alert" role="alert">
              <Icon name="bi-exclamation-triangle" />
              <span>{error}</span>
              <button type="button" aria-label="بستن" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}

          {page === "overview" && (
            <>
              <section className="platform-hero">
                <div className="platform-hero-copy">
                  <span className="eyebrow">مرکز کنترل سامانه</span>
                  <h1>سلام، {sessionUser.name || "مدیر سامانه"}</h1>
                  <p>
                    وضعیت دانشکده‌ها، نشست‌های فعال و فعالیت‌های مدیریتی سامانه را از
                    اینجا پیگیری کنید.
                  </p>
                  <div className="platform-hero-chips">
                    <span className="status-badge success">
                      <Icon name="bi-buildings" />{" "}
                      {faNumber(overview?.stats?.activeFaculties ?? currentFacultyStats.active)} دانشکدهٔ فعال
                    </span>
                    <span className="status-badge info">
                      <Icon name="bi-people" />{" "}
                      {faNumber(overview?.stats?.students ?? currentFacultyStats.students)} دانشجو
                    </span>
                    <span className="status-badge purple">
                      <Icon name="bi-shield-lock" />{" "}
                      {faNumber(activeSessions.length)} نشست فعال
                    </span>
                  </div>
                </div>
                {canManage && (
                  <div className="platform-hero-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openModal(setFacultyModal, { mode: "create" })}
                    >
                      <Icon name="bi-plus-lg" /> دانشکدهٔ جدید
                    </button>
                    <button
                      type="button"
                      className="btn btn-light-outline"
                      onClick={() => goTo("faculties")}
                    >
                      <Icon name="bi-buildings" /> مدیریت دانشکده‌ها
                    </button>
                  </div>
                )}
              </section>

              <div className="stat-grid">
                <StatCard
                  icon="bi-buildings"
                  label="دانشکده‌ها"
                  value={faNumber(overview?.stats?.faculties ?? currentFacultyStats.faculties)}
                  detail={`${faNumber(overview?.stats?.activeFaculties ?? currentFacultyStats.active)} فعال`}
                  color="blue"
                />
                <StatCard
                  icon="bi-people"
                  label="دانشجویان"
                  value={faNumber(overview?.stats?.students ?? currentFacultyStats.students)}
                  detail="در همهٔ دانشکده‌ها"
                  color="green"
                />
                <StatCard
                  icon="bi-person-video3"
                  label="استادان"
                  value={faNumber(overview?.stats?.teachers ?? currentFacultyStats.teachers)}
                  detail="فعال"
                  color="amber"
                />
                <StatCard
                  icon="bi-person-badge"
                  label="کارکنان دانشکده"
                  value={faNumber(overview?.stats?.facultyAdmins)}
                  detail="مدیر و کارمند فعال"
                  color="rose"
                />
                <StatCard
                  icon="bi-journal-bookmark"
                  label="درس‌ها"
                  value={faNumber(overview?.stats?.courses)}
                  detail="در همهٔ دانشکده‌ها"
                  color="purple"
                />
                <StatCard
                  icon="bi-clipboard-check"
                  label="آزمون‌ها"
                  value={faNumber(overview?.stats?.exams)}
                  detail="ثبت‌شده"
                  color="orange"
                />
              </div>

              <section className="content-card platform-section" style={{ marginTop: 16 }}>
                <div className="panel-title-inline" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>دانشکده‌ها</h3>
                    <small className="platform-section-hint">
                      {faNumber(faculties.length)} دانشکده در سامانه
                    </small>
                  </div>
                  <button type="button" className="btn btn-light-outline" onClick={() => goTo("faculties")}>
                    همهٔ دانشکده‌ها <Icon name="bi-arrow-left" />
                  </button>
                </div>
                {loading ? (
                  <SkeletonTable rows={3} columns={5} />
                ) : faculties.length === 0 ? (
                  <EmptyState
                    icon="bi-buildings"
                    title="هنوز دانشکده‌ای ساخته نشده"
                    text="با دکمهٔ «دانشکدهٔ جدید» اولین دانشکده و مدیر آن را بسازید."
                  />
                ) : (
                  <div className="platform-faculty-mini-grid">
                    {faculties.slice(0, 4).map((faculty) => (
                      <button
                        key={faculty.id}
                        type="button"
                        className="platform-faculty-mini"
                        onClick={() =>
                          canManage ? openAdmins(faculty) : goTo("faculties")
                        }
                        title={canManage ? `مدیران ${faculty.name}` : faculty.name}
                      >
                        <span className="platform-faculty-icon">
                          <Icon name="bi-mortarboard" />
                        </span>
                        <span>
                          <strong>{faculty.name}</strong>
                          <small>
                            {faculty.managerName ? `${faculty.managerName} · ` : ""}
                            {faNumber(faculty.students)} دانشجو · {faNumber(faculty.courses)} درس
                          </small>
                        </span>
                        <span className={`status-badge ${faculty.isActive ? "success" : "neutral"}`}>
                          {faculty.isActive ? "فعال" : "آرشیو"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="content-card platform-section" style={{ marginTop: 16 }}>
                <div className="panel-title-inline" style={{ marginBottom: 8 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>فعالیت اخیر</h3>
                    <small className="platform-section-hint">آخرین اقدامات مدیریتی ثبت‌شده</small>
                  </div>
                  <button type="button" className="btn btn-light-outline" onClick={() => goTo("audit")}>
                    گزارش کامل <Icon name="bi-arrow-left" />
                  </button>
                </div>
                {(overview?.recentActivity || []).length === 0 ? (
                  <EmptyState icon="bi-clock-history" title="فعالیتی ثبت نشده" text="اقدامات مدیریتی در این بخش دیده می‌شوند." />
                ) : (
                  <ul className="platform-activity-list">
                    {overview.recentActivity.map((item) => (
                      <li key={item.id}>
                        <span className="platform-activity-dot">
                          <Icon name={auditActionIcon(item.action)} />
                        </span>
                        <div>
                          <strong>{AUDIT_ACTION_LABELS[item.action] || item.action}</strong>
                          <small>
                            {item.organizationName} · {item.actorName || "سامانه"} · {faRelative(item.createdAt)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="content-card platform-section" style={{ marginTop: 16 }}>
                <div className="panel-title-inline" style={{ marginBottom: 8 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>نشست‌های فعال ورود به دانشکده</h3>
                    <small className="platform-section-hint">
                      ورودهای زمان‌دار مدیران سامانه به دانشکده‌ها
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn btn-light-outline"
                    onClick={() => reloadSessions().catch(() => {})}
                    disabled={sessionsLoading}
                  >
                    <Icon name="bi-arrow-clockwise" /> به‌روزرسانی
                  </button>
                </div>
                {sessionsLoading ? (
                  <SkeletonTable rows={2} columns={5} />
                ) : activeSessions.length === 0 ? (
                  <EmptyState
                    icon="bi-shield-check"
                    title="نشست فعالی وجود ندارد"
                    text="وقتی مدیری از پنل سامانه وارد دانشکده شود، نشست او اینجا نمایش داده می‌شود."
                  />
                ) : (
                  <div className="table-responsive">
                    <table className="table custom-table align-middle">
                      <thead>
                        <tr>
                          <th scope="col">دانشکده</th>
                          <th scope="col">مدیر سامانه</th>
                          <th scope="col">شروع</th>
                          <th scope="col">پایان</th>
                          <th scope="col" />
                        </tr>
                      </thead>
                      <tbody>
                        {activeSessions.map((session) => (
                          <tr key={session.id}>
                            <td>{session.facultyName}</td>
                            <td>{session.platformName}</td>
                            <td>{faDateTime(session.startedAt)}</td>
                            <td>{faDateTime(session.expiresAt)}</td>
                            <td>
                              {canManage && (
                                <button
                                  type="button"
                                  className="btn btn-light-outline btn-compact"
                                  onClick={() => endSession(session)}
                                >
                                  پایان نشست
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {page === "faculties" && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">مدیریت دانشکده‌ها</div>
                  <h1>دانشکده‌ها</h1>
                  <p>ساخت، ویرایش، ورود و آرشیو دانشکده‌ها و کارکنان آن‌ها.</p>
                </div>
                {canManage && (
                  <div className="welcome-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openModal(setFacultyModal, { mode: "create" })}
                    >
                      <Icon name="bi-plus-lg" /> دانشکدهٔ جدید
                    </button>
                  </div>
                )}
              </div>

              <section className="content-card platform-toolbar-card">
                <div className="platform-toolbar">
                  <div className="platform-search">
                    <Icon name="bi-search" />
                    <input
                      className="form-control"
                      type="search"
                      value={facultyQuery}
                      onChange={(event) => setFacultyQuery(event.target.value)}
                      placeholder="جست‌وجو در نام، کد یا مدیر دانشکده…"
                      aria-label="جست‌وجوی دانشکده"
                    />
                    {facultyQuery && (
                      <button
                        type="button"
                        className="platform-search-clear"
                        aria-label="پاک کردن جست‌وجو"
                        onClick={() => setFacultyQuery("")}
                      >
                        <Icon name="bi-x-lg" />
                      </button>
                    )}
                  </div>
                  <Select
                    className="form-select platform-toolbar-select"
                    value={facultyStatus}
                    onChange={(event) => setFacultyStatus(event.target.value)}
                    aria-label="فیلتر وضعیت دانشکده"
                  >
                    <option value="all">همهٔ وضعیت‌ها</option>
                    <option value="active">فقط فعال</option>
                    <option value="archived">فقط آرشیو</option>
                  </Select>
                  <Select
                    className="form-select platform-toolbar-select"
                    value={facultySort}
                    onChange={(event) => setFacultySort(event.target.value)}
                    aria-label="مرتب‌سازی دانشکده‌ها"
                  >
                    <option value="newest">تازه‌ترین</option>
                    <option value="name">نام (الفبا)</option>
                    <option value="students">بیشترین دانشجو</option>
                    <option value="lastActivity">آخرین فعالیت</option>
                  </Select>
                  <span className="platform-result-count">
                    {faNumber(filteredFaculties.length)} دانشکده
                  </span>
                </div>
              </section>

              <section className="content-card data-card">
                {loading ? (
                  <SkeletonTable rows={5} columns={6} />
                ) : faculties.length === 0 ? (
                  <EmptyState icon="bi-buildings" title="دانشکده‌ای وجود ندارد" text="اولین دانشکده را بسازید." />
                ) : filteredFaculties.length === 0 ? (
                  <div className="platform-empty-filter">
                    <EmptyState
                      icon="bi-search"
                      title="نتیجه‌ای پیدا نشد"
                      text="عبارت جست‌وجو یا فیلتر وضعیت را تغییر دهید."
                    />
                    <button
                      type="button"
                      className="btn btn-light-outline"
                      onClick={() => {
                        setFacultyQuery("");
                        setFacultyStatus("all");
                      }}
                    >
                      پاک کردن فیلترها
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="table-responsive">
                      <table className="table custom-table align-middle">
                        <thead>
                          <tr>
                            <th scope="col">دانشکده</th>
                            <th scope="col">مدیر دانشکده</th>
                            <th scope="col">وضعیت</th>
                            <th scope="col">آمار</th>
                            <th scope="col">آخرین فعالیت</th>
                            <th scope="col">عملیات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleFaculties.map((faculty) => (
                            <tr key={faculty.id}>
                              <td>
                                <strong>{faculty.name}</strong>
                                <div className="platform-muted">
                                  <code>{faculty.code}</code>
                                  {faculty.contactName || faculty.contactEmail
                                    ? ` · ${faculty.contactName || faculty.contactEmail}`
                                    : ""}
                                </div>
                              </td>
                              <td>
                                {faculty.managerName || "—"}
                                <div className="platform-muted">
                                  {faNumber(faculty.admins)} کارمند فعال
                                </div>
                              </td>
                              <td>
                                <span className={`status-badge ${faculty.isActive ? "success" : "neutral"}`}>
                                  {faculty.isActive ? "فعال" : "آرشیو"}
                                </span>
                              </td>
                              <td>
                                <div className="platform-stat-chips">
                                  <span title="دانشجو"><Icon name="bi-people" /> {faNumber(faculty.students)}</span>
                                  <span title="استاد"><Icon name="bi-person-video3" /> {faNumber(faculty.teachers)}</span>
                                  <span title="درس"><Icon name="bi-journal-bookmark" /> {faNumber(faculty.courses)}</span>
                                </div>
                              </td>
                              <td>{faRelative(faculty.lastActivity)}</td>
                              <td>
                                <div className="table-actions">
                                  {canManage && faculty.isActive && (
                                    <button
                                      type="button"
                                      className="btn btn-light-outline btn-compact"
                                      title="ورود به دانشکده"
                                      onClick={() => openModal(setEnterModal, { id: faculty.id, name: faculty.name })}
                                    >
                                      <Icon name="bi-box-arrow-in-left" /> ورود
                                    </button>
                                  )}
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="btn btn-light-outline btn-compact"
                                      title="کارکنان دانشکده"
                                      onClick={() => openAdmins(faculty)}
                                    >
                                      <Icon name="bi-people" /> کارکنان
                                    </button>
                                  )}
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      title="ویرایش دانشکده"
                                      aria-label={`ویرایش ${faculty.name}`}
                                      onClick={() => openModal(setFacultyModal, { mode: "edit", faculty })}
                                    >
                                      <Icon name="bi-pencil" />
                                    </button>
                                  )}
                                  {canManage &&
                                    (faculty.isActive ? (
                                      <button
                                        type="button"
                                        className="icon-btn danger"
                                        title="آرشیو دانشکده"
                                        aria-label={`آرشیو ${faculty.name}`}
                                        onClick={() => archiveFaculty(faculty)}
                                      >
                                        <Icon name="bi-archive" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="icon-btn"
                                        title="فعال‌سازی دانشکده"
                                        aria-label={`فعال‌سازی ${faculty.name}`}
                                        onClick={() => restoreFaculty(faculty)}
                                      >
                                        <Icon name="bi-arrow-counterclockwise" />
                                      </button>
                                    ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <TablePager
                      page={facultyPageSafe}
                      pageSize={10}
                      total={filteredFaculties.length}
                      onPageChange={setFacultyPage}
                      label="دانشکده"
                    />
                  </>
                )}
              </section>
            </>
          )}

          {page === "admins" && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">دسترسی سامانه</div>
                  <h1>مدیران سامانه</h1>
                  <p>مالک، اپراتور و ناظر سامانه؛ هر سطح اختیارات مشخصی دارد.</p>
                </div>
                {isOwner && (
                  <div className="welcome-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openModal(setPlatformAdminModal, true)}
                    >
                      <Icon name="bi-person-plus" /> مدیر سامانهٔ جدید
                    </button>
                  </div>
                )}
              </div>

              <div className="platform-level-grid">
                {Object.keys(PLATFORM_LEVEL_LABELS).map((key) => (
                  <div className={`platform-level-card is-${key}`} key={key}>
                    <span className="platform-level-icon">
                      <Icon name={PLATFORM_LEVEL_ICONS[key]} />
                    </span>
                    <div>
                      <strong>{PLATFORM_LEVEL_LABELS[key]}</strong>
                      <p>{PLATFORM_LEVEL_HINTS[key]}</p>
                    </div>
                  </div>
                ))}
              </div>

              <section className="content-card data-card">
                {adminLoading ? (
                  <SkeletonTable rows={3} columns={5} />
                ) : platformAdmins.length === 0 ? (
                  <EmptyState
                    icon="bi-person-gear"
                    title="مدیر سامانه‌ای ثبت نشده"
                    text="با دکمهٔ «مدیر سامانهٔ جدید» اولین همکار را اضافه کنید."
                  />
                ) : (
                  <div className="table-responsive">
                    <table className="table custom-table align-middle">
                      <thead>
                        <tr>
                          <th scope="col">مدیر</th>
                          <th scope="col">سطح</th>
                          <th scope="col">وضعیت</th>
                          <th scope="col">آخرین ورود</th>
                          <th scope="col">عملیات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {platformAdmins.map((admin) => {
                          const isSelf = admin.id === sessionUser.id;
                          const controlsDisabled = !isOwner || busy || isSelf;
                          return (
                            <tr key={admin.id}>
                              <td>
                                <strong>{admin.fullName}</strong>
                                {isSelf && (
                                  <span className="status-badge info" style={{ marginInlineStart: 6 }}>
                                    شما
                                  </span>
                                )}
                                <div className="platform-muted">{admin.email}</div>
                              </td>
                              <td>
                                <Select
                                  className="form-select form-select-sm"
                                  value={admin.level}
                                  disabled={controlsDisabled}
                                  onChange={(event) =>
                                    changePlatformAdmin(admin, { level: event.target.value })
                                  }
                                >
                                  {Object.entries(PLATFORM_LEVEL_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td>
                                <span className={`status-badge ${admin.isActive ? "success" : "neutral"}`}>
                                  {admin.isActive ? "فعال" : "غیرفعال"}
                                </span>
                              </td>
                              <td>{faRelative(admin.lastLoginAt)}</td>
                              <td>
                                <div className="table-actions">
                                  {isOwner && (
                                    <>
                                      <button
                                        type="button"
                                        className="icon-btn"
                                        title="بازنشانی رمز"
                                        aria-label={`بازنشانی رمز ${admin.fullName}`}
                                        onClick={() => resetPlatformAdmin(admin)}
                                      >
                                        <Icon name="bi-key" />
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-btn"
                                        title={
                                          isSelf
                                            ? "حساب خودتان را نمی‌توانید غیرفعال کنید"
                                            : admin.isActive
                                              ? "غیرفعال‌سازی"
                                              : "فعال‌سازی"
                                        }
                                        aria-label={
                                          admin.isActive ? "غیرفعال‌سازی حساب" : "فعال‌سازی حساب"
                                        }
                                        disabled={isSelf}
                                        onClick={() =>
                                          changePlatformAdmin(admin, { isActive: !admin.isActive })
                                        }
                                      >
                                        <Icon name={admin.isActive ? "bi-person-slash" : "bi-person-check"} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {page === "audit" && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">شفافیت و پیگیری</div>
                  <h1>گزارش فعالیت سامانه</h1>
                  <p>همهٔ اقدامات مدیریتی و ورودهای مدیر سامانه به دانشکده‌ها.</p>
                </div>
                <div className="welcome-actions">
                  <button
                    type="button"
                    className="btn btn-light-outline"
                    onClick={exportAuditCsv}
                    disabled={busy}
                  >
                    <Icon name="bi-download" /> خروجی CSV
                  </button>
                </div>
              </div>
              <section className="content-card report-filter-card" style={{ marginBottom: 16 }}>
                <div className="platform-filter-grid">
                  <label className="form-label">
                    دانشکده
                    <Select
                      className="form-select"
                      value={auditFilters.organizationId}
                      onChange={(event) =>
                        setAuditFilters((current) => ({
                          ...current,
                          organizationId: event.target.value,
                        }))
                      }
                    >
                      <option value="">همهٔ دانشکده‌ها</option>
                      {faculties.map((faculty) => (
                        <option key={faculty.id} value={faculty.id}>
                          {faculty.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="form-label">
                    نوع اقدام
                    <Select
                      className="form-select"
                      value={auditFilters.action}
                      onChange={(event) =>
                        setAuditFilters((current) => ({
                          ...current,
                          action: event.target.value,
                        }))
                      }
                    >
                      <option value="">همهٔ اقدام‌ها</option>
                      {AUDIT_ACTION_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => loadAudit(auditFilters, 1).catch((e) => setError(e.message))}
                  >
                    <Icon name="bi-search" /> اعمال فیلتر
                  </button>
                  <button
                    type="button"
                    className="btn btn-light"
                    onClick={() => {
                      const cleared = { organizationId: "", action: "" };
                      setAuditFilters(cleared);
                      loadAudit(cleared, 1).catch((e) => setError(e.message));
                    }}
                  >
                    پاک کردن
                  </button>
                </div>
              </section>
              <section className="content-card data-card">
                {auditLoading ? (
                  <SkeletonTable rows={6} columns={5} />
                ) : auditItems.length === 0 ? (
                  <EmptyState
                    icon="bi-clock-history"
                    title="موردی یافت نشد"
                    text="فیلتر دانشکده یا نوع اقدام را تغییر دهید."
                  />
                ) : (
                  <>
                    <div className="table-responsive">
                      <table className="table custom-table align-middle">
                        <thead>
                          <tr>
                            <th scope="col">تاریخ</th>
                            <th scope="col">دانشکده</th>
                            <th scope="col">کاربر</th>
                            <th scope="col">اقدام</th>
                            <th scope="col">موجودیت</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditItems.map((item) => (
                            <tr key={item.id}>
                              <td title={faDateTime(item.createdAt)}>
                                {faRelative(item.createdAt)}
                              </td>
                              <td>{item.organizationName}</td>
                              <td>
                                {item.actorName || "سامانه"}
                                {item.platformActor && (
                                  <span className="status-badge info" style={{ marginInlineStart: 6 }}>
                                    مدیر سامانه
                                  </span>
                                )}
                              </td>
                              <td>
                                <span className="platform-action-cell">
                                  <Icon name={auditActionIcon(item.action)} />
                                  {AUDIT_ACTION_LABELS[item.action] || item.action}
                                </span>
                              </td>
                              <td>{auditEntityLabel(item.entityType)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <TablePager
                      page={auditPage}
                      pageSize={20}
                      total={auditTotal}
                      onPageChange={(next) => loadAudit(auditFilters, next).catch((e) => setError(e.message))}
                      label="رویداد"
                    />
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {facultyModal && (
        <Modal
          title={facultyModal.mode === "edit" ? "ویرایش دانشکده" : "دانشکدهٔ جدید"}
          eyebrow="مدیریت سامانه"
          onClose={() => closeModal(setFacultyModal)}
          error={modalError}
          wide
        >
          <form onSubmit={saveFaculty}>
            <div className="platform-form-grid">
              <label className="form-label">
                نام دانشکده
                <input
                  name="name"
                  className="form-control"
                  required
                  minLength={2}
                  defaultValue={facultyModal.faculty?.name || ""}
                  placeholder="دانشکدهٔ …"
                />
              </label>
              <label className="form-label">
                کد دانشکده
                <input
                  name="code"
                  className="form-control"
                  required
                  pattern="[A-Za-z0-9_-]+"
                  defaultValue={facultyModal.faculty?.code || ""}
                  placeholder="SHAMSIPOUR"
                  dir="ltr"
                />
              </label>
              <label className="form-label">
                نام رابط
                <input
                  name="contactName"
                  className="form-control"
                  defaultValue={facultyModal.faculty?.contactName || ""}
                  placeholder="اختیاری"
                />
              </label>
              <label className="form-label">
                ایمیل رابط
                <input
                  name="contactEmail"
                  type="email"
                  className="form-control"
                  defaultValue={facultyModal.faculty?.contactEmail || ""}
                  placeholder="اختیاری"
                  dir="ltr"
                />
              </label>
              <label className="form-label">
                تلفن رابط
                <input
                  name="contactPhone"
                  className="form-control"
                  defaultValue={facultyModal.faculty?.contactPhone || ""}
                  placeholder="اختیاری"
                  dir="ltr"
                />
              </label>
            </div>
            {facultyModal.mode === "create" && (
              <>
                <div className="platform-section-title">مدیر اول دانشکده</div>
                <div className="platform-form-grid">
                  <label className="form-label">
                    نام و نام خانوادگی
                    <input name="adminFullName" className="form-control" required minLength={2} />
                  </label>
                  <label className="form-label">
                    ایمیل (نام کاربری)
                    <input
                      name="adminEmail"
                      type="email"
                      className="form-control"
                      required
                      dir="ltr"
                    />
                  </label>
                  <label className="form-label">
                    سطح دسترسی
                    <Select name="adminLevel" className="form-select" defaultValue="owner">
                      {Object.entries(FACULTY_LEVEL_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {facultyModal.mode === "edit" ? "ذخیرهٔ تغییرات" : "ساخت دانشکده"}
              </button>
              <button type="button" className="btn btn-light" onClick={() => closeModal(setFacultyModal)}>
                انصراف
              </button>
            </div>
          </form>
        </Modal>
      )}

      {adminModal && (
        <Modal
          title={`کارکنان ${adminModal.faculty.name}`}
          eyebrow="دسترسی دانشکده"
          onClose={() => closeModal(setAdminModal)}
          error={modalError}
          wide
        >
          {adminModal.admins.length === 0 ? (
            <EmptyState
              icon="bi-people"
              title="کارمندی ثبت نشده"
              text="با فرم پایین اولین کارمند این دانشکده را اضافه کنید."
            />
          ) : (
            <div className="table-responsive">
              <table className="table custom-table align-middle">
                <thead>
                  <tr>
                    <th scope="col">کارمند</th>
                    <th scope="col">سطح</th>
                    <th scope="col">وضعیت</th>
                    <th scope="col">آخرین ورود</th>
                    <th scope="col">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {adminModal.admins.map((admin) => (
                    <tr key={admin.id}>
                      <td>
                        <strong>{admin.fullName}</strong>
                        <div className="platform-muted">{admin.email}</div>
                      </td>
                      <td>
                        <Select
                          className="form-select form-select-sm"
                          value={admin.level}
                          disabled={busy}
                          onChange={(event) =>
                            changeFacultyAdmin(admin, { level: event.target.value })
                          }
                        >
                          {Object.entries(FACULTY_LEVEL_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <span className={`status-badge ${admin.isActive ? "success" : "neutral"}`}>
                          {admin.isActive ? "فعال" : "غیرفعال"}
                        </span>
                      </td>
                      <td>{faRelative(admin.lastLoginAt)}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title="بازنشانی رمز"
                            aria-label={`بازنشانی رمز ${admin.fullName}`}
                            onClick={() => resetFacultyAdmin(admin)}
                          >
                            <Icon name="bi-key" />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={admin.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                            aria-label={admin.isActive ? "غیرفعال‌سازی حساب" : "فعال‌سازی حساب"}
                            onClick={() =>
                              changeFacultyAdmin(admin, { isActive: !admin.isActive })
                            }
                          >
                            <Icon name={admin.isActive ? "bi-person-slash" : "bi-person-check"} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="platform-section-title">افزودن کارمند جدید</div>
          <form onSubmit={addFacultyAdmin} className="platform-form-grid">
            <label className="form-label">
              نام و نام خانوادگی
              <input name="fullName" className="form-control" required minLength={2} />
            </label>
            <label className="form-label">
              ایمیل (نام کاربری)
              <input name="email" type="email" className="form-control" required dir="ltr" />
            </label>
            <label className="form-label">
              سطح دسترسی
              <Select name="level" className="form-select" defaultValue="manager">
                {Object.entries(FACULTY_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="platform-form-action">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon name="bi-person-plus" /> ساخت حساب
              </button>
            </div>
          </form>
          <div className="platform-level-hints">
            {Object.keys(FACULTY_LEVEL_LABELS).map((key) => (
              <p key={key} className="platform-inline-note">
                <strong>{FACULTY_LEVEL_LABELS[key]}:</strong> {FACULTY_LEVEL_HINTS[key]}
              </p>
            ))}
          </div>
          {adminModal.faculty.isActive === false && (
            <p className="platform-inline-note is-danger">
              دانشکده آرشیو شده است؛ برای ساخت کارمند، ابتدا آن را فعال کنید.
            </p>
          )}
        </Modal>
      )}

      {enterModal && (
        <Modal
          title={`ورود به ${enterModal.name}`}
          eyebrow="ورود با دسترسی مدیر"
          onClose={() => closeModal(setEnterModal)}
          error={modalError}
        >
          <p className="page-note">
            با این ورود، همهٔ اقدامات شما با نام مدیر سامانه ثبت می‌شود و به مدیران
            دانشکده اعلان می‌رسد. دسترسی پس از ۶۰ دقیقه یا با «بازگشت به پنل سامانه»
            پایان می‌یابد.
          </p>
          <form onSubmit={enterSelectedFaculty}>
            <label className="form-label">
              دلیل ورود (الزامی)
              <textarea
                name="reason"
                className="form-control"
                rows={3}
                required
                minLength={5}
                placeholder="مثلاً بررسی مشکل ثبت‌نام دانشجویان"
              />
            </label>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon name="bi-box-arrow-in-left" /> ورود به دانشکده
              </button>
              <button type="button" className="btn btn-light" onClick={() => closeModal(setEnterModal)}>
                انصراف
              </button>
            </div>
          </form>
        </Modal>
      )}

      {platformAdminModal && (
        <Modal
          title="مدیر سامانهٔ جدید"
          eyebrow="دسترسی سامانه"
          onClose={() => closeModal(setPlatformAdminModal)}
          error={modalError}
        >
          <form onSubmit={addPlatformAdmin}>
            <label className="form-label">
              نام و نام خانوادگی
              <input name="fullName" className="form-control" required minLength={2} />
            </label>
            <label className="form-label mt-3">
              ایمیل (نام کاربری)
              <input name="email" type="email" className="form-control" required dir="ltr" />
            </label>
            <label className="form-label mt-3">
              سطح دسترسی
              <Select name="level" className="form-select" defaultValue="operator">
                {Object.entries(PLATFORM_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="platform-level-hints">
              {Object.keys(PLATFORM_LEVEL_LABELS).map((key) => (
                <p key={key} className="platform-inline-note">
                  <strong>{PLATFORM_LEVEL_LABELS[key]}:</strong> {PLATFORM_LEVEL_HINTS[key]}
                </p>
              ))}
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                ساخت حساب
              </button>
              <button
                type="button"
                className="btn btn-light"
                onClick={() => closeModal(setPlatformAdminModal)}
              >
                انصراف
              </button>
            </div>
          </form>
        </Modal>
      )}

      {accountModal && (
        <Modal
          title="حساب من"
          eyebrow="امنیت حساب سامانه"
          onClose={() => closeModal(setAccountModal)}
          error={modalError}
        >
          <div className="platform-account-summary">
            <span className="avatar">{(sessionUser.name || "م").charAt(0)}</span>
            <div>
              <strong>{sessionUser.name || "مدیر سامانه"}</strong>
              <small>{sessionUser.email}</small>
            </div>
            <span className={`status-badge ${PLATFORM_LEVEL_TONES[level] || "neutral"}`}>
              {PLATFORM_LEVEL_LABELS[level] || level}
            </span>
          </div>
          <div className="platform-section-title">تغییر رمز عبور</div>
          <form onSubmit={submitAccountPassword}>
            <label className="form-label">
              رمز عبور فعلی
              <PasswordInput
                name="currentPassword"
                autoComplete="current-password"
                placeholder="رمز فعلی"
                required
              />
            </label>
            <label className="form-label mt-3">
              رمز عبور جدید
              <PasswordInput
                name="newPassword"
                autoComplete="new-password"
                placeholder="حداقل ۸ کاراکتر"
                minLength={8}
                required
              />
            </label>
            <label className="form-label mt-3">
              تکرار رمز عبور جدید
              <PasswordInput
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="تکرار رمز جدید"
                minLength={8}
                required
              />
            </label>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                ذخیرهٔ رمز جدید
              </button>
              <button type="button" className="btn btn-light" onClick={() => closeModal(setAccountModal)}>
                انصراف
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmState && (
        <Modal
          title={confirmState.title}
          eyebrow="تأیید عملیات"
          onClose={() => (!confirmBusy ? closeModal(setConfirmState) : null)}
          error={modalError}
        >
          <p className="page-note" style={{ marginTop: 0 }}>
            {confirmState.message}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className={`btn ${confirmState.tone === "danger" ? "btn-danger" : "btn-primary"}`}
              onClick={runConfirm}
              disabled={confirmBusy}
            >
              {confirmBusy ? "در حال انجام…" : confirmState.confirmLabel || "تأیید"}
            </button>
            <button
              type="button"
              className="btn btn-light"
              onClick={() => closeModal(setConfirmState)}
              disabled={confirmBusy}
            >
              انصراف
            </button>
          </div>
        </Modal>
      )}

      {credentials && (
        <CredentialsModal
          title={credentials.title}
          rows={credentials.rows}
          onClose={() => setCredentials(null)}
        />
      )}

      {toast && (
        <div
          className={`toast-custom platform-toast ${toast.tone === "error" ? "is-error" : ""}`}
          role="status"
        >
          <Icon name={toast.tone === "error" ? "bi-exclamation-circle" : "bi-check-circle"} />
          {toast.message}
        </div>
      )}
    </div>
  );
}

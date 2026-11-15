import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Icon, SkeletonTable, StatCard } from "./shared.jsx";
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
  updateFacultyAdmin,
  updatePlatformAdmin,
  updatePlatformFaculty,
} from "../api/client.js";

const FACULTY_LEVEL_LABELS = {
  owner: "مدیر ارشد",
  manager: "مدیر",
  operator: "اپراتور",
  viewer: "ناظر (فقط مشاهده)",
};
const PLATFORM_LEVEL_LABELS = {
  owner: "مالک سامانه",
  operator: "اپراتور سامانه",
  auditor: "ناظر سامانه",
};
const PLATFORM_LEVEL_TONES = { owner: "success", operator: "info", auditor: "neutral" };

const faNumber = (value) => Number(value || 0).toLocaleString("fa-IR");
const faDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

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
};

function Modal({ title, eyebrow, onClose, children, wide = false }) {
  return (
    <div
      className="modal-backdrop-custom"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`custom-modal ${wide ? "platform-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h3>{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="بستن">
            <Icon name="bi-x-lg" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function CredentialsModal({ title, rows, onClose }) {
  const copy = (row) => {
    const text = `نام کاربری: ${row.username}\nرمز موقت: ${row.temporaryPassword}`;
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).catch(() => {});
  };
  return (
    <div className="modal-backdrop-custom" role="presentation">
      <section
        className="custom-modal credentials-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">اعتبارنامهٔ ورود</span>
            <h3>{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
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
                  <Icon name="bi-clipboard" /> کپی
                </button>
              </div>
            </div>
          ))}
        </div>
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

export default function PlatformArea({ theme, onToggleTheme, onEnterFaculty, onExitToSite }) {
  const [token, setToken] = useState(() => getPlatformToken());
  const [sessionUser, setSessionUser] = useState(() => getPlatformUser());
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [passwordChange, setPasswordChange] = useState(null);
  const [page, setPage] = useState("overview");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [faculties, setFaculties] = useState([]);
  const [platformAdmins, setPlatformAdmins] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [auditItems, setAuditItems] = useState([]);
  const [auditFilters, setAuditFilters] = useState({ organizationId: "", action: "" });
  const [facultyModal, setFacultyModal] = useState(null);
  const [adminModal, setAdminModal] = useState(null);
  const [enterModal, setEnterModal] = useState(null);
  const [platformAdminModal, setPlatformAdminModal] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const level = sessionUser?.platformLevel || "auditor";
  const canManage = level === "owner" || level === "operator";
  const isOwner = level === "owner";

  const reloadFaculties = useCallback(async () => {
    const data = await fetchPlatformFaculties();
    setFaculties(data?.faculties || []);
  }, []);
  const reloadOverview = useCallback(async () => {
    const data = await fetchPlatformOverview();
    setOverview(data);
  }, []);
  const reloadAdmins = useCallback(async () => {
    const data = await fetchPlatformAdmins();
    setPlatformAdmins(data?.admins || []);
  }, []);
  const reloadSessions = useCallback(async () => {
    try {
      const { sessions } = await fetchPlatformImpersonations();
      setActiveSessions(sessions || []);
    } catch {
      setActiveSessions([]);
    }
  }, []);
  const reloadAudit = useCallback(async (filters = auditFilters) => {
    const data = await fetchPlatformAudit({ ...filters, limit: 100 });
    setAuditItems(data?.items || []);
  }, [auditFilters]);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [overviewData, facultiesData] = await Promise.all([
        fetchPlatformOverview(),
        fetchPlatformFaculties(),
      ]);
      setOverview(overviewData);
      setFaculties(facultiesData?.faculties || []);
    } catch (loadError) {
      setError(loadError.message || "دریافت اطلاعات پنل سامانه انجام نشد.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token && sessionUser && !sessionUser.mustChangePassword) refreshAll();
  }, [token, sessionUser, refreshAll]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.mustChangePassword) return;
    if (page === "admins") {
      reloadAdmins().catch((e) => setError(e.message));
      reloadSessions().catch(() => {});
    }
    if (page === "audit") reloadAudit().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, token, sessionUser]);

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
        setPasswordChange({ currentPassword: loginPassword });
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
    setPage("overview");
  };

  async function saveFaculty(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true);
    setError("");
    try {
      if (facultyModal?.mode === "edit") {
        const result = await updatePlatformFaculty(facultyModal.faculty.id, {
          name: values.name,
          code: values.code,
          contactName: values.contactName,
          contactEmail: values.contactEmail,
          contactPhone: values.contactPhone,
        });
        setFacultyModal(null);
        notify("اطلاعات دانشکده به‌روزرسانی شد.");
        await reloadFaculties();
        if (result?.faculty) {
          setOverview((current) => current && { ...current });
        }
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
      setError(saveError.message || "ذخیرهٔ دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveFaculty(faculty) {
    if (!window.confirm(`دانشکدهٔ «${faculty.name}» آرشیو شود؟ ورود همهٔ کاربران آن بسته می‌شود.`))
      return;
    setBusy(true);
    try {
      await archivePlatformFaculty(faculty.id);
      notify("دانشکده آرشیو شد.");
      await Promise.all([reloadFaculties(), reloadOverview()]);
    } catch (archiveError) {
      setError(archiveError.message || "آرشیو دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreFaculty(faculty) {
    setBusy(true);
    try {
      await updatePlatformFaculty(faculty.id, { isActive: true });
      notify("دانشکده دوباره فعال شد.");
      await Promise.all([reloadFaculties(), reloadOverview()]);
    } catch (restoreError) {
      setError(restoreError.message || "فعال‌سازی دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function openAdmins(faculty) {
    setBusy(true);
    setError("");
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
    try {
      const result = await createFacultyAdmin(adminModal.faculty.id, {
        fullName: values.fullName,
        email: values.email,
        level: values.level,
      });
      setCredentials({
        title: "مدیر جدید دانشکده",
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
      setError(createError.message || "ساخت مدیر دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function changeFacultyAdmin(admin, patch) {
    setBusy(true);
    try {
      await updateFacultyAdmin(adminModal.faculty.id, admin.id, patch);
      notify("سطح دسترسی مدیر به‌روزرسانی شد.");
      await openAdmins(adminModal.faculty);
      await reloadFaculties();
    } catch (updateError) {
      setError(updateError.message || "تغییر دسترسی انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function resetFacultyAdmin(admin) {
    if (!window.confirm(`رمز موقت جدید برای «${admin.fullName}» ساخته شود؟`)) return;
    setBusy(true);
    try {
      const result = await resetFacultyAdminPassword(adminModal.faculty.id, admin.id);
      setCredentials({
        title: "رمز موقت جدید مدیر دانشکده",
        rows: [
          {
            fullName: admin.fullName,
            username: result.username,
            temporaryPassword: result.temporaryPassword,
            note: "رمز باید در اولین ورود تغییر کند.",
          },
        ],
      });
    } catch (resetError) {
      setError(resetError.message || "بازنشانی رمز انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function enterSelectedFaculty(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (reason.length < 5) {
      setError("دلیل ورود را کامل‌تر بنویسید (حداقل ۵ کاراکتر).");
      return;
    }
    setBusy(true);
    try {
      const result = await enterFaculty(enterModal.id, reason);
      setEnterModal(null);
      onEnterFaculty?.(result);
    } catch (enterError) {
      setError(enterError.message || "ورود به دانشکده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function addPlatformAdmin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true);
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
      setError(createError.message || "ساخت مدیر سامانه انجام نشد.");
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

  async function resetPlatformAdmin(admin) {
    if (!window.confirm(`رمز موقت جدید برای «${admin.fullName}» ساخته شود؟`)) return;
    setBusy(true);
    try {
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
    } catch (resetError) {
      setError(resetError.message || "بازنشانی رمز انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function endSession(session) {
    if (!window.confirm("این نشست ورود به دانشکده پایان یابد؟")) return;
    try {
      await revokeImpersonation(session.id);
      notify("نشست پایان یافت.");
      await reloadSessions();
    } catch (revokeError) {
      setError(revokeError.message || "پایان نشست انجام نشد.");
    }
  }

  function exportAuditCsv() {
    if (!auditItems.length) return;
    const rows = [
      ["تاریخ", "دانشکده", "کاربر", "اقدام", "نوع موجودیت", "شناسه"],
      ...auditItems.map((item) => [
        faDateTime(item.createdAt),
        item.organizationName,
        item.actorName || "—",
        AUDIT_ACTION_LABELS[item.action] || item.action,
        item.entityType,
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
  }

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
              required
            />
          </div>
          <label className="form-label mt-3" htmlFor="platform-password">
            رمز عبور
          </label>
          <div className="input-icon-wrap">
            <Icon name="bi-lock" />
            <input
              id="platform-password"
              className="form-control"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {loginError && (
            <p className="login-error" role="alert">
              {loginError}
            </p>
          )}
          <button className="btn btn-primary w-100" type="submit" disabled={loginPending}>
            {loginPending ? "در حال ورود…" : "ورود به پنل سامانه"}
            <Icon name="bi-arrow-left-short" />
          </button>
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
    );
  }

  if (passwordChange) {
    return (
      <div className="platform-login-screen">
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
          <h1>تعیین رمز عبور جدید</h1>
          <p>برای ادامهٔ کار در پنل سامانه، رمز موقت خود را تغییر دهید.</p>
          <label className="form-label" htmlFor="pc-current">
            رمز موقت
          </label>
          <input
            id="pc-current"
            name="currentPassword"
            className="form-control"
            type="password"
            required
            defaultValue={passwordChange.currentPassword || ""}
          />
          <label className="form-label mt-3" htmlFor="pc-new">
            رمز عبور جدید
          </label>
          <input
            id="pc-new"
            name="newPassword"
            className="form-control"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
          <label className="form-label mt-3" htmlFor="pc-confirm">
            تکرار رمز عبور جدید
          </label>
          <input
            id="pc-confirm"
            name="confirmPassword"
            className="form-control"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary w-100" type="submit" disabled={busy}>
            ذخیرهٔ رمز و ادامه
          </button>
          <button type="button" className="login-home-link" onClick={logout}>
            خروج
          </button>
        </form>
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
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark platform-brand-mark">
            <Icon name="bi-buildings" />
          </span>
          <div>
            <strong>پنل سامانه</strong>
            <small>مدیریت دانشکده‌ها</small>
          </div>
        </div>
        <nav className="side-nav">
          <div className="nav-group">
            <div className="nav-group-title">مدیریت سامانه</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-link-custom ${page === item.id ? "active" : ""}`}
                onClick={() => setPage(item.id)}
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
          <button type="button" className="btn btn-light-outline w-100" onClick={logout}>
            <Icon name="bi-box-arrow-right" /> خروج از پنل سامانه
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-right">
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
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">نمای کلی سامانه</div>
                  <h1>سلام، {sessionUser.name || "مدیر سامانه"}</h1>
                  <p>وضعیت دانشکده‌ها و فعالیت‌های اخیر سامانه را از اینجا پیگیری کنید.</p>
                </div>
                {canManage && (
                  <div className="welcome-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setFacultyModal({ mode: "create" })}
                    >
                      <Icon name="bi-plus-lg" /> دانشکدهٔ جدید
                    </button>
                  </div>
                )}
              </div>
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
                  icon="bi-shield-lock"
                  label="مدیران دانشکده"
                  value={faNumber(overview?.stats?.facultyAdmins)}
                  detail="فعال"
                  color="rose"
                />
              </div>

              <section className="content-card" style={{ marginTop: 16 }}>
                <div className="panel-title-inline" style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>دانشکده‌ها</h3>
                  <button type="button" className="btn btn-light-outline" onClick={() => setPage("faculties")}>
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
                        onClick={() => setPage("faculties")}
                      >
                        <span className="platform-faculty-icon">
                          <Icon name="bi-mortarboard" />
                        </span>
                        <span>
                          <strong>{faculty.name}</strong>
                          <small>
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

              <section className="content-card" style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>فعالیت اخیر</h3>
                {(overview?.recentActivity || []).length === 0 ? (
                  <EmptyState icon="bi-clock-history" title="فعالیتی ثبت نشده" text="اقدامات مدیریتی در این بخش دیده می‌شوند." />
                ) : (
                  <ul className="platform-activity-list">
                    {overview.recentActivity.map((item) => (
                      <li key={item.id}>
                        <span className="platform-activity-dot" />
                        <div>
                          <strong>{AUDIT_ACTION_LABELS[item.action] || item.action}</strong>
                          <small>
                            {item.organizationName} · {item.actorName || "سامانه"} · {faDateTime(item.createdAt)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {activeSessions.length > 0 && (
                <section className="content-card" style={{ marginTop: 16 }}>
                  <h3 style={{ marginTop: 0 }}>نشست‌های فعال ورود به دانشکده</h3>
                  <div className="table-responsive">
                    <table className="table custom-table align-middle">
                      <thead>
                        <tr>
                          <th>دانشکده</th>
                          <th>مدیر سامانه</th>
                          <th>شروع</th>
                          <th>پایان</th>
                          <th />
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
                                  className="btn btn-light-outline"
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
                </section>
              )}
            </>
          )}

          {page === "faculties" && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">مدیریت دانشکده‌ها</div>
                  <h1>دانشکده‌ها</h1>
                  <p>ساخت، ویرایش، ورود و آرشیو دانشکده‌ها و مدیران آن‌ها.</p>
                </div>
                {canManage && (
                  <div className="welcome-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setFacultyModal({ mode: "create" })}
                    >
                      <Icon name="bi-plus-lg" /> دانشکدهٔ جدید
                    </button>
                  </div>
                )}
              </div>
              <section className="content-card data-card">
                {loading ? (
                  <SkeletonTable rows={5} columns={7} />
                ) : faculties.length === 0 ? (
                  <EmptyState icon="bi-buildings" title="دانشکده‌ای وجود ندارد" text="اولین دانشکده را بسازید." />
                ) : (
                  <div className="table-responsive">
                    <table className="table custom-table align-middle">
                      <thead>
                        <tr>
                          <th>دانشکده</th>
                          <th>کد</th>
                          <th>وضعیت</th>
                          <th>دانشجو</th>
                          <th>استاد</th>
                          <th>درس</th>
                          <th>آخرین فعالیت</th>
                          <th>عملیات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {faculties.map((faculty) => (
                          <tr key={faculty.id}>
                            <td>
                              <strong>{faculty.name}</strong>
                              <div className="platform-muted">
                                {faculty.contactName || faculty.contactEmail || "—"}
                              </div>
                            </td>
                            <td>
                              <code>{faculty.code}</code>
                            </td>
                            <td>
                              <span className={`status-badge ${faculty.isActive ? "success" : "neutral"}`}>
                                {faculty.isActive ? "فعال" : "آرشیو"}
                              </span>
                            </td>
                            <td>{faNumber(faculty.students)}</td>
                            <td>{faNumber(faculty.teachers)}</td>
                            <td>{faNumber(faculty.courses)}</td>
                            <td>{faDateTime(faculty.lastActivity)}</td>
                            <td>
                              <div className="table-actions">
                                {canManage && faculty.isActive && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title="ورود به دانشکده"
                                    onClick={() => setEnterModal({ id: faculty.id, name: faculty.name })}
                                  >
                                    <Icon name="bi-box-arrow-in-left" />
                                  </button>
                                )}
                                {canManage && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title="مدیران دانشکده"
                                    onClick={() => openAdmins(faculty)}
                                  >
                                    <Icon name="bi-people" />
                                  </button>
                                )}
                                {canManage && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title="ویرایش"
                                    onClick={() => setFacultyModal({ mode: "edit", faculty })}
                                  >
                                    <Icon name="bi-pencil" />
                                  </button>
                                )}
                                {canManage &&
                                  (faculty.isActive ? (
                                    <button
                                      type="button"
                                      className="icon-btn danger"
                                      title="آرشیو"
                                      onClick={() => archiveFaculty(faculty)}
                                    >
                                      <Icon name="bi-archive" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      title="فعال‌سازی"
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
                      onClick={() => setPlatformAdminModal(true)}
                    >
                      <Icon name="bi-person-plus" /> مدیر سامانهٔ جدید
                    </button>
                  </div>
                )}
              </div>
              <div className="page-note" style={{ marginBottom: 12 }}>
                «مالک» همه‌چیز، «اپراتور» مدیریت دانشکده‌ها و ورود به آن‌ها، و «ناظر»
                فقط مشاهدهٔ پنل سامانه و گزارش فعالیت را دارد.
              </div>
              <section className="content-card data-card">
                <div className="table-responsive">
                  <table className="table custom-table align-middle">
                    <thead>
                      <tr>
                        <th>مدیر</th>
                        <th>سطح</th>
                        <th>وضعیت</th>
                        <th>آخرین ورود</th>
                        <th>عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformAdmins.map((admin) => (
                        <tr key={admin.id}>
                          <td>
                            <strong>{admin.fullName}</strong>
                            <div className="platform-muted">{admin.email}</div>
                          </td>
                          <td>
                            <select
                              className="form-select form-select-sm"
                              value={admin.level}
                              disabled={!isOwner || busy}
                              onChange={(event) =>
                                changePlatformAdmin(admin, { level: event.target.value })
                              }
                            >
                              {Object.entries(PLATFORM_LEVEL_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span className={`status-badge ${admin.isActive ? "success" : "neutral"}`}>
                              {admin.isActive ? "فعال" : "غیرفعال"}
                            </span>
                          </td>
                          <td>{faDateTime(admin.lastLoginAt)}</td>
                          <td>
                            <div className="table-actions">
                              {isOwner && (
                                <>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title="بازنشانی رمز"
                                    onClick={() => resetPlatformAdmin(admin)}
                                  >
                                    <Icon name="bi-key" />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title={admin.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
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
                      ))}
                    </tbody>
                  </table>
                </div>
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
                  <button type="button" className="btn btn-light-outline" onClick={exportAuditCsv}>
                    <Icon name="bi-download" /> خروجی CSV
                  </button>
                </div>
              </div>
              <section className="content-card report-filter-card" style={{ marginBottom: 16 }}>
                <div className="platform-filter-grid">
                  <label className="form-label">
                    دانشکده
                    <select
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
                    </select>
                  </label>
                  <label className="form-label">
                    نوع اقدام
                    <input
                      className="form-control"
                      value={auditFilters.action}
                      placeholder="مثلاً platform.impersonation"
                      onChange={(event) =>
                        setAuditFilters((current) => ({
                          ...current,
                          action: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => reloadAudit().catch((e) => setError(e.message))}
                  >
                    <Icon name="bi-search" /> جست‌وجو
                  </button>
                </div>
              </section>
              <section className="content-card data-card">
                {auditItems.length === 0 ? (
                  <EmptyState icon="bi-clock-history" title="موردی یافت نشد" text="فیلترها را تغییر دهید." />
                ) : (
                  <div className="table-responsive">
                    <table className="table custom-table align-middle">
                      <thead>
                        <tr>
                          <th>تاریخ</th>
                          <th>دانشکده</th>
                          <th>کاربر</th>
                          <th>اقدام</th>
                          <th>موجودیت</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditItems.map((item) => (
                          <tr key={item.id}>
                            <td>{faDateTime(item.createdAt)}</td>
                            <td>{item.organizationName}</td>
                            <td>
                              {item.actorName || "سامانه"}
                              {item.platformActor && (
                                <span className="status-badge info" style={{ marginInlineStart: 6 }}>
                                  مدیر سامانه
                                </span>
                              )}
                            </td>
                            <td>{AUDIT_ACTION_LABELS[item.action] || item.action}</td>
                            <td>
                              <code>{item.entityType}</code>
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
        </div>
      </main>

      {facultyModal && (
        <Modal
          title={facultyModal.mode === "edit" ? "ویرایش دانشکده" : "دانشکدهٔ جدید"}
          eyebrow="مدیریت سامانه"
          onClose={() => setFacultyModal(null)}
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
                    <select name="adminLevel" className="form-select" defaultValue="owner">
                      {Object.entries(FACULTY_LEVEL_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {facultyModal.mode === "edit" ? "ذخیرهٔ تغییرات" : "ساخت دانشکده"}
              </button>
              <button type="button" className="btn btn-light" onClick={() => setFacultyModal(null)}>
                انصراف
              </button>
            </div>
          </form>
        </Modal>
      )}

      {adminModal && (
        <Modal
          title={`مدیران ${adminModal.faculty.name}`}
          eyebrow="دسترسی دانشکده"
          onClose={() => setAdminModal(null)}
          wide
        >
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>مدیر</th>
                  <th>سطح</th>
                  <th>وضعیت</th>
                  <th>آخرین ورود</th>
                  <th>عملیات</th>
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
                      <select
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
                      </select>
                    </td>
                    <td>
                      <span className={`status-badge ${admin.isActive ? "success" : "neutral"}`}>
                        {admin.isActive ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td>{faDateTime(admin.lastLoginAt)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title="بازنشانی رمز"
                          onClick={() => resetFacultyAdmin(admin)}
                        >
                          <Icon name="bi-key" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title={admin.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
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
          <div className="platform-section-title">افزودن مدیر جدید</div>
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
              <select name="level" className="form-select" defaultValue="manager">
                {Object.entries(FACULTY_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="platform-form-action">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon name="bi-person-plus" /> ساخت حساب
              </button>
            </div>
          </form>
          {adminModal.faculty.isActive === false && (
            <p className="page-note">دانشکده آرشیو شده است؛ برای ساخت مدیر، ابتدا آن را فعال کنید.</p>
          )}
        </Modal>
      )}

      {enterModal && (
        <Modal
          title={`ورود به ${enterModal.name}`}
          eyebrow="ورود با دسترسی مدیر"
          onClose={() => setEnterModal(null)}
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
              <button type="button" className="btn btn-light" onClick={() => setEnterModal(null)}>
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
          onClose={() => setPlatformAdminModal(null)}
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
              <select name="level" className="form-select" defaultValue="operator">
                {Object.entries(PLATFORM_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                ساخت حساب
              </button>
              <button
                type="button"
                className="btn btn-light"
                onClick={() => setPlatformAdminModal(null)}
              >
                انصراف
              </button>
            </div>
          </form>
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
        <div className="toast-custom platform-toast" role="status">
          <Icon name="bi-check-circle" /> {toast}
        </div>
      )}
    </div>
  );
}

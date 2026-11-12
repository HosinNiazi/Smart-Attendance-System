import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/shared.jsx";
import {
  AttendanceObjections,
  Courses,
  Dashboard,
  FaceAttendance,
  FingerprintAttendance,
  LeaveRequests,
  ManualAttendance,
  Profile,
  Registrations,
  Reports,
  Sessions,
  Settings,
  StudentPortal,
  Students,
  Tickets,
} from "./components/pages.jsx";
import { VoiceAttendance } from "./voice/VoiceAttendance.jsx";
import { LiveClass, TrendAnalysis } from "./components/phase2.jsx";
import {
  exportAudioProfiles,
  restoreAudioProfiles,
} from "./voice/audioStore.js";
import {
  api,
  createCourse,
  createSession,
  createRegistration,
  fetchRegistrations,
  fetchFaculties,
  switchFaculty,
  approveRegistration,
  rejectRegistration,
  fetchBootstrap,
  finalizeSession as finalizeSessionApi,
  getApiUser,
  migrateBrowserSnapshot,
  saveSettingsPayload,
  saveVoiceSample,
  signIn,
  updateStudent,
  uploadStudentPhoto,
  uploadMyPhoto,
  upsertAttendance,
  fetchFingerprintCredentials,
  fetchMyFingerprintCredentials,
  startFingerprintRegistration as startFingerprintRegistrationApi,
  finishFingerprintRegistration as finishFingerprintRegistrationApi,
  startFingerprintAuthentication as startFingerprintAuthenticationApi,
  finishFingerprintAuthentication as finishFingerprintAuthenticationApi,
  revokeFingerprintCredential as revokeFingerprintCredentialApi,
  startMyFingerprintRegistration as startMyFingerprintRegistrationApi,
  finishMyFingerprintRegistration as finishMyFingerprintRegistrationApi,
} from "./api/client.js";
import {
  createTicket as createTicketApi,
  fetchTickets as fetchTicketsApi,
  respondTicket as respondTicketApi,
  closeTicket as closeTicketApi,
  fetchLeaveRequests,
  createLeaveRequest,
  reviewLeaveRequest,
  fetchAttendanceObjections,
  createAttendanceObjection,
  reviewAttendanceObjection,
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  importStudents,
  importCourses,
  createGroupLeaveRequest,
  fetchAttendanceTrend,
  fetchCourseAnalytics,
  fetchLiveSessions,
  fetchLiveSession,
  startLiveSession,
  endLiveSession,
} from "./api/client.js";
import { adaptBootstrap, toEnStatus } from "./api/adapter.js";
import { HelpChat } from "./help/HelpChat.jsx";

const navGroups = [
  {
    title: "نمای کلی",
    items: [{ id: "dashboard", label: "داشبورد", icon: "bi-grid-1x2" }],
  },
  {
    title: "مدیریت آموزشی",
    items: [
      { id: "students", label: "دانشجویان", icon: "bi-people" },
      { id: "courses", label: "درس‌ها و کلاس‌ها", icon: "bi-journal-bookmark" },
      { id: "sessions", label: "جلسات کلاس", icon: "bi-calendar3" },
    ],
  },
  {
    title: "حضور و غیاب",
    items: [
      { id: "manual", label: "ثبت دستی حضور", icon: "bi-clipboard-check" },
      { id: "voice", label: "تشخیص صدا", icon: "bi-mic" },
      { id: "face", label: "تشخیص چهره", icon: "bi-camera-video" },
      { id: "class-camera", label: "دوربین کلاس", icon: "bi-camera-reels" },
      { id: "fingerprint", label: "اثر انگشت", icon: "bi-fingerprint" },
      { id: "class-live", label: "کلاس زنده", icon: "bi-broadcast" },
      { id: "trends", label: "تحلیل روند", icon: "bi-graph-up-arrow" },
      { id: "reports", label: "گزارش‌ها", icon: "bi-bar-chart-line" },
    ],
  },
  {
    title: "درخواست‌ها",
    items: [
      { id: "leave-requests", label: "مرخصی و توجیه", icon: "bi-calendar2-check" },
      { id: "objections", label: "اعتراض‌های حضور", icon: "bi-shield-exclamation" },
    ],
  },
  {
    title: "سیستم",
    items: [
      { id: "profile", label: "پروفایل من", icon: "bi-person-circle" },
      { id: "registrations", label: "پذیرش درخواست‌ها", icon: "bi-person-check" },
      { id: "tickets", label: "تیکت‌ها", icon: "bi-ticket" },
      { id: "settings", label: "تنظیمات", icon: "bi-gear" },
    ],
  },
];
const ROLE_PERMISSIONS = {
  admin: new Set(
    navGroups.flatMap((group) => group.items.map((item) => item.id)),
  ),
  teacher: new Set([
    "dashboard",
    "courses",
    "sessions",
    "manual",
    "voice",
    "face",
    "class-camera",
    "fingerprint",
    "class-live",
    "trends",
    "reports",
    "profile",
  ]),
};
const faDate = new Intl.DateTimeFormat("fa-IR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const PRESENT_STATUS = "\u062d\u0627\u0636\u0631";
const ABSENT_STATUS = "\u063a\u0627\u06cc\u0628";
const ACCESS_ROLE_LABELS = {
  admin: "\u0645\u062f\u06cc\u0631",
  teacher: "\u0627\u0633\u062a\u0627\u062f",
  student: "\u062f\u0627\u0646\u0634\u062c\u0648",
};

function AccessRoleSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const options = Object.entries(ACCESS_ROLE_LABELS);
  const selectedLabel = ACCESS_ROLE_LABELS[value];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const moveSelection = (direction) => {
    const current = options.findIndex(([optionValue]) => optionValue === value);
    const next = (current + direction + options.length) % options.length;
    onChange(options[next][0]);
  };

  return (
    <div
      className={`input-icon-wrap login-role-field${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <Icon name="bi-person-badge" />
      <button
        ref={buttonRef}
        id="access-role"
        type="button"
        className="form-select login-role-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="access-role-options"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
      >
        <span>{selectedLabel}</span>
      </button>
      {open && (
        <div
          className="login-role-menu"
          id="access-role-options"
          role="listbox"
          aria-labelledby="access-role"
        >
          {options.map(([optionValue, label]) => (
            <button
              key={optionValue}
              type="button"
              role="option"
              aria-selected={value === optionValue}
              className={`login-role-option${value === optionValue ? " is-selected" : ""}`}
              onClick={() => {
                onChange(optionValue);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <span className="login-role-option-icon">
                <Icon
                  name={
                    optionValue === "admin"
                      ? "bi-shield-check"
                      : optionValue === "teacher"
                        ? "bi-easel"
                        : "bi-mortarboard"
                  }
                />
              </span>
              <span>{label}</span>
              {value === optionValue && <Icon name="bi-check2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FacultySelect({ id, value, onChange, options = [], disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const selected = options.find((option) => option.id === value) || null;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const moveSelection = (direction) => {
    if (!options.length) return;
    const current = options.findIndex((option) => option.id === value);
    const next = (current + direction + options.length) % options.length;
    onChange(options[next].id);
  };

  const placeholder = disabled ? "در حال دریافت دانشکده‌ها…" : "انتخاب دانشکده";

  return (
    <div
      className={`input-icon-wrap login-role-field faculty-select-field${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <Icon name="bi-building" />
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="form-select login-role-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
      >
        <span className={selected ? "" : "faculty-placeholder"}>
          {selected?.name || placeholder}
        </span>
      </button>
      {open && !disabled && (
        <div
          className="login-role-menu"
          id={`${id}-options`}
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={value === option.id}
              className={`login-role-option${value === option.id ? " is-selected" : ""}`}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <span className="login-role-option-icon">
                <Icon name="bi-mortarboard" />
              </span>
              <span>{option.name}</span>
              {value === option.id && <Icon name="bi-check2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function readStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Could not persist ${key}`, error);
    return false;
  }
}

function readSessionProfile() {
  try {
    const value = sessionStorage.getItem("smart-attendance:profile");
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStudentLogin(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fa-IR")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function getLocalDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export default function App() {
  const [active, setActive] = useState("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [theme, setTheme] = useState(() =>
    readStoredValue("smart-attendance:theme", "light") === "dark"
      ? "dark"
      : "light",
  );
  const [students, setStudents] = useState(() => {
    const saved = readStoredValue("smart-attendance:students", null);
    return Array.isArray(saved)
      ? saved.filter(
          (student) =>
            student && student.id != null && typeof student.name === "string",
        )
      : [];
  });
  const [courses, setCourses] = useState(() => {
    const saved = readStoredValue("smart-attendance:courses", null);
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(
        (course) =>
          course &&
          typeof course.id === "string" &&
          typeof course.title === "string",
      )
      .map((course) => {
        const studentIds = Array.isArray(course.studentIds)
          ? course.studentIds
          : [];
        return { ...course, studentIds, count: studentIds.length };
      });
  });
  const [registrations, setRegistrations] = useState([]);
  const [attendance, setAttendance] = useState(() => {
    const saved = readStoredValue("smart-attendance:attendance", null);
    return Array.isArray(saved)
      ? saved.filter(
          (record) =>
            record &&
            record.id != null &&
            typeof record.name === "string" &&
            typeof record.course === "string",
        )
      : [];
  });
  const attendanceRef = useRef(attendance);
  const absentsSeededRef = useRef(new Set());
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("همه درس‌ها");
  const [toast, setToast] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [modal, setModal] = useState(false);
  const [studentForm, setStudentForm] = useState({
    id: "",
    name: "",
    major: "مهندسی کامپیوتر",
    term: "۳",
    phone: "",
  });
  const [sessionCourse, setSessionCourse] = useState("");
  const [sessionDate, setSessionDate] = useState(getLocalDate);
  const [sessionHistory, setSessionHistory] = useState(() => {
    const saved = readStoredValue("smart-attendance:sessions", {});
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {};
  });
  const sessionId = `${sessionCourse}::${sessionDate}`;
  const [cameraState, setCameraState] = useState("idle");
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(() =>
    readStoredValue("smart-attendance:camera-device", ""),
  );
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [fingerprintCredentials, setFingerprintCredentials] = useState([]);
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [settings, setSettings] = useState({
    name: "سامانه حضوربان",
    lateAfter: "10",
    notifications: true,
    faceRecognition: true,
  });
  const [login, setLogin] = useState(true);
  const [loginRole, setLoginRole] = useState(() => {
    const savedRole = readSessionProfile().role;
    return ACCESS_ROLE_LABELS[savedRole] ? savedRole : "admin";
  });
  const [profilePhoto, setProfilePhoto] = useState(
    () => readSessionProfile().photo || "",
  );
  const [loginName, setLoginName] = useState(
    () => readSessionProfile().email || "admin@hozorban.local",
  );
  const [studentNumber, setStudentNumber] = useState(
    () => readSessionProfile().studentId || "",
  );
  const [voiceProfiles, setVoiceProfiles] = useState([]);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [faculties, setFaculties] = useState([]);
  const [authUser, setAuthUser] = useState(() => getApiUser());
  const [facultyId, setFacultyId] = useState(
    () => localStorage.getItem("smart-attendance:faculty-id") || "",
  );
  const [facultySwitcherOpen, setFacultySwitcherOpen] = useState(false);
  const [facultySwitchPending, setFacultySwitchPending] = useState(false);
  const facultySwitcherRef = useRef(null);
  const [regModal, setRegModal] = useState(false);
  const [regForm, setRegForm] = useState({
    fullName: "",
    username: "",
    password: "",
    facultyId: "",
    nationalId: "",
    major: "",
    term: "",
    phone: "",
  });
  const [regPending, setRegPending] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [objections, setObjections] = useState([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [objectionsLoading, setObjectionsLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!writeStoredValue("smart-attendance:theme", theme))
      setStorageWarning(
        "فضای ذخیره‌سازی مرورگر کافی نیست؛ از اطلاعات پشتیبان بگیرید.",
      );
  }, [theme]);
  useEffect(
    () => () => streamRef.current?.getTracks().forEach((track) => track.stop()),
    [],
  );
  useEffect(() => {
    if (!writeStoredValue("smart-attendance:students", students))
      setStorageWarning(
        "ذخیرهٔ فهرست دانشجویان انجام نشد؛ فضای مرورگر پر یا مسدود است.",
      );
  }, [students]);
  useEffect(() => {
    if (!writeStoredValue("smart-attendance:courses", courses))
      setStorageWarning(
        "ذخیرهٔ درس‌ها و کلاس‌ها انجام نشد؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.",
      );
  }, [courses]);
  useEffect(() => {
    attendanceRef.current = attendance;
    if (!writeStoredValue("smart-attendance:attendance", attendance))
      setStorageWarning(
        "ذخیرهٔ رکوردهای حضور انجام نشد؛ برای جلوگیری از دست‌رفتن اطلاعات، پشتیبان بگیرید.",
      );
  }, [attendance]);
  useEffect(() => {
    if (!writeStoredValue("smart-attendance:sessions", sessionHistory))
      setStorageWarning(
        "ذخیرهٔ جلسه‌ها انجام نشد؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.",
      );
  }, [sessionHistory]);
  useEffect(() => {
    const saved = readStoredValue("smart-attendance:settings", null);
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      setSettings((current) => ({
        ...current,
        ...saved,
        lateAfter: String(saved.lateAfter ?? current.lateAfter),
      }));
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchFaculties()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.faculties) ? data.faculties : [];
        setFaculties(list);
        setFacultyId((current) => {
          if (current && list.some((faculty) => faculty.id === current)) {
            return current;
          }
          const savedUser = getApiUser();
          const preferred =
            list.find((faculty) => faculty.id === savedUser?.faculty?.id) ||
            list.find((faculty) => faculty.code === "SHAMSIPOUR") ||
            list[0];
          return preferred?.id || "";
        });
      })
      .catch((error) => console.warn("fetchFaculties failed", error));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (facultyId) localStorage.setItem("smart-attendance:faculty-id", facultyId);
  }, [facultyId]);
  useEffect(() => {
    if (!facultySwitcherOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!facultySwitcherRef.current?.contains(event.target)) {
        setFacultySwitcherOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setFacultySwitcherOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [facultySwitcherOpen]);
  useEffect(() => {
    if (login) return undefined;
    refreshNotifications();
    const timer = setInterval(() => refreshNotifications(), 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login]);
  const filteredStudents = useMemo(
    () =>
      students.filter(
        (s) =>
          s.status !== "غیرفعال" &&
          `${s.name} ${s.id} ${s.major}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [students, query],
  );
  const filteredAttendance = useMemo(
    () =>
      attendance.filter(
        (a) =>
          (courseFilter === "همه درس‌ها" || a.course === courseFilter) &&
          `${a.name} ${a.id} ${a.course}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [attendance, courseFilter, query],
  );
  const pageName =
    navGroups.flatMap((g) => g.items).find((i) => i.id === active)?.label ||
    "داشبورد";
  const studentAccount =
    loginRole === "student"
      ? students.find((student) => {
          const account = normalizeStudentLogin(studentNumber || loginName);
          return (
            account &&
            (account === normalizeStudentLogin(student.id) ||
              account === normalizeStudentLogin(student.name) ||
              (student.databaseId &&
                account === normalizeStudentLogin(student.databaseId)))
          );
        }) || null
      : null;
  const studentRecords = studentAccount
    ? attendance.filter(
        (record) => String(record.id) === String(studentAccount.id),
      )
    : [];
  const studentSessions = studentAccount
    ? Object.values(sessionHistory).filter((session) =>
        (session.studentIds || []).includes(studentAccount.id),
      )
    : [];
  const allowedPages = ROLE_PERMISSIONS[loginRole] || ROLE_PERMISSIONS.teacher;
  const visibleNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => allowedPages.has(item.id)),
    }))
    .filter((group) => group.items.length > 0);
  const currentFaculty =
    authUser?.faculty ||
    faculties.find((faculty) => faculty.id === facultyId) ||
    null;
  // Only teachers may belong to several faculties; admins/students have exactly one.
  const switchableFaculties =
    loginRole === "teacher" && Array.isArray(authUser?.faculties)
      ? authUser.faculties
      : [];
  const canSwitchFaculty = switchableFaculties.length > 1;

  function notify(message) {
    setToast(message);
  }

  function applyServerData(adapted) {
    setStudents(adapted.students);
    setCourses(adapted.courses);
    setAttendance(adapted.attendance);
    setSessionHistory(adapted.sessionHistory);
    if (adapted.settings) setSettings(adapted.settings);
    setVoiceProfiles(adapted.voiceProfiles || []);
  }

  async function loadFromServer({ silent = false } = {}) {
    const data = await fetchBootstrap();
    const adapted = adaptBootstrap(data);
    applyServerData(adapted);
    if (loginRole === "admin") {
      try {
        const regs = await fetchRegistrations();
        setRegistrations(Array.isArray(regs) ? regs : []);
      } catch (error) {
        console.warn("fetchRegistrations failed", error);
      }
    }
    if (!silent) {
      notify(
        `اطلاعات از دیتابیس بارگذاری شد؛ ${adapted.students.length} دانشجو، ${adapted.courses.length} درس و ${adapted.attendance.length} رکورد حضور.`,
      );
    }
    return adapted;
  }

  async function refreshTickets() {
    setTicketsLoading(true);
    try {
      const data = await fetchTicketsApi();
      setTickets(Array.isArray(data) ? data : []);
    } catch (error) {
      notify(error.message || "دریافت درخواست‌ها انجام نشد.");
    } finally {
      setTicketsLoading(false);
    }
  }

  async function refreshLeaveRequests() {
    setLeaveLoading(true);
    try {
      const data = await fetchLeaveRequests();
      setLeaveRequests(Array.isArray(data) ? data : []);
    } catch (error) {
      notify(error.message || "دریافت درخواست‌های مرخصی انجام نشد.");
    } finally {
      setLeaveLoading(false);
    }
  }

  async function reviewLeave(id, payload) {
    const updated = await reviewLeaveRequest(id, payload);
    await refreshLeaveRequests();
    await loadFromServer({ silent: true });
    notify(
      payload.status === "approved"
        ? "درخواست مرخصی تایید شد."
        : "درخواست مرخصی رد شد.",
    );
    return updated;
  }

  async function submitLeaveRequest(payload, proofFile) {
    const created = await createLeaveRequest(payload, proofFile);
    await refreshLeaveRequests();
    await refreshNotifications();
    return created;
  }

  async function refreshObjections() {
    setObjectionsLoading(true);
    try {
      const data = await fetchAttendanceObjections();
      setObjections(Array.isArray(data) ? data : []);
    } catch (error) {
      notify(error.message || "دریافت اعتراض‌ها انجام نشد.");
    } finally {
      setObjectionsLoading(false);
    }
  }

  async function reviewObjection(id, payload) {
    const updated = await reviewAttendanceObjection(id, payload);
    await refreshObjections();
    await loadFromServer({ silent: true });
    notify(
      payload.status === "approved"
        ? "اعتراض تایید و وضعیت حضور اصلاح شد."
        : "اعتراض رد شد.",
    );
    return updated;
  }

  async function submitObjection(payload) {
    const created = await createAttendanceObjection(payload);
    await refreshObjections();
    await refreshNotifications();
    return created;
  }

  async function refreshNotifications() {
    try {
      const [list, unread] = await Promise.all([
        fetchNotifications(),
        fetchUnreadNotificationCount(),
      ]);
      setNotifications(Array.isArray(list) ? list : []);
      setUnreadCount(Number(unread?.count) || 0);
    } catch (error) {
      console.warn("fetchNotifications failed", error);
    }
  }

  async function readNotification(id) {
    setNotifications((current) =>
      current.map((item) =>
        item.id === id ? { ...item, isRead: true } : item,
      ),
    );
    try {
      await markNotificationRead(id);
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch (error) {
      await refreshNotifications();
    }
  }

  async function readAllNotifications() {
    setNotifications((current) =>
      current.map((item) => ({ ...item, isRead: true })),
    );
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch (error) {
      await refreshNotifications();
    }
  }

  async function importStudentsHandler(rows) {
    const result = await importStudents(rows);
    await loadFromServer({ silent: true });
    notify(
      `${result.created.toLocaleString("fa-IR")} دانشجو ایمپورت شد${
        result.errors?.length
          ? ` و ${result.errors.length.toLocaleString("fa-IR")} سطر خطا داشت`
          : ""
      }.`,
    );
    return result;
  }

  async function importCoursesHandler(rows) {
    const result = await importCourses(rows);
    await loadFromServer({ silent: true });
    notify(
      `${result.created.toLocaleString("fa-IR")} درس ایمپورت شد${
        result.errors?.length
          ? ` و ${result.errors.length.toLocaleString("fa-IR")} سطر خطا داشت`
          : ""
      }.`,
    );
    return result;
  }

  async function createGroupLeave(payload) {
    const result = await createGroupLeaveRequest(payload);
    await refreshLeaveRequests();
    if (result.affectedRecords) await loadFromServer({ silent: true });
    await refreshNotifications();
    notify(
      `${result.created.toLocaleString("fa-IR")} درخواست گروهی ثبت شد${
        result.affectedRecords
          ? ` و ${result.affectedRecords.toLocaleString("fa-IR")} رکورد به «موجه» تغییر یافت`
          : ""
      }.`,
    );
    return result;
  }

  async function markLiveAttendance(sessionId, studentId, status) {
    await upsertAttendance({
      sessionId,
      studentId,
      status,
      method: "manual",
      reason: "ثبت از پنل زندهٔ کلاس",
    });
    return true;
  }

  async function createTicket(payload) {
    const created = await createTicketApi(payload);
    await refreshTickets();
    notify("درخواست پشتیبانی شما ثبت شد؛ مدیر سامانه به‌زودی پاسخ می‌دهد.");
    return created;
  }

  async function respondTicket(id, payload) {
    const updated = await respondTicketApi(id, payload);
    await refreshTickets();
    notify("پاسخ به درخواست شما ثبت شد.");
    return updated;
  }

  async function closeTicket(id) {
    const updated = await closeTicketApi(id);
    await refreshTickets();
    notify("این درخواست بسته شد.");
    return updated;
  }

  function studentDatabaseId(frontendId) {
    return students.find((item) => String(item.id) === String(frontendId))
      ?.databaseId;
  }

  function persistAttendance({
    frontendStudentId,
    status,
    method,
    sessionKey = sessionId,
    reason = "",
  }) {
    const session = sessionHistory[sessionKey];
    const dbSessionId = session?.databaseId;
    const dbStudentId = studentDatabaseId(frontendStudentId);
    if (!dbSessionId || !dbStudentId) {
      notify("برای ثبت در دیتابیس ابتدا جلسه را از تقویم ایجاد کنید.");
      return Promise.resolve(false);
    }
    return upsertAttendance({
      sessionId: dbSessionId,
      studentId: dbStudentId,
      status: toEnStatus(status),
      method,
      reason,
    })
      .then(() => {
        // For face recognition, sync without full reload to avoid blocking the scan loop
        if (method === "face") {
          const updated = attendanceRef.current.map((record) =>
            record.id === studentId
              ? { ...record, status: toEnStatus(status), method }
              : record,
          );
          attendanceRef.current = updated;
          setAttendance(updated);
        }
      })
      .catch((error) => {
        notify(error.message || "ذخیرهٔ حضور در دیتابیس انجام نشد.");
        return false;
      });
  }

  async function refreshBootstrapSilently() {
    try {
      await loadFromServer({ silent: true });
    } catch (error) {
      console.warn("Bootstrap refresh failed", error);
    }
  }

  useEffect(() => {
    if (!courses.length) return;
    if (!courses.some((course) => course.title === sessionCourse)) {
      setSessionCourse(courses[0].title);
    }
  }, [courses, sessionCourse]);

  async function migrateLocalData() {
    try {
      const result = await migrateBrowserSnapshot();
      notify(
        `${result.students.toLocaleString("fa-IR")} دانشجو، ${result.courses.toLocaleString("fa-IR")} کلاس، ${result.sessions.toLocaleString("fa-IR")} جلسه و ${result.attendance.toLocaleString("fa-IR")} رکورد حضور منتقل شد.`,
      );
    } catch (error) {
      notify(error.message || "انتقال داده به سرور انجام نشد.");
    }
  }
  function commitAttendance(update) {
    const next = update(attendanceRef.current);
    if (!writeStoredValue("smart-attendance:attendance", next)) {
      setStorageWarning(
        "ذخیرهٔ حضور در مرورگر انجام نشد؛ فضای ذخیره‌سازی را بررسی کنید و پیش از بستن صفحه پشتیبان بگیرید.",
      );
      return false;
    }
    attendanceRef.current = next;
    setAttendance(next);
    return true;
  }
  async function saveSettings() {
    const name = settings.name.trim();
    const lateAfterNumber = Number(settings.lateAfter);
    if (!name) {
      notify(
        "\u0646\u0627\u0645 \u0633\u0627\u0645\u0627\u0646\u0647 \u0631\u0627 \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f.",
      );
      return;
    }
    if (
      !Number.isFinite(lateAfterNumber) ||
      lateAfterNumber < 0 ||
      lateAfterNumber > 120
    ) {
      notify(
        "\u062d\u062f \u0645\u062c\u0627\u0632 \u062a\u0623\u062e\u06cc\u0631 \u0628\u0627\u06cc\u062f \u0639\u062f\u062f\u06cc \u0628\u06cc\u0646 \u0635\u0641\u0631 \u062a\u0627 \u06f1\u06f2\u06f0 \u0628\u0627\u0634\u062f.",
      );
      return;
    }
    const normalized = {
      ...settings,
      name,
      lateAfter: String(Math.round(lateAfterNumber)),
    };
    try {
      await saveSettingsPayload({
        systemName: normalized.name,
        lateAfterMinutes: Math.round(lateAfterNumber),
        notificationsEnabled: normalized.notifications !== false,
        faceRecognitionEnabled: normalized.faceRecognition !== false,
      });
      writeStoredValue("smart-attendance:settings", normalized);
      setSettings(normalized);
      notify("تنظیمات در دیتابیس ذخیره شد.");
    } catch (error) {
      notify(error.message || "ذخیرهٔ تنظیمات انجام نشد.");
    }
  }
  async function exportBackup() {
    try {
      let voiceProfiles = [];
      let voiceDataUnavailable = false;
      try {
        voiceProfiles = await exportAudioProfiles();
      } catch {
        voiceDataUnavailable = true;
      }
      const backup = {
        product: "hozorban",
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        data: {
          students,
          courses,
          attendance,
          sessionHistory,
          settings,
          theme,
          voiceProfiles,
        },
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `hozorban-backup-${getLocalDate()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify(
        voiceDataUnavailable
          ? "پشتیبان ساخته شد، اما ذخیره‌ساز صوت در دسترس نبود و نمونه‌های صوتی داخل فایل نیستند."
          : "نسخهٔ پشتیبان اطلاعات آماده شد.",
      );
    } catch {
      notify("ساخت نسخهٔ پشتیبان انجام نشد؛ فضای مرورگر را بررسی کنید.");
    }
  }
  async function restoreBackup(file) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024)
      return notify("حجم فایل پشتیبان بیش از ۳۰ مگابایت است.");
    try {
      const backup = JSON.parse(await file.text());
      const data = backup?.data;
      if (
        backup?.product !== "hozorban" ||
        backup?.schemaVersion !== 1 ||
        !data ||
        !Array.isArray(data.students) ||
        !Array.isArray(data.attendance) ||
        !data.sessionHistory ||
        typeof data.sessionHistory !== "object" ||
        Array.isArray(data.sessionHistory)
      )
        throw new Error("ساختار فایل پشتیبان معتبر نیست.");
      if (
        !data.students.every(
          (student) =>
            student && student.id != null && typeof student.name === "string",
        )
      )
        throw new Error("اطلاعات دانشجویان در فایل معتبر نیست.");
      if (
        !data.attendance.every(
          (record) =>
            record &&
            record.id != null &&
            typeof record.name === "string" &&
            typeof record.course === "string",
        )
      )
        throw new Error("رکوردهای حضور در فایل معتبر نیستند.");
      if (
        data.courses != null &&
        (!Array.isArray(data.courses) ||
          !data.courses.every(
            (course) =>
              course &&
              typeof course.id === "string" &&
              typeof course.title === "string",
          ))
      )
        throw new Error("اطلاعات درس‌ها و کلاس‌ها در فایل معتبر نیست.");
      if (
        !window.confirm(
          "اطلاعات فعلی با اطلاعات داخل فایل پشتیبان جایگزین شود؟",
        )
      )
        return;
      if (Array.isArray(data.voiceProfiles))
        await restoreAudioProfiles(data.voiceProfiles);
      setStudents(data.students);
      const restoredCourses = Array.isArray(data.courses) ? data.courses : [];
      setCourses(
        restoredCourses.map((course) => {
          const studentIds = Array.isArray(course.studentIds)
            ? course.studentIds.filter((id) =>
                data.students.some(
                  (student) => String(student.id) === String(id),
                ),
              )
            : [];
          return { ...course, studentIds, count: studentIds.length };
        }),
      );
      setAttendance(data.attendance);
      setSessionHistory(data.sessionHistory);
      if (data.settings && typeof data.settings === "object")
        setSettings((current) => ({ ...current, ...data.settings }));
      if (data.theme === "dark" || data.theme === "light") setTheme(data.theme);
      setStorageWarning("");
      notify(
        "بازیابی انجام شد. برای بارگذاری نمونه‌های صوتی بازیابی‌شده، صفحه را تازه‌سازی کنید.",
      );
    } catch (error) {
      notify(error?.message || "فایل انتخاب‌شده قابل بازیابی نیست.");
    }
  }
  async function saveMyPhoto(file) {
    const result = await uploadMyPhoto(file);
    await loadFromServer({ silent: true });
    if (result?.url) setProfilePhoto(result.url);
    return result;
  }
  function saveProfile(nextProfile) {
    const name = nextProfile.name.trim();
    if (!name) {
      notify("نام نمایشی را وارد کنید.");
      return;
    }
    const value = { name, photo: nextProfile.photo || "", role: loginRole };
    try {
      sessionStorage.setItem("smart-attendance:profile", JSON.stringify(value));
      setLoginName(name);
      setProfilePhoto(value.photo);
      notify("پروفایل برای نشست فعلی ذخیره شد.");
    } catch (error) {
      console.warn("Could not save session profile", error);
      notify("ذخیره پروفایل انجام نشد؛ تصویر کوچک‌تری انتخاب کنید.");
    }
  }
  function chooseRole(role) {
    setLoginRole(role);
    setLoginError("");
    setLoginName(
      role === "admin"
        ? "admin@hozorban.local"
        : role === "teacher"
          ? "teacher@hozorban.local"
          : "student@hozorban.local",
    );
  }
  async function changeFaculty(nextFacultyId) {
    if (!nextFacultyId || nextFacultyId === authUser?.faculty?.id) {
      setFacultySwitcherOpen(false);
      return;
    }
    setFacultySwitchPending(true);
    try {
      const result = await switchFaculty(nextFacultyId);
      setAuthUser(result.user);
      setFacultyId(nextFacultyId);
      setFacultySwitcherOpen(false);
      await loadFromServer({ silent: true });
      refreshNotifications().catch(() => {});
      notify(
        `دانشکده به «${result.user.faculty?.name || "دانشکدهٔ جدید"}» تغییر کرد.`,
      );
    } catch (error) {
      notify(error.message || "تغییر دانشکده انجام نشد.");
    } finally {
      setFacultySwitchPending(false);
    }
  }
  function go(id) {
    if (!allowedPages.has(id)) {
      notify("دسترسی به این بخش برای نقش کاربری شما فعال نیست.");
      return;
    }
    setActive(id);
    setMobileMenu(false);
    setQuery("");
  }

  async function addStudent(e) {
    e.preventDefault();

    const studentNumberValue = studentForm.id.trim();
    const fullName = studentForm.name.trim();

    if (!studentNumberValue || !fullName) {
      return notify("شماره دانشجویی و نام را وارد کنید.");
    }

    if (students.some((s) => s.id === studentNumberValue)) {
      return notify("این شماره دانشجویی قبلاً ثبت شده است.");
    }

    try {
      await api("/students", {
        method: "POST",
        body: JSON.stringify({
          studentNumber: studentNumberValue,
          fullName,
          major: studentForm.major || "",
          term: studentForm.term || "",
          phone: studentForm.phone || "",
          status: "active",
        }),
      });

      await loadFromServer({ silent: true });
      setStudentForm({
        id: "",
        name: "",
        major: "مهندسی کامپیوتر",
        term: "۳",
        phone: "",
      });

      setModal(false);
      notify("دانشجو با موفقیت در دیتابیس ذخیره شد.");
    } catch (error) {
      console.error("Add student error:", error);
      notify(error.message || "ثبت دانشجو با مشکل مواجه شد.");
    }
  }

  async function addCourse(course) {
    const normalizedId = String(course.id || "")
      .trim()
      .toLocaleUpperCase("en-US");
    const normalizedTitle = String(course.title || "")
      .trim()
      .toLocaleLowerCase("fa-IR");
    if (
      courses.some(
        (item) =>
          item.id.toLocaleUpperCase("en-US") === normalizedId ||
          item.title.trim().toLocaleLowerCase("fa-IR") === normalizedTitle,
      )
    ) {
      notify("کد یا نام این درس قبلاً ثبت شده است.");
      return false;
    }
    const memberDatabaseIds = [
      ...new Set(
        (course.studentIds || [])
          .map((id) => studentDatabaseId(id))
          .filter(Boolean),
      ),
    ];
    if (!memberDatabaseIds.length) {
      notify("برای کلاس حداقل یک دانشجوی فعال انتخاب کنید.");
      return false;
    }
    try {
      await createCourse({
        code: normalizedId,
        title: String(course.title || "").trim(),
        teacherName: String(course.teacher || "").trim(),
        room: course.room || "",
        weekday: course.day || "",
        startTime: course.startTime || null,
        endTime: course.endTime || null,
        studentIds: memberDatabaseIds,
      });
      await loadFromServer({ silent: true });
      notify("درس و کلاس در دیتابیس ثبت شد و در تقویم جلسه‌ها در دسترس است.");
      return true;
    } catch (error) {
      notify(error.message || "ثبت درس انجام نشد.");
      return false;
    }
  }
  function setAttendanceStatus(id, status, course, sessionId, reason = "") {
    const now = new Date();
    const targetSessionId = sessionId || course + "::" + getLocalDate();
    const session = sessionHistory[targetSessionId];
    const student = students.find((item) => String(item.id) === String(id));
    const note = String(reason || "").trim();
    const time =
      status === "غایب" || status === "غیبت موجه"
        ? "—"
        : new Intl.DateTimeFormat("fa-IR", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(now);
    const committed = commitAttendance((previous) => {
      const index = previous.findIndex(
        (record) =>
          String(record.id ?? record.studentId) === String(id) &&
          record.course === course &&
          (sessionId ? record.sessionId === sessionId : !record.sessionId),
      );
      const existing = index >= 0 ? previous[index] : null;
      if (!existing && !student) return previous;
      const record = {
        ...(existing || {}),
        id: student?.id ?? existing?.id ?? id,
        name: student?.name || existing?.name || "",
        course,
        sessionId: targetSessionId,
        sessionDate:
          session?.date || targetSessionId.split("::").at(-1) || getLocalDate(),
        teacher:
          session?.teacher ||
          existing?.teacher ||
          courses.find((item) => item.title === course)?.teacher ||
          loginName,
        status,
        time,
        method: "manual",
        history: [
          ...(existing?.history || []),
          {
            from: existing?.status || "ثبت‌نشده",
            to: status,
            changedAt: now.toISOString(),
            changedBy: loginName,
            reason: note,
            method: "manual",
          },
        ],
        updatedAt: now.toISOString(),
      };
      return index >= 0
        ? previous.map((item, itemIndex) =>
            itemIndex === index ? record : item,
          )
        : [record, ...previous];
    });
    if (!committed) return;
    setSessionHistory((current) => ({
      ...current,
      [targetSessionId]: {
        ...current[targetSessionId],
        id: targetSessionId,
        course,
        date:
          current[targetSessionId]?.date ||
          targetSessionId.split("::").at(-1) ||
          getLocalDate(),
        audit: [
          ...(current[targetSessionId]?.audit || []),
          {
            studentId: id,
            status,
            changedAt: now.toISOString(),
            changedBy: loginName,
            reason: note,
            method: "manual",
          },
        ],
      },
    }));
    persistAttendance({
      frontendStudentId: id,
      status,
      method: "manual",
      sessionKey: targetSessionId,
      reason: note,
    });
  }
  async function refreshCameras({
    requestPermission = false,
    preferBuiltIn = false,
  } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    if (requestPermission) {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const list = devices.filter(
      (device) => device.kind === "videoinput" && device.deviceId,
    );
    setCameras(list);
    setSelectedCameraId((current) => {
      if (
        !preferBuiltIn &&
        current &&
        list.some((device) => device.deviceId === current)
      )
        return current;
      const laptop = list.find((device) =>
        /integrated|built.?in|internal|laptop|front camera/i.test(
          device.label || "",
        ),
      );
      const preferred = laptop || list[0];
      const id = preferred?.deviceId || "";
      return id;
    });
    return list;
  }
  useEffect(() => {
    refreshCameras().catch(() => {});
    const handleDeviceChange = () => refreshCameras().catch(() => {});
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      handleDeviceChange,
    );
    return () =>
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        handleDeviceChange,
      );
  }, []);
  async function startCamera(
    deviceId = selectedCameraId,
    forceLaptopCamera = false,
  ) {
    if (typeof deviceId !== "string") deviceId = selectedCameraId;
    const friendlyCameraError = (error) => {
      const name = error?.name || "";
      if (
        name === "NotAllowedError" ||
        name === "PermissionDeniedError" ||
        name === "SecurityError"
      ) {
        return "مرورگر اجازهٔ دوربین را نمی‌دهد. کنار نوار آدرس روی قفل/تنظیمات سایت بزنید و Camera را روی Allow بگذارید؛ سپس در Windows Settings > Privacy & security > Camera، گزینه‌های Camera access و Let desktop apps access your camera را روشن کنید و صفحه را Refresh کنید.";
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return "وب‌کم پیدا نشد. مطمئن شوید دوربین داخلی لپ‌تاپ در Device Manager فعال است و کلید فیزیکی/کلید Fn دوربین خاموش نیست.";
      }
      if (name === "NotReadableError" || name === "TrackStartError") {
        return "وب‌کم در برنامهٔ دیگری در حال استفاده است. برنامه‌هایی مثل Camera، Zoom، Teams، OBS، DroidCam یا Camo را ببندید و دوباره امتحان کنید.";
      }
      if (
        name === "OverconstrainedError" ||
        name === "ConstraintNotSatisfiedError"
      ) {
        return "وب‌کم داخلی شناسایی شد، اما مرورگر نتوانست آن را باز کند. صفحه را Refresh کنید و دوباره تلاش کنید.";
      }
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        return "دوربین فقط در آدرس امن کار می‌کند. پروژه را با npm run dev اجرا کنید و آدرس http://localhost:5173 را باز کنید؛ از IP شبکه یا فایل مستقیم App.jsx استفاده نکنید.";
      }
      return `خطای دوربین: ${error?.message || name || "نامشخص"}. مجوز مرورگر و تنظیمات دوربین ویندوز را بررسی کنید.`;
    };

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      return notify(
        "دوربین در این آدرس قابل دسترسی نیست. ترمینال را در پوشهٔ پروژه باز کنید، npm run dev بزنید و آدرس localhost که Vite نمایش می‌دهد (معمولاً http://localhost:5173) را باز کنید.",
      );
    }

    setCameraState("connecting");
    try {
      // مجوز دوربین را می‌گیریم تا مرورگر نام دستگاه‌ها را نشان دهد.
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());

      const hadSavedChoice =
        !forceLaptopCamera &&
        Boolean(readStoredValue("smart-attendance:camera-device", ""));
      const availableCameras = await refreshCameras({
        preferBuiltIn: forceLaptopCamera || (!hadSavedChoice && !deviceId),
      });

      if (availableCameras.length === 0) {
        throw new DOMException(
          "هیچ دوربینی توسط مرورگر شناسایی نشد.",
          "NotFoundError",
        );
      }

      const laptopCameraPattern =
        /integrated|built.?in|internal|laptop|hd webcam|user.?facing|front camera/i;
      const chosenCamera =
        (hadSavedChoice &&
          availableCameras.find((camera) => camera.deviceId === deviceId)) ||
        availableCameras.find((camera) =>
          laptopCameraPattern.test(camera.label || ""),
        ) ||
        availableCameras[0];
      if (!forceLaptopCamera) {
        setSelectedCameraId(chosenCamera.deviceId);
        writeStoredValue(
          "smart-attendance:camera-device",
          chosenCamera.deviceId,
        );
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());

      // قید exact مانع از انتخاب خودکار دوربین دیگری می‌شود.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: chosenCamera.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraState("live");
      notify(`دوربین متصل شد: ${chosenCamera.label || "دوربین انتخاب‌شده"}`);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraState("error");
      notify(friendlyCameraError(error));
    }
  }
  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState("idle");
  }
  function selectCamera(deviceId) {
    setSelectedCameraId(deviceId);
    writeStoredValue("smart-attendance:camera-device", deviceId);
    if (cameraState === "live") startCamera(deviceId);
  }
  async function saveStudentPhoto(studentId, files) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    const file = selectedFiles[0];
    if (!file.type.startsWith("image/")) return notify("فایل تصویری معتبری انتخاب نشد.");
    const dbId = studentDatabaseId(studentId);
    if (!dbId) return notify("شناسهٔ دیتابیسی دانشجو پیدا نشد.");
    try {
      await uploadStudentPhoto(dbId, file);
      await loadFromServer({ silent: true });
      notify(
        "عکس پروفایل دانشجو ذخیره شد؛ همین عکس در تشخیص چهره و همهٔ بخش‌های پروژه استفاده می‌شود.",
      );
    } catch (error) {
      notify(error.message || "ذخیره عکس انجام نشد. لطفاً تصاویر دیگری انتخاب کنید.");
    }
  }
  function markFaceAttendance(
    studentId,
    status,
    { silent = false, method = "manual" } = {},
  ) {
    const student = students.find(
      (item) => String(item.id) === String(studentId),
    );
    if (!student) return false;
    const session = sessionHistory[sessionId];
    if (
      session?.studentIds?.length &&
      !session.studentIds.some((id) => String(id) === String(studentId))
    ) {
      notify(`${student.name} در فهرست این جلسه نیست.`);
      return false;
    }
    const now = new Date();
    const [year, month, day] = sessionDate.split("-").map(Number);
    const [startHour = 0, startMinute = 0] = (session?.startTime || "00:00")
      .split(":")
      .map(Number);
    const [endHour = 23, endMinute = 59] = (session?.endTime || "23:59")
      .split(":")
      .map(Number);
    const start = new Date(year, month - 1, day, startHour, startMinute);
    const end = new Date(year, month - 1, day, endHour, endMinute);
    const openAt = new Date(
      start.getTime() - Number(session?.openBeforeMinutes ?? 15) * 60_000,
    );
    const closeAt = new Date(
      end.getTime() + Number(session?.closeAfterMinutes ?? 30) * 60_000,
    );
    if (now < openAt || now > closeAt) {
      notify("ثبت خودکار حضور خارج از بازهٔ مجاز این جلسه است.");
      return false;
    }
    const grace = Number(session?.graceMinutes ?? settings.lateAfter ?? 10);
    const finalStatus =
      status === PRESENT_STATUS &&
      now > new Date(start.getTime() + grace * 60_000)
        ? "تأخیر"
        : status;
    const time = new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);
    const committed = commitAttendance((current) => {
      const index = current.findIndex(
        (item) =>
          item.sessionId === sessionId &&
          String(item.id ?? item.studentId) === String(studentId),
      );
      const previousRecord = index >= 0 ? current[index] : null;
      const history = [
        ...(previousRecord?.history || []),
        {
          from: previousRecord?.status || "ثبت‌نشده",
          to: finalStatus,
          changedAt: now.toISOString(),
          changedBy: loginName,
          reason: "ثبت خودکار حضور",
        },
      ];
      const record = {
        id: student.id,
        name: student.name,
        course: sessionCourse,
        sessionId,
        sessionDate,
        time,
        teacher:
          session?.teacher ||
          courses.find((item) => item.title === sessionCourse)?.teacher ||
          loginName,
        status: finalStatus,
        method,
        history,
      };
      return index >= 0
        ? current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, ...record } : item,
          )
        : [record, ...current];
    });
    if (!committed) {
      notify(
        "ثبت حضور در ذخیره‌ساز مرورگر انجام نشد؛ فضای ذخیره‌سازی را بررسی کنید.",
      );
      return false;
    }
    setSessionHistory((current) => ({
      ...current,
      [sessionId]: {
        ...current[sessionId],
        id: sessionId,
        course: sessionCourse,
        date: sessionDate,
        teacher:
          current[sessionId]?.teacher ||
          courses.find((item) => item.title === sessionCourse)?.teacher ||
          loginName,
        studentIds: current[sessionId]?.studentIds?.length
          ? current[sessionId].studentIds
          : students
              .filter((item) => item.status !== "غیرفعال")
              .map((item) => item.id),
        updatedAt: new Date().toISOString(),
        started: true,
        audit: [
          ...(current[sessionId]?.audit || []),
          {
            studentId: student.id,
            status: finalStatus,
            changedAt: now.toISOString(),
            changedBy: loginName,
            reason:
              method === "voice"
                ? "ثبت با تشخیص صدا"
                : method === "fingerprint"
                  ? "ثبت با اثر انگشت"
                  : method === "face"
                    ? "ثبت با تشخیص چهره"
                    : "ثبت خودکار حضور",
            method,
          },
        ],
      },
    }));
    if (!silent) notify(`${student.name}: ${finalStatus} ثبت شد.`);
    persistAttendance({
      frontendStudentId: student.id,
      status: finalStatus,
      method,
      sessionKey: sessionId,
      reason:
        method === "voice"
          ? "ثبت با تشخیص صدا"
          : method === "fingerprint"
            ? "ثبت با اثر انگشت"
            : method === "face" || method === "class_camera"
              ? "ثبت با تشخیص چهره"
              : "ثبت دستی",
    });
    return true;
  }
  function studentsForActiveSession() {
    const course = courses.find((item) => item.title === sessionCourse);
    const sessionRoster = sessionHistory[sessionId]?.studentIds;
    const roster =
      Array.isArray(sessionRoster) && sessionRoster.length
        ? sessionRoster
        : course?.studentIds;
    return students.filter(
      (student) =>
        !Array.isArray(roster) ||
        roster.length === 0 ||
        roster.includes(student.id),
    );
  }
  async function checkFingerprintEnrollment(studentId) {
    const databaseId = studentDatabaseId(studentId) || String(studentId);
    const payload = await fetchFingerprintCredentials(databaseId);
    const credentials = payload?.credentials || [];
    const credential =
      credentials.find(
        (item) => String(item.studentId) === String(databaseId),
      ) || null;
    return { enrolled: Boolean(credential), credential };
  }
  async function startFingerprintRegistration(studentId) {
    const databaseId = studentDatabaseId(studentId);
    if (!databaseId) {
      throw new Error("شناسهٔ دیتابیس این دانشجو یافت نشد؛ صفحه را دوباره بارگذاری کنید.");
    }
    return startFingerprintRegistrationApi(String(databaseId));
  }
  async function finishFingerprintRegistration(studentId, response) {
    const databaseId = studentDatabaseId(studentId);
    if (!databaseId) {
      throw new Error("شناسهٔ دیتابیس این دانشجو یافت نشد؛ صفحه را دوباره بارگذاری کنید.");
    }
    const payload = await finishFingerprintRegistrationApi(
      String(databaseId),
      response,
    );
    await refreshFingerprintEnrollments();
    return payload;
  }
  async function startFingerprintAuthentication(sessionId) {
    const payload = await startFingerprintAuthenticationApi(sessionId);
    return payload;
  }
  async function finishFingerprintAuthentication(sessionId, response) {
    const payload = await finishFingerprintAuthenticationApi(sessionId, response);
    const databaseId = payload?.student?.id;
    const linkedStudent = databaseId
      ? students.find(
          (item) => String(item.databaseId) === String(databaseId),
        )
      : null;
    return { ...payload, frontendStudentId: linkedStudent?.id || null };
  }
  async function revokeFingerprintCredential(credentialId) {
    const payload = await revokeFingerprintCredentialApi(String(credentialId));
    await refreshFingerprintEnrollments();
    return payload;
  }
  async function checkMyFingerprint() {
    const payload = await fetchMyFingerprintCredentials();
    const credentials = payload?.credentials || [];
    const currentUserId = getApiUser()?.id || "";
    const credential =
      credentials.find(
        (item) => item.userId && String(item.userId) === String(currentUserId),
      ) || credentials[0] || null;
    return { enrolled: Boolean(credential), credential };
  }
  async function startMyFingerprintRegistration() {
    const payload = await startMyFingerprintRegistrationApi();
    return payload;
  }
  async function finishMyFingerprintRegistration(response) {
    const payload = await finishMyFingerprintRegistrationApi(response);
    await refreshFingerprintEnrollments();
    return payload;
  }
  async function refreshFingerprintEnrollments() {
    try {
      const payload = await fetchFingerprintCredentials();
      setFingerprintCredentials(payload?.credentials || []);
    } catch {
      /* خطا در لیست اثر انگشت نباید پنل را بکشد */
    }
  }
  function openSession(event) {
    if (!event?.id) return;
    setSessionCourse(event.course);
    setSessionDate(event.date);
    const now = new Date().toISOString();
    const session = {
      ...event,
      started: true,
      startedAt: event.startedAt || now,
      updatedAt: now,
      teacher:
        event.teacher ||
        courses.find((item) => item.title === event.course)?.teacher ||
        loginName,
    };
    setSessionHistory((current) => ({ ...current, [event.id]: session }));
    const roster = event.studentIds?.length
      ? event.studentIds
      : students
          .filter((student) => student.status !== "غیرفعال")
          .map((student) => student.id);
    const pendingIds = [];
    const committed = commitAttendance((current) => {
      const records = [...current];
      roster.forEach((studentId) => {
        const student = students.find((item) => item.id === studentId);
        if (!student) return;
        const index = records.findIndex(
          (record) =>
            record.sessionId === event.id && record.id === studentId,
        );
        const existing = index >= 0 ? records[index] : null;
        // فقط رکوردهای ثبت‌نشده یا هنوز همگام‌نشده به «غایب» تبدیل می‌شوند؛
        // حضور/تأخیر ثبت‌شده دست‌نخورده می‌ماند.
        const needsAbsent =
          !existing ||
          !existing.databaseId ||
          existing.status === "ثبت‌نشده";
        if (!needsAbsent) return;
        pendingIds.push(studentId);
        // پیش‌فرض همه «غایب» است؛ فقط تشخیص چهره یا ثبت دستی آن را تغییر می‌دهد.
        const record = {
          ...(existing || {}),
          id: student.id,
          name: student.name,
          course: event.course,
          sessionId: event.id,
          sessionDate: event.date,
          time: existing?.time || "—",
          status: ABSENT_STATUS,
          method: "system",
          teacher: session.teacher,
          history: [
            ...(existing?.history || []),
            {
              from: existing?.status || "—",
              to: ABSENT_STATUS,
              changedAt: now,
              changedBy: loginName,
              reason: "پیش‌فرض ابتدای جلسه",
              method: "system",
            },
          ],
        };
        if (index >= 0) records[index] = record;
        else records.unshift(record);
      });
      return records;
    });
    if (!committed) {
      notify(
        "فهرست حضور جلسه ذخیره نشد؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.",
      );
      return;
    }
    if (session.databaseId && event.studentIds?.length) {
      absentsSeededRef.current.add(event.id);
      seedSessionAbsents(session.databaseId, pendingIds);
    }
    go("face");
  }

  /**
   * وضعیت پیش‌فرض «غایب» را برای اعضای جلسه در دیتابیس می‌نشاند تا بعد از هر
   * بارگذاری از سرور هم همین وضعیت پایدار بماند (رکورد فقط با تشخیص چهره یا
   * ثبت دستی تغییر می‌کند).
   */
  function seedSessionAbsents(dbSessionId, frontendIds) {
    const dbIds = [
      ...new Set(
        [...new Set(frontendIds)]
          .map((frontendId) => studentDatabaseId(frontendId))
          .filter(Boolean),
      ),
    ];
    if (!dbIds.length) return;
    // اجرای پلکانی (۸ درخواست هم‌زمان) تا سرور و شبکه تحت فشار قرار نگیرد.
    const CHUNK = 8;
    const run = async () => {
      for (let index = 0; index < dbIds.length; index += CHUNK) {
        await Promise.all(
          dbIds.slice(index, index + CHUNK).map((dbStudentId) =>
            upsertAttendance({
              sessionId: dbSessionId,
              studentId: dbStudentId,
              status: "absent",
              method: "system",
              reason: "پیش‌فرض ابتدای جلسه",
            }).catch((error) => {
              console.warn("Could not seed absent record", error);
              return null;
            }),
          ),
        );
      }
      await loadFromServer({ silent: true });
    };
    run().catch((error) => console.warn("Seed absent failed", error));
  }

  /** هر جلسه فقط یک‌بار وضعیت پیش‌فرض «غایب» را برای اعضایش در دیتابیس می‌نشاند. */
  function ensureSessionAbsents(sessionKey) {
    if (absentsSeededRef.current.has(sessionKey)) return;
    const session = sessionHistory[sessionKey];
    if (!session?.databaseId || !session.studentIds?.length) return;
    absentsSeededRef.current.add(sessionKey);
    const pending = session.studentIds.filter((frontendId) => {
      const record = attendanceRef.current.find(
        (item) =>
          item.sessionId === sessionKey &&
          String(item.id) === String(frontendId),
      );
      return !record || !record.databaseId || record.status === "ثبت‌نشده";
    });
    if (pending.length)
      seedSessionAbsents(session.databaseId, pending);
  }

  // با ورود به بخش تشخیص چهره/دوربین کلاس، همهٔ اعضا ابتدا غایب‌اند و فقط
  // تشخیص چهره (با پلک) یا ثبت دستی می‌تواند وضعیت را تغییر دهد.
  useEffect(() => {
    if (active === "face" || active === "class-camera")
      ensureSessionAbsents(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId]);
  useEffect(() => {
    if (active !== "fingerprint") return undefined;
    let cancelled = false;
    refreshFingerprintEnrollments().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  async function finalizeSession(id) {
    const session = sessionHistory[id];
    if (!session) return;
    const now = new Date().toISOString();
    const committed = commitAttendance((current) =>
      current.map((record) =>
        record.sessionId === id && record.status === "ثبت‌نشده"
          ? {
              ...record,
              status: "غایب",
              method: "system",
              history: [
                ...(record.history || []),
                {
                  from: "ثبت‌نشده",
                  to: "غایب",
                  changedAt: now,
                  changedBy: loginName,
                  reason: "پایان جلسه",
                  method: "system",
                },
              ],
            }
          : record,
      ),
    );
    if (!committed) {
      notify("پایان جلسه انجام نشد چون ذخیرهٔ حضور ممکن نبود.");
      return;
    }
    setSessionHistory((current) => ({
      ...current,
      [id]: {
        ...current[id],
        finalized: true,
        finalizedAt: now,
        updatedAt: now,
      },
    }));
    if (session.databaseId) {
      try {
        const result = await finalizeSessionApi(session.databaseId);
        await loadFromServer({ silent: true });
        notify(
          `جلسه پایان یافت؛ ${Number(result?.absent || 0).toLocaleString("fa-IR")} نفر غایب ثبت شد.`,
        );
        return;
      } catch (error) {
        notify(error.message || "پایان جلسه در دیتابیس ثبت نشد.");
        return;
      }
    }
    notify("جلسه پایان یافت و وضعیت‌های ثبت‌نشده غیبت خوردند.");
  }
  function exportCsv(records = attendance) {
    const rows = [
      [
        "شماره دانشجویی",
        "نام دانشجو",
        "درس",
        "تاریخ جلسه",
        "استاد",
        "ساعت",
        "وضعیت",
        "تاریخچه تغییر",
      ],
      ...records.map((record) => [
        record.id,
        record.name,
        record.course,
        record.sessionDate || sessionHistory[record.sessionId]?.date || "",
        record.teacher || sessionHistory[record.sessionId]?.teacher || "",
        record.time,
        record.status,
        (record.history || [])
          .map(
            (entry) =>
              `${entry.from} ← ${entry.to} (${entry.changedBy}${entry.reason ? `: ${entry.reason}` : ""})`,
          )
          .join(" | "),
      ]),
    ];
    const csv =
      "\ufeff" +
      rows
        .map((r) =>
          r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
        )
        .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance-report.csv";
    a.click();
    URL.revokeObjectURL(url);
    notify("فایل گزارش آماده شد.");
  }

  if (login)
    return (
      <div className="login-screen">
        <button
          className="icon-button theme-toggle login-theme-toggle"
          type="button"
          aria-label={
            theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تیره"
          }
          title={theme === "dark" ? "تم روشن" : "تم تیره"}
          onClick={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
        >
          <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
        </button>
        <div className="login-art">
          <div className="login-brand">
            <span className="brand-mark">
              <Icon name="bi-fingerprint" />
            </span>
            <span>حضوربان</span>
          </div>
          <div className="login-hero">
            <div className="hero-orb orb-one" />
            <div className="hero-orb orb-two" />
            <div className="hero-card">
              <div className="hero-card-top">
                <span className="live-dot" /> گزارش امروز{" "}
                <span className="hero-date">۱۴۰۵/۰۷/۲۶</span>
              </div>
              <div className="hero-big-number">۹۲٪</div>
              <div className="hero-progress">
                <span />
              </div>
              <div className="hero-card-bottom">
                <span>
                  <i className="bi bi-people" /> ۲۸ دانشجو
                </span>
                <span>
                  <i className="bi bi-check-circle" /> ۲۶ حاضر
                </span>
              </div>
            </div>
            <div className="floating-chip chip-a">
              <Icon name="bi-shield-check" /> حضور امن و دقیق
            </div>
            <div className="floating-chip chip-b">
              <Icon name="bi-camera" /> تشخیص چهره
            </div>
          </div>
          <div className="login-art-bottom">
            <span>مدیریت هوشمند کلاس‌ها</span>
            <span>نسخه نمایشی ۱.۰</span>
          </div>
        </div>
        <div className="login-form-wrap">
          <form
            className="login-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setLoginError("");
              if (!facultyId) {
                setLoginError("لطفاً دانشکده را انتخاب کنید.");
                return;
              }
              setLoginPending(true);
              try {
                const result = await signIn(
                  loginName.trim(),
                  loginPassword,
                  facultyId,
                );
                setAuthUser(result.user);

                try {
                  await loadFromServer({ silent: true });
                  notify(
                    "اتصال به PostgreSQL برقرار شد و اطلاعات از دیتابیس بارگذاری شد.",
                  );
                } catch (apiError) {
                  console.error("Bootstrap error:", apiError);
                  notify(
                    "ورود موفق بود، اما دریافت اطلاعات دیتابیس با مشکل مواجه شد.",
                  );
                }
                const signedInName = result.user.name;
                const signedInStudentId = result.user.studentId || "";
                setLoginName(signedInName);
                setLoginRole(result.user.role);
                setStudentNumber(signedInStudentId);
                setProfilePhoto(result.user.avatarUrl || "");
                sessionStorage.setItem(
                  "smart-attendance:profile",
                  JSON.stringify({
                    name: signedInName,
                    role: result.user.role,
                    userId: result.user.id,
                    email: loginName.trim().toLowerCase(),
                    studentId: signedInStudentId,
                  }),
                );
                setLoginPassword("");
                setLogin(false);
                refreshTickets().catch(() => {});
                refreshNotifications().catch(() => {});
                refreshLeaveRequests().catch(() => {});
                refreshObjections().catch(() => {});
              } catch (error) {
                setLoginError(error.message || "ورود به سامانه انجام نشد.");
              } finally {
                setLoginPending(false);
              }
              return;
            }}
          >
            <div className="mobile-login-brand">
              <span className="brand-mark">
                <Icon name="bi-fingerprint" />
              </span>{" "}
              حضوربان
            </div>
            <span className="eyebrow">خوش آمدید</span>
            <h1>
              {loginRole === "admin"
                ? "ورود به پنل مدیریت"
                : loginRole === "teacher"
                  ? "ورود به پنل استاد"
                  : "ورود به پنل دانشجویی"}
            </h1>
            <p className="login-subtitle">
              {loginRole === "admin"
                ? "برای مدیریت سامانه، کاربران و گزارش‌ها وارد شوید."
                : loginRole === "teacher"
                  ? "برای مدیریت جلسات و ثبت حضور و غیاب کلاس‌ها وارد شوید."
                  : "برای مشاهدهٔ وضعیت حضور و درس‌های خود وارد شوید."}
            </p>
            <label className="form-label" htmlFor="faculty">
              نام دانشکده
            </label>
            <FacultySelect
              id="faculty"
              value={facultyId}
              onChange={setFacultyId}
              options={faculties}
              disabled={!faculties.length}
            />
            <label className="form-label" htmlFor="access-role">
              {"\u0646\u0648\u0639 \u062f\u0633\u062a\u0631\u0633\u06cc"}
            </label>
            <AccessRoleSelect value={loginRole} onChange={chooseRole} />
            <label className="form-label" htmlFor="username">
              نام کاربری
            </label>
            <div className="input-icon-wrap">
              <Icon name="bi-person" />
              <input
                id="username"
                className="form-control"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="نام کاربری خود را وارد کنید"
                required
              />
            </div>
            <label className="form-label mt-3" htmlFor="password">
              رمز عبور
            </label>
            <div className="input-icon-wrap">
              <Icon name="bi-lock" />
              <input
                id="password"
                className="form-control"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="رمز عبور"
                required
              />
            </div>
            {loginError && (
              <p className="login-error" role="alert">
                {loginError}
              </p>
            )}
            <div className="login-hint">
              <Icon name="bi-info-circle" /> حساب‌های نمایشی: admin@hozorban.local /
              Admin@123456 &nbsp;·&nbsp; teacher@hozorban.local / Teacher@123456
              &nbsp;·&nbsp; student@hozorban.local / Student@123456
            </div>
            <button
              className="btn btn-primary w-100 login-submit"
              type="submit"
              disabled={loginPending}
            >
              ورود به سامانه <Icon name="bi-arrow-left-short" />
            </button>
            <button
              className="btn btn-light-outline w-100"
              type="button"
              onClick={() => setRegModal(true)}
            >
              <Icon name="bi-person-plus" /> ثبت‌نام دانشجوی جدید
            </button>
            <div className="login-footer">
              © ۱۴۰۵ حضوربان · سامانه مدیریت حضور و غیاب
            </div>
          </form>
        </div>
        {regModal && (
          <div
            className="modal-backdrop-custom"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !regPending)
                setRegModal(false);
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
                  <div className="eyebrow">ثبت‌نام دانشجو</div>
                  <h3>فرم ثبت‌نام</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  disabled={regPending}
                  onClick={() => setRegModal(false)}
                >
                  <Icon name="bi-x-lg" />
                </button>
              </div>
              <label className="form-label" htmlFor="reg-faculty">
                نام دانشکده
              </label>
              <FacultySelect
                id="reg-faculty"
                value={regForm.facultyId || facultyId}
                onChange={(nextFacultyId) =>
                  setRegForm((current) => ({
                    ...current,
                    facultyId: nextFacultyId,
                  }))
                }
                options={faculties}
                disabled={regPending || !faculties.length}
              />
              <div className="course-form-grid">
                {[
                  ["fullName", "نام و نام خانوادگی", "text"],
                  ["username", "نام کاربری (ایمیل)", "email"],
                  ["password", "رمز عبور", "password"],
                  ["nationalId", "کد ملی", "text"],
                  ["major", "رشته", "text"],
                  ["term", "ترم", "text"],
                  ["phone", "تلفن", "text"],
                ].map(([key, label, type]) => (
                  <label className="form-label" key={key}>
                    {label}
                    <input
                      className="form-control"
                      type={type}
                      value={regForm[key]}
                      disabled={regPending}
                      onChange={(e) =>
                        setRegForm((c) => ({ ...c, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="modal-actions" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  disabled={regPending}
                  onClick={async () => {
                    const selectedRegistrationFaculty =
                      regForm.facultyId || facultyId;
                    if (!selectedRegistrationFaculty) {
                      notify("لطفاً دانشکده را انتخاب کنید.");
                      return;
                    }
                    setRegPending(true);
                    try {
                      await createRegistration({
                        ...regForm,
                        facultyId: selectedRegistrationFaculty,
                      });
                      notify("درخواست ثبت‌نام ارسال شد؛ پس از تأیید مدیر می‌توانید وارد شوید.");
                      setRegModal(false);
                      setRegForm({
                        fullName: "",
                        username: "",
                        password: "",
                        facultyId: "",
                        nationalId: "",
                        major: "",
                        term: "",
                        phone: "",
                      });
                    } catch (error) {
                      notify(error.message || "ارسال درخواست انجام نشد.");
                    } finally {
                      setRegPending(false);
                    }
                  }}
                >
                  ارسال درخواست
                </button>
                <button
                  className="btn btn-light"
                  disabled={regPending}
                  onClick={() => setRegModal(false)}
                >
                  انصراف
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    );

  if (loginRole === "student") {
    return (
      <StudentPortal
        student={studentAccount}
        records={studentRecords}
        courses={courses}
        photo={profilePhoto}
        theme={theme}
        onUploadPhoto={saveMyPhoto}
        onCheckMyFingerprint={checkMyFingerprint}
        onStartMyFingerprintRegistration={startMyFingerprintRegistration}
        onFinishMyFingerprintRegistration={finishMyFingerprintRegistration}
        onToggleTheme={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        onLogout={() => {
          setLogin(true);
          setLoginName("student@hozorban.local");
          setLoginPassword("");
        }}
        tickets={tickets}
        onCreateTicket={createTicket}
        onRefreshTickets={refreshTickets}
        leaveRequests={leaveRequests}
        onCreateLeave={submitLeaveRequest}
        onRefreshLeaveRequests={refreshLeaveRequests}
        onCreateObjection={submitObjection}
        notifications={notifications}
        onMarkNotificationRead={readNotification}
        onMarkAllNotificationsRead={readAllNotifications}
        sessions={studentSessions}
        onLoadTrend={fetchAttendanceTrend}
      />
    );
  }

  return (
    <div className="app-shell">
      {mobileMenu && (
        <button
          className="mobile-overlay"
          aria-label="بستن منو"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">
            <Icon name="bi-fingerprint" />
          </span>
          <div>
            <strong>حضوربان</strong>
            <small>سامانه هوشمند آموزشی</small>
          </div>
          <button
            className="sidebar-close"
            onClick={() => setMobileMenu(false)}
          >
            <Icon name="bi-x-lg" />
          </button>
        </div>
        <div className="workspace-wrap" ref={facultySwitcherRef}>
          <div className="workspace-switch">
            <span className="workspace-icon">
              <Icon name="bi-mortarboard-fill" />
            </span>
            <div>
              <strong>{currentFaculty?.name || "دانشکده"}</strong>
              <small>
                {loginRole === "admin" ? "پنل مدیریت آموزشی" : "پنل استاد"}
              </small>
            </div>
            {canSwitchFaculty ? (
              <button
                className="workspace-toggle"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={facultySwitcherOpen}
                aria-label="تغییر دانشکده"
                disabled={facultySwitchPending}
                onClick={() => setFacultySwitcherOpen((value) => !value)}
              >
                <Icon name="bi-chevron-down" className="workspace-chevron" />
              </button>
            ) : null}
          </div>
          {canSwitchFaculty && facultySwitcherOpen && (
            <div
              className="workspace-menu"
              role="listbox"
              aria-label="دانشکده‌های من"
            >
              <div className="workspace-menu-title">دانشکده‌های شما</div>
              {switchableFaculties.map((faculty) => {
                const isCurrent = faculty.id === authUser?.faculty?.id;
                return (
                  <button
                    key={faculty.id}
                    className={`workspace-option${isCurrent ? " is-current" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    disabled={facultySwitchPending || isCurrent}
                    onClick={() => changeFaculty(faculty.id)}
                  >
                    <Icon
                      name={isCurrent ? "bi-check-circle-fill" : "bi-mortarboard"}
                    />
                    <span>{faculty.name}</span>
                    {isCurrent && <small>فعال</small>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <nav className="side-nav">
          {visibleNavGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-link-custom ${active === item.id ? "active" : ""}`}
                  onClick={() => go(item.id)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.id === "face" && <span className="nav-new">AI</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <Icon name="bi-headset" />
            </div>
            <strong>به راهنمایی نیاز دارید؟</strong>
            <p>دستیار هوشمند، پاسخ سؤال‌های شما را می‌دهد.</p>
            <button onClick={() => setHelpOpen(true)}>
              گفت‌وگو با دستیار <Icon name="bi-arrow-left" />
            </button>
          </div>
          <div className="sidebar-version">
            <span className="version-dot" /> نسخه ۱.۰.۰{" "}
            <span>نسخه آزمایشی</span>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-right">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileMenu(true)}
            >
              <Icon name="bi-list" />
            </button>
            <div className="breadcrumb-text">
              <span>سامانه</span>
              <Icon name="bi-chevron-left" />
              <strong>{pageName}</strong>
            </div>
          </div>
          <div className="topbar-left">
            <div className="top-date">
              <Icon name="bi-calendar3" /> {faDate.format(new Date())}
            </div>
            <div className="notification-wrap">
              <button
                className="icon-button notification-button"
                type="button"
                title="اعلان‌ها"
                onClick={() => setNotificationsOpen((value) => !value)}
              >
                <Icon name="bi-bell" />
                {unreadCount > 0 && (
                  <span className="notification-count">
                    {unreadCount.toLocaleString("fa-IR")}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="notification-panel">
                  <div className="notification-panel-head">
                    <strong>اعلان‌ها</strong>
                    <button
                      type="button"
                      onClick={readAllNotifications}
                      disabled={!unreadCount}
                    >
                      خواندن همه
                    </button>
                  </div>
                  <div className="notification-list">
                    {notifications.length ? (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`notification-item ${item.isRead ? "" : "unread"}`}
                          onClick={() => {
                            readNotification(item.id);
                            if (item.link && item.link !== "portal") go(item.link);
                            setNotificationsOpen(false);
                          }}
                        >
                          <span className="notification-item-icon">
                            <Icon
                              name={
                                item.type === "leave"
                                  ? "bi-calendar2-check"
                                  : item.type === "objection"
                                    ? "bi-shield-exclamation"
                                    : "bi-bell"
                              }
                            />
                          </span>
                          <span className="notification-item-copy">
                            <strong>{item.title}</strong>
                            <p>{item.message}</p>
                            <small>
                              {new Date(item.createdAt).toLocaleString("fa-IR")}
                            </small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="notification-empty">
                        <Icon name="bi-bell-slash" />
                        <span>اعلان جدیدی ندارید</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              className="icon-button theme-toggle"
              type="button"
              aria-label={
                theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تیره"
              }
              title={theme === "dark" ? "تم روشن" : "تم تیره"}
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
            >
              <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
            </button>
            <div className="topbar-divider" />
            <button className="user-menu" onClick={() => go("profile")}>
              {profilePhoto ? (
                <img
                  className="avatar avatar-photo"
                  src={profilePhoto}
                  alt=""
                />
              ) : (
                <span className="avatar">
                  {loginName.trim().charAt(0) || "م"}
                </span>
              )}
              <span className="user-menu-copy">
                <strong>{loginName}</strong>
                <small>{ACCESS_ROLE_LABELS[loginRole]}</small>
              </span>
              <Icon name="bi-chevron-down" />
            </button>
          </div>
        </header>
        <div className="page-content">
          {storageWarning && (
            <div className="storage-warning" role="alert">
              <Icon name="bi-exclamation-triangle" />
              <span>{storageWarning}</span>
              <button
                type="button"
                aria-label="بستن پیام"
                onClick={() => setStorageWarning("")}
              >
                ×
              </button>
            </div>
          )}
          {active === "dashboard" && (
            <Dashboard
              students={students}
              courses={courses}
              attendance={attendance}
              onNavigate={go}
              onExport={exportCsv}
              accessRole={loginRole}
            />
          )}
          {active === "students" && (
            <Students
              students={filteredStudents}
              query={query}
              setQuery={setQuery}
              onAdd={() => setModal(true)}
              onDelete={async (id) => {
                try {
                  const student = students.find((item) => item.id === id);

                  if (!student?.databaseId) {
                    return notify("شناسه دانشجو در دیتابیس پیدا نشد.");
                  }

                  await updateStudent(student.databaseId, { status: "inactive" });
                  await loadFromServer({ silent: true });
                  notify("دانشجو با موفقیت غیرفعال شد.");
                } catch (error) {
                  notify(error.message || "غیرفعال‌سازی دانشجو انجام نشد.");
                }
              }}
              onSavePhoto={saveStudentPhoto}
              onImportStudents={importStudentsHandler}
            />
          )}
          {active === "courses" && (
            <Courses
              courses={courses}
              students={students}
              onAddCourse={addCourse}
              onNavigate={go}
              onImportCourses={importCoursesHandler}
            />
          )}
          {active === "sessions" && (
            <Sessions
              courses={courses}
              students={students}
              attendance={attendance}
              sessions={sessionHistory}
              onSchedule={async (course, date, details) => {
                const courseObj = courses.find(
                  (item) => item.title === course,
                );
                if (!courseObj?.databaseId) {
                  notify("درس انتخاب‌شده در دیتابیس پیدا نشد.");
                  return;
                }
                const memberDatabaseIds = [
                  ...new Set(
                    (details.studentIds || [])
                      .map((id) => studentDatabaseId(id))
                      .filter(Boolean),
                  ),
                ];
                if (!memberDatabaseIds.length) {
                  notify("فهرست دانشجویان جلسه خالی است.");
                  return;
                }
                try {
                  await createSession({
                    courseId: courseObj.databaseId,
                    date,
                    teacherName: details.teacher || courseObj.teacher || loginName,
                    startTime: details.startTime,
                    endTime: details.endTime,
                    graceMinutes: Number(details.graceMinutes ?? 10),
                    openBeforeMinutes: Number(details.openBeforeMinutes ?? 15),
                    closeAfterMinutes: Number(details.closeAfterMinutes ?? 30),
                    studentIds: memberDatabaseIds,
                  });
                  await loadFromServer({ silent: true });
                  notify("جلسه در دیتابیس ایجاد شد و رکوردهای حضور آماده‌اند.");
                } catch (error) {
                  notify(error.message || "ایجاد جلسه انجام نشد.");
                }
              }}
              onOpenSession={openSession}
              onFinalizeSession={finalizeSession}
              onNavigate={go}
            />
          )}
          {active === "manual" && (
            <ManualAttendance
              attendance={filteredAttendance}
              students={students}
              query={query}
              setQuery={setQuery}
              courses={courses}
              courseFilter={courseFilter}
              setCourseFilter={setCourseFilter}
              onStatus={setAttendanceStatus}
              onExport={exportCsv}
            />
          )}
          {(active === "face" || active === "class-camera") && (
            <FaceAttendance
              variant={active === "class-camera" ? "classroom" : "face"}
              courses={courses}
              students={students.filter((student) => {
                const course = courses.find(
                  (item) => item.title === sessionCourse,
                );
                const roster =
                  sessionHistory[sessionId]?.studentIds || course?.studentIds;
                return !Array.isArray(roster) || roster.includes(student.id);
              })}
              attendance={attendance}
              sessionCourse={sessionCourse}
              setSessionCourse={setSessionCourse}
              sessionDate={sessionDate}
              setSessionDate={setSessionDate}
              sessionId={sessionId}
              onSaveStudentPhoto={saveStudentPhoto}
              onMarkAttendance={markFaceAttendance}
              onRecognitionNotice={notify}
              cameraState={cameraState}
              cameras={cameras}
              selectedCameraId={selectedCameraId}
              onSelectCamera={selectCamera}
              videoRef={videoRef}
              streamRef={streamRef}
              startCamera={
                active === "class-camera"
                  ? startCamera
                  : () => startCamera("", true)
              }
              stopCamera={stopCamera}
            />
          )}
          {active === "fingerprint" && (
            <FingerprintAttendance
              courses={courses}
              students={studentsForActiveSession()}
              attendance={attendance}
              sessionCourse={sessionCourse}
              setSessionCourse={setSessionCourse}
              sessionDate={sessionDate}
              setSessionDate={setSessionDate}
              sessionId={sessionId}
              onMarkAttendance={markFaceAttendance}
              onRecognitionNotice={notify}
              fingerprintCredentials={fingerprintCredentials}
              checkFingerprintEnrollment={checkFingerprintEnrollment}
              startFingerprintRegistration={startFingerprintRegistration}
              finishFingerprintRegistration={finishFingerprintRegistration}
              startFingerprintAuthentication={startFingerprintAuthentication}
              finishFingerprintAuthentication={finishFingerprintAuthentication}
              revokeFingerprintCredential={revokeFingerprintCredential}
              onCheckMyFingerprint={checkMyFingerprint}
            />
          )}
          {active === "voice" && (
            <VoiceAttendance
              courses={courses}
              students={students.filter((student) => {
                const course = courses.find(
                  (item) => item.title === sessionCourse,
                );
                const roster =
                  sessionHistory[sessionId]?.studentIds || course?.studentIds;
                return !Array.isArray(roster) || roster.includes(student.id);
              })}
              attendance={attendance}
              sessionCourse={sessionCourse}
              setSessionCourse={setSessionCourse}
              sessionDate={sessionDate}
              setSessionDate={setSessionDate}
              sessionId={sessionId}
              onMarkAttendance={markFaceAttendance}
              onNotice={notify}
              voiceProfiles={voiceProfiles}
              onSaveVoiceSample={async (frontendStudentId, sample) => {
                const dbId = studentDatabaseId(frontendStudentId);
                if (!dbId) throw new Error("شناسهٔ دیتابیسی دانشجو پیدا نشد.");
                await saveVoiceSample(
                  dbId,
                  sample.features,
                  sample.featureVersion,
                );
                await loadFromServer({ silent: true });
              }}
            />
          )}
          {active === "reports" && (
            <Reports
              attendance={attendance}
              students={students}
              courses={courses}
              sessions={sessionHistory}
              onExport={exportCsv}
              onPrint={() => window.print()}
            />
          )}
          {active === "settings" && (
            <Settings
              settings={settings}
              setSettings={setSettings}
              onSave={saveSettings}
              onBackup={exportBackup}
              onRestore={restoreBackup}
            />
          )}
          {active === "profile" && (
            <Profile
              name={loginName}
              role={ACCESS_ROLE_LABELS[loginRole]}
              photo={profilePhoto}
              onSave={saveProfile}
            />
          )}
          {active === "registrations" && (
            <Registrations
              registrations={registrations}
              onApprove={async (id) => {
                try {
                  await approveRegistration(id);
                  await loadFromServer({ silent: true });
                  notify("درخواست تأیید شد.");
                } catch (error) {
                  notify(error.message || "تأیید انجام نشد.");
                }
              }}
              onReject={async (id) => {
                try {
                  await rejectRegistration(id);
                  await loadFromServer({ silent: true });
                  notify("درخواست رد شد.");
                } catch (error) {
                  notify(error.message || "رد انجام نشد.");
                }
              }}
              onRefresh={() => loadFromServer({ silent: true })}
            />
          )}
          {active === "tickets" && (
            <Tickets
              tickets={tickets}
              students={students}
              loading={ticketsLoading}
              onRespond={respondTicket}
              onClose={closeTicket}
              onRefresh={refreshTickets}
            />
          )}
          {active === "leave-requests" && (
            <LeaveRequests
              requests={leaveRequests}
              students={students}
              loading={leaveLoading}
              onReview={reviewLeave}
              onRefresh={refreshLeaveRequests}
              onCreateGroup={createGroupLeave}
            />
          )}
          {active === "objections" && (
            <AttendanceObjections
              objections={objections}
              loading={objectionsLoading}
              onReview={reviewObjection}
              onRefresh={refreshObjections}
            />
          )}
          {active === "class-live" && (
            <LiveClass
              onLoadSessions={fetchLiveSessions}
              onLoadSession={fetchLiveSession}
              onStartSession={startLiveSession}
              onEndSession={endLiveSession}
              onMarkStudent={markLiveAttendance}
            />
          )}
          {active === "trends" && (
            <TrendAnalysis
              courses={courses}
              onLoadTrend={fetchAttendanceTrend}
              onLoadCourses={fetchCourseAnalytics}
            />
          )}
        </div>
        <footer className="main-footer">
          <span>© ۱۴۰۵ حضوربان. تمامی حقوق محفوظ است.</span>
          <span>
            ساخته‌شده برای مدیریت هوشمند آموزش <Icon name="bi-heart-fill" />
          </span>
        </footer>
      </main>
      {modal && (
        <div
          className="modal-backdrop-custom"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(false);
          }}
        >
          <form className="custom-modal" onSubmit={addStudent}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">مدیریت آموزشی</span>
                <h3>افزودن دانشجوی جدید</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModal(false)}
              >
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <div className="row g-3">
              <div className="col-12 col-md-6">
                <label className="form-label">نام و نام خانوادگی *</label>
                <input
                  className="form-control"
                  value={studentForm.name}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, name: e.target.value })
                  }
                  placeholder="مثلاً علی محمدی"
                  required
                />
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label">شماره دانشجویی *</label>
                <input
                  className="form-control"
                  value={studentForm.id}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, id: e.target.value })
                  }
                  placeholder="مثلاً ۴۰۱۲۳۰۰۷"
                  required
                />
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label">رشته تحصیلی</label>
                <select
                  className="form-select"
                  value={studentForm.major}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, major: e.target.value })
                  }
                >
                  <option>مهندسی کامپیوتر</option>
                  <option>فناوری اطلاعات</option>
                  <option>علوم کامپیوتر</option>
                </select>
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label">ترم</label>
                <select
                  className="form-select"
                  value={studentForm.term}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, term: e.target.value })
                  }
                >
                  {["۱", "۲", "۳", "۴", "۵", "۶"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="col-12">
                <label className="form-label">شماره تماس</label>
                <input
                  className="form-control"
                  value={studentForm.phone}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, phone: e.target.value })
                  }
                  placeholder="اختیاری"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-light"
                onClick={() => setModal(false)}
              >
                انصراف
              </button>
              <button type="submit" className="btn btn-primary">
                <Icon name="bi-plus-lg" /> ثبت دانشجو
              </button>
            </div>
          </form>
        </div>
      )}
      {toast && (
        <div className="toast-custom">
          <Icon name="bi-check-circle-fill" />
          {toast}
          <button onClick={() => setToast("")}>
            <Icon name="bi-x" />
          </button>
        </div>
      )}
      <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

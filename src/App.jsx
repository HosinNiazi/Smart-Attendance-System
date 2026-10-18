import React, { useEffect, useMemo, useRef, useState } from "react";

const initialStudents = [
  {
    id: "40123001",
    name: "آرمان محمدی",
    major: "مهندسی کامپیوتر",
    term: "۳",
    phone: "۰۹۱۲۱۲۳۴۵۶۷",
    status: "فعال",
  },
  {
    id: "40123002",
    name: "نگار رضایی",
    major: "مهندسی کامپیوتر",
    term: "۳",
    phone: "۰۹۳۵۱۲۳۴۵۶۷",
    status: "فعال",
  },
  {
    id: "40123003",
    name: "پارسا کریمی",
    major: "فناوری اطلاعات",
    term: "۲",
    phone: "۰۹۱۵۱۲۳۴۵۶۷",
    status: "فعال",
  },
  {
    id: "40123004",
    name: "سارا احمدی",
    major: "مهندسی کامپیوتر",
    term: "۴",
    phone: "۰۹۹۰۱۲۳۴۵۶۷",
    status: "فعال",
  },
  {
    id: "40123005",
    name: "امیرحسین مرادی",
    major: "فناوری اطلاعات",
    term: "۲",
    phone: "۰۹۱۲۹۸۷۶۵۴۳",
    status: "غیرفعال",
  },
  {
    id: "40123006",
    name: "مریم جعفری",
    major: "مهندسی کامپیوتر",
    term: "۳",
    phone: "۰۹۳۶۱۲۳۴۵۶۷",
    status: "فعال",
  },
];
const initialCourses = [
  {
    id: "CS301",
    title: "برنامه‌سازی پیشرفته",
    teacher: "مهندس نادری",
    time: "شنبه، ۱۰:۰۰ تا ۱۲:۰۰",
    room: "کلاس ۲۰۴",
    count: 28,
  },
  {
    id: "CS204",
    title: "پایگاه داده",
    teacher: "دکتر حسینی",
    time: "یکشنبه، ۱۳:۰۰ تا ۱۵:۰۰",
    room: "آزمایشگاه ۱",
    count: 24,
  },
  {
    id: "CS210",
    title: "ساختمان داده",
    teacher: "مهندس احمدی",
    time: "دوشنبه، ۰۸:۰۰ تا ۱۰:۰۰",
    room: "کلاس ۱۰۲",
    count: 32,
  },
  {
    id: "MA205",
    title: "ریاضی گسسته",
    teacher: "دکتر کریمی",
    time: "سه‌شنبه، ۱۰:۰۰ تا ۱۲:۰۰",
    room: "کلاس ۳۰۱",
    count: 26,
  },
];
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
      { id: "face", label: "تشخیص چهره", icon: "bi-camera-video" },
      { id: "reports", label: "گزارش‌ها", icon: "bi-bar-chart-line" },
    ],
  },
  {
    title: "سیستم",
    items: [{ id: "settings", label: "تنظیمات", icon: "bi-gear" }],
  },
];
const todayAttendance = [
  {
    id: "40123001",
    name: "آرمان محمدی",
    course: "برنامه‌سازی پیشرفته",
    time: "۱۰:۰۲",
    status: "حاضر",
  },
  {
    id: "40123002",
    name: "نگار رضایی",
    course: "برنامه‌سازی پیشرفته",
    time: "۱۰:۰۴",
    status: "حاضر",
  },
  {
    id: "40123003",
    name: "پارسا کریمی",
    course: "پایگاه داده",
    time: "۱۳:۰۸",
    status: "تأخیر",
  },
  {
    id: "40123004",
    name: "سارا احمدی",
    course: "برنامه‌سازی پیشرفته",
    time: "—",
    status: "غایب",
  },
  {
    id: "40123006",
    name: "مریم جعفری",
    course: "ساختمان داده",
    time: "۰۸:۰۱",
    status: "حاضر",
  },
];
const faDate = new Intl.DateTimeFormat("fa-IR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function Icon({ name, className = "" }) {
  return <i className={`bi ${name} ${className}`} aria-hidden="true" />;
}
function Badge({ children, tone = "success" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
function PanelTitle({ eyebrow, title, description, action }) {
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
function StatCard({ icon, label, value, detail, trend, color = "blue" }) {
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
function EmptyState({ icon = "bi-inbox", title, text }) {
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

export default function App() {
  const [active, setActive] = useState("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [students, setStudents] = useState(initialStudents);
  const [courses] = useState(initialCourses);
  const [attendance, setAttendance] = useState(todayAttendance);
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("همه درس‌ها");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);
  const [studentForm, setStudentForm] = useState({
    id: "",
    name: "",
    major: "مهندسی کامپیوتر",
    term: "۳",
    phone: "",
  });
  const [sessionCourse, setSessionCourse] = useState(initialCourses[0].title);
  const [cameraState, setCameraState] = useState("idle");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [settings, setSettings] = useState({
    name: "سامانه حضوربان",
    lateAfter: "۱۰",
    notifications: true,
    faceRecognition: true,
  });
  const [login, setLogin] = useState(true);
  const [loginName, setLoginName] = useState("مدیر سامانه");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(
    () => () => streamRef.current?.getTracks().forEach((track) => track.stop()),
    [],
  );
  const filteredStudents = useMemo(
    () =>
      students.filter((s) =>
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

  function notify(message) {
    setToast(message);
  }
  function go(id) {
    setActive(id);
    setMobileMenu(false);
    setQuery("");
  }
  function addStudent(e) {
    e.preventDefault();
    if (!studentForm.id.trim() || !studentForm.name.trim())
      return notify("شماره دانشجویی و نام را وارد کنید.");
    if (students.some((s) => s.id === studentForm.id.trim()))
      return notify("این شماره دانشجویی قبلاً ثبت شده است.");
    setStudents((prev) => [
      { ...studentForm, id: studentForm.id.trim(), status: "فعال" },
      ...prev,
    ]);
    setStudentForm({
      id: "",
      name: "",
      major: "مهندسی کامپیوتر",
      term: "۳",
      phone: "",
    });
    setModal(false);
    notify("دانشجو با موفقیت اضافه شد.");
  }
  function setAttendanceStatus(id, status) {
    setAttendance((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status,
              time:
                status === "غایب"
                  ? "—"
                  : new Intl.DateTimeFormat("fa-IR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date()),
            }
          : a,
      ),
    );
  }
  async function startCamera() {
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

    try {
      // مجوز دوربین را می‌گیریم تا مرورگر نام دستگاه‌ها را نشان دهد.
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(
        (device) => device.kind === "videoinput" && device.deviceId,
      );

      if (cameras.length === 0) {
        throw new DOMException(
          "هیچ دوربینی توسط مرورگر شناسایی نشد.",
          "NotFoundError",
        );
      }

      // دوربین‌های مجازی/موبایل را حذف می‌کنیم؛ اتصال نهایی فقط به وب‌کم داخلی است.
      const virtualCameraPattern =
        /droid.?cam|iriun|camo|epoccam|ivcam|manycam|obs virtual|virtual camera|phone|android|iphone|continuity camera|scrcpy/i;
      const laptopCameraPattern =
        /integrated|built.?in|internal|laptop|hd webcam|webcam داخلی|دوربین داخلی|user.?facing|front camera|usb2\.0 camera|usb camera/i;

      const physicalCandidates = cameras.filter(
        (camera) => !virtualCameraPattern.test(camera.label || ""),
      );
      const selectedCamera =
        physicalCandidates.find((camera) =>
          laptopCameraPattern.test(camera.label || ""),
        ) || (physicalCandidates.length === 1 ? physicalCandidates[0] : null);

      if (!selectedCamera) {
        const names = cameras
          .map((camera) => camera.label || "دوربین با نام مخفی")
          .join("، ");
        throw new Error(
          `وب‌کم داخلی با اطمینان شناسایی نشد؛ برای جلوگیری از اتصال به دوربین موبایل، دوربین دیگری انتخاب نشد. دوربین‌های دیده‌شده: ${names}. دوربین داخلی را در Windows Device Manager فعال کنید و برنامه‌های دوربین مجازی را ببندید.`,
        );
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());

      // قید exact مانع از انتخاب خودکار دوربین دیگری می‌شود.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: selectedCamera.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraState("live");
      notify(`وب‌کم لپ‌تاپ متصل شد: ${selectedCamera.label || "وب‌کم داخلی"}`);
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
  function simulateRecognition() {
    const student = students.find(
      (s) =>
        s.status === "فعال" &&
        !attendance.some(
          (a) =>
            a.id === s.id && a.course === sessionCourse && a.status === "حاضر",
        ),
    );
    if (!student) return notify("دانشجوی جدیدی برای ثبت آزمایشی پیدا نشد.");
    setAttendance((prev) => [
      {
        id: student.id,
        name: student.name,
        course: sessionCourse,
        time: new Intl.DateTimeFormat("fa-IR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
        status: "حاضر",
      },
      ...prev,
    ]);
    notify(`ثبت آزمایشی حضور برای ${student.name} انجام شد.`);
  }
  function exportCsv() {
    const rows = [
      ["شماره دانشجویی", "نام دانشجو", "درس", "ساعت", "وضعیت"],
      ...attendance.map((a) => [a.id, a.name, a.course, a.time, a.status]),
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
            onSubmit={(e) => {
              e.preventDefault();
              setLoginName(loginName.trim() || "مدیر سامانه");
              setLogin(false);
            }}
          >
            <div className="mobile-login-brand">
              <span className="brand-mark">
                <Icon name="bi-fingerprint" />
              </span>{" "}
              حضوربان
            </div>
            <span className="eyebrow">خوش آمدید</span>
            <h1>ورود به پنل مدیریت</h1>
            <p className="login-subtitle">
              برای مدیریت کلاس‌ها و ثبت حضور و غیاب وارد شوید.
            </p>
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
                defaultValue="demo1234"
                placeholder="رمز عبور"
                required
              />
            </div>
            <div className="login-hint">
              <Icon name="bi-info-circle" /> ورود در این نسخه آزمایشی شبیه‌سازی
              شده است.
            </div>
            <button
              className="btn btn-primary w-100 login-submit"
              type="submit"
            >
              ورود به سامانه <Icon name="bi-arrow-left-short" />
            </button>
            <div className="login-footer">
              © ۱۴۰۵ حضوربان · سامانه مدیریت حضور و غیاب
            </div>
          </form>
        </div>
      </div>
    );

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
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Icon name="bi-mortarboard-fill" />
          </span>
          <div>
            <strong>دانشگاه نمونه</strong>
            <small>پنل مدیریت آموزشی</small>
          </div>
          <Icon name="bi-chevron-down" className="workspace-chevron" />
        </div>
        <nav className="side-nav">
          {navGroups.map((group) => (
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
            <p>راهنمای استفاده از سامانه را ببینید.</p>
            <button
              onClick={() =>
                notify("راهنمای سامانه در نسخه بعدی اضافه می‌شود.")
              }
            >
              مشاهده راهنما <Icon name="bi-arrow-left" />
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
            <button
              className="icon-button notification-button"
              title="اعلان‌ها"
              onClick={() => notify("در حال حاضر اعلان جدیدی ندارید.")}
            >
              <Icon name="bi-bell" />
              <span />
            </button>
            <div className="topbar-divider" />
            <button
              className="user-menu"
              onClick={() => notify(`وارد شده به‌عنوان ${loginName}`)}
            >
              <span className="avatar">م</span>
              <span className="user-menu-copy">
                <strong>{loginName}</strong>
                <small>مدیر سیستم</small>
              </span>
              <Icon name="bi-chevron-down" />
            </button>
          </div>
        </header>
        <div className="page-content">
          {active === "dashboard" && (
            <Dashboard
              students={students}
              courses={courses}
              attendance={attendance}
              onNavigate={go}
              onExport={exportCsv}
            />
          )}
          {active === "students" && (
            <Students
              students={filteredStudents}
              query={query}
              setQuery={setQuery}
              onAdd={() => setModal(true)}
              onDelete={(id) => {
                setStudents((prev) => prev.filter((s) => s.id !== id));
                notify("دانشجو حذف شد.");
              }}
            />
          )}
          {active === "courses" && (
            <Courses courses={courses} onNavigate={go} />
          )}
          {active === "sessions" && (
            <Sessions
              courses={courses}
              attendance={attendance}
              onNavigate={go}
            />
          )}
          {active === "manual" && (
            <ManualAttendance
              attendance={filteredAttendance}
              query={query}
              setQuery={setQuery}
              courses={courses}
              courseFilter={courseFilter}
              setCourseFilter={setCourseFilter}
              onStatus={setAttendanceStatus}
              onExport={exportCsv}
            />
          )}
          {active === "face" && (
            <FaceAttendance
              courses={courses}
              sessionCourse={sessionCourse}
              setSessionCourse={setSessionCourse}
              cameraState={cameraState}
              videoRef={videoRef}
              streamRef={streamRef}
              startCamera={startCamera}
              stopCamera={stopCamera}
              simulateRecognition={simulateRecognition}
            />
          )}
          {active === "reports" && (
            <Reports
              attendance={attendance}
              students={students}
              onExport={exportCsv}
            />
          )}
          {active === "settings" && (
            <Settings
              settings={settings}
              setSettings={setSettings}
              onSave={() => notify("تنظیمات نمایشی ذخیره شد.")}
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
    </div>
  );
}

function Dashboard({ students, courses, attendance, onNavigate, onExport }) {
  const present = attendance.filter((a) => a.status === "حاضر").length;
  const late = attendance.filter((a) => a.status === "تأخیر").length;
  const absent = attendance.filter((a) => a.status === "غایب").length;
  const max = Math.max(present, late, absent, 1);
  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">نمای کلی سامانه</div>
          <h1>
            سلام، روز بخیر <span>✦</span>
          </h1>
          <p>در یک نگاه، وضعیت کلاس‌ها و حضور دانشجویان را بررسی کنید.</p>
        </div>
        <div className="welcome-actions">
          <button className="btn btn-light-outline" onClick={onExport}>
            <Icon name="bi-download" /> خروجی گزارش
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onNavigate("manual")}
          >
            <Icon name="bi-plus-lg" /> ثبت حضور جدید
          </button>
        </div>
      </div>
      <div className="stat-grid">
        <StatCard
          icon="bi-people"
          label="کل دانشجویان"
          value={students.length.toLocaleString("fa-IR")}
          detail="دانشجوی ثبت‌شده"
          trend="+۱۲٪"
          color="blue"
        />
        <StatCard
          icon="bi-journal-bookmark"
          label="درس‌های فعال"
          value={courses.length.toLocaleString("fa-IR")}
          detail="در این نیم‌سال"
          trend=""
          color="purple"
        />
        <StatCard
          icon="bi-person-check"
          label="حاضرین امروز"
          value={present.toLocaleString("fa-IR")}
          detail="از ثبت‌های امروز"
          trend="+۸٪"
          color="green"
        />
        <StatCard
          icon="bi-clock-history"
          label="تأخیر و غیبت"
          value={(late + absent).toLocaleString("fa-IR")}
          detail="نیازمند بررسی"
          trend=""
          color="orange"
        />
      </div>
      <div className="dashboard-grid">
        <section className="content-card attendance-overview">
          <div className="card-heading">
            <div>
              <h3>وضعیت حضور امروز</h3>
              <p>خلاصه وضعیت ثبت‌های امروز</p>
            </div>
            <button
              className="text-action"
              onClick={() => onNavigate("reports")}
            >
              مشاهده گزارش <Icon name="bi-arrow-left" />
            </button>
          </div>
          <div className="attendance-summary">
            <div className="donut-wrap">
              <div
                className="donut-chart"
                style={{
                  "--present": `${Math.round((present / Math.max(attendance.length, 1)) * 100)}%`,
                  "--late": `${Math.round((late / Math.max(attendance.length, 1)) * 100)}%`,
                }}
              >
                <div>
                  <strong>
                    {Math.round(
                      (present / Math.max(attendance.length, 1)) * 100,
                    ).toLocaleString("fa-IR")}
                    ٪
                  </strong>
                  <small>حضور ثبت‌شده</small>
                </div>
              </div>
            </div>
            <div className="legend-list">
              <div>
                <span className="legend-dot present" />
                <span>حاضر</span>
                <strong>{present.toLocaleString("fa-IR")}</strong>
              </div>
              <div>
                <span className="legend-dot late" />
                <span>با تأخیر</span>
                <strong>{late.toLocaleString("fa-IR")}</strong>
              </div>
              <div>
                <span className="legend-dot absent" />
                <span>غایب</span>
                <strong>{absent.toLocaleString("fa-IR")}</strong>
              </div>
            </div>
          </div>
          <div className="chart-footnote">
            <Icon name="bi-info-circle" /> آمار بر اساس داده‌های آزمایشی ثبت‌شده
            نمایش داده می‌شود.
          </div>
        </section>
        <section className="content-card quick-actions-card">
          <div className="card-heading">
            <div>
              <h3>دسترسی سریع</h3>
              <p>کارهای پرتکرار سامانه</p>
            </div>
            <span className="heading-icon">
              <Icon name="bi-lightning-charge" />
            </span>
          </div>
          <div className="quick-action-list">
            <button onClick={() => onNavigate("students")}>
              <span className="quick-icon blue">
                <Icon name="bi-person-plus" />
              </span>
              <span>
                <strong>مدیریت دانشجویان</strong>
                <small>افزودن و مشاهده فهرست دانشجویان</small>
              </span>
              <Icon name="bi-chevron-left" className="quick-arrow" />
            </button>
            <button onClick={() => onNavigate("manual")}>
              <span className="quick-icon green">
                <Icon name="bi-clipboard-check" />
              </span>
              <span>
                <strong>ثبت حضور و غیاب</strong>
                <small>ثبت دستی وضعیت حضور کلاس</small>
              </span>
              <Icon name="bi-chevron-left" className="quick-arrow" />
            </button>
            <button onClick={() => onNavigate("face")}>
              <span className="quick-icon purple">
                <Icon name="bi-camera-video" />
              </span>
              <span>
                <strong>تشخیص چهره</strong>
                <small>شروع دوربین برای ثبت آزمایشی</small>
              </span>
              <Icon name="bi-chevron-left" className="quick-arrow" />
            </button>
          </div>
        </section>
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h3>آخرین وضعیت حضور و غیاب</h3>
            <p>آخرین رویدادهای ثبت‌شده در سامانه</p>
          </div>
          <button className="text-action" onClick={() => onNavigate("manual")}>
            مشاهده همه <Icon name="bi-arrow-left" />
          </button>
        </div>
        <AttendanceTable rows={attendance.slice(0, 5)} compact />
      </section>
      <section className="content-card courses-strip">
        <div className="card-heading">
          <div>
            <h3>کلاس‌های فعال</h3>
            <p>برنامه کلاس‌های این نیم‌سال</p>
          </div>
          <button className="text-action" onClick={() => onNavigate("courses")}>
            همه درس‌ها <Icon name="bi-arrow-left" />
          </button>
        </div>
        <div className="course-mini-grid">
          {courses.slice(0, 3).map((c, i) => (
            <div className="course-mini" key={c.id}>
              <div className={`course-color color-${i}`}>
                <Icon
                  name={["bi-code-slash", "bi-database", "bi-diagram-3"][i]}
                />
              </div>
              <div className="course-mini-info">
                <strong>{c.title}</strong>
                <small>{c.teacher}</small>
                <div>
                  <Icon name="bi-clock" /> {c.time}
                </div>
              </div>
              <span className="course-count">
                <Icon name="bi-people" /> {c.count.toLocaleString("fa-IR")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Students({ students, query, setQuery, onAdd, onDelete }) {
  return (
    <>
      <PanelTitle
        eyebrow="مدیریت آموزشی"
        title="مدیریت دانشجویان"
        description="فهرست دانشجویان را مشاهده، جست‌وجو و مدیریت کنید."
        action={
          <button className="btn btn-primary" onClick={onAdd}>
            <Icon name="bi-plus-lg" /> افزودن دانشجو
          </button>
        }
      />
      <div className="content-card data-card">
        <div className="table-toolbar">
          <div className="search-wrap">
            <Icon name="bi-search" />
            <input
              className="form-control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجو بر اساس نام، شماره دانشجویی..."
            />
          </div>
          <span className="result-count">
            {students.length.toLocaleString("fa-IR")} دانشجو
          </span>
        </div>
        {students.length ? (
          <div className="table-responsive">
            <table className="table custom-table align-middle">
              <thead>
                <tr>
                  <th>دانشجو</th>
                  <th>شماره دانشجویی</th>
                  <th>رشته تحصیلی</th>
                  <th>ترم</th>
                  <th>شماره تماس</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s.id}>
                    <td>
                      <div className="student-cell">
                        <span className={`student-avatar avatar-${i % 5}`}>
                          {s.name.charAt(0)}
                        </span>
                        <strong>{s.name}</strong>
                      </div>
                    </td>
                    <td className="id-cell">{s.id}</td>
                    <td>{s.major}</td>
                    <td>{s.term}</td>
                    <td>{s.phone || "—"}</td>
                    <td>
                      <Badge tone={s.status === "فعال" ? "success" : "neutral"}>
                        {s.status}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="row-action danger-action"
                        title="حذف دانشجو"
                        onClick={() => {
                          if (window.confirm(`دانشجوی «${s.name}» حذف شود؟`))
                            onDelete(s.id);
                        }}
                      >
                        <Icon name="bi-trash3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="bi-search"
            title="دانشجویی پیدا نشد"
            text="عبارت جست‌وجو را تغییر دهید یا دانشجوی جدید اضافه کنید."
          />
        )}
      </div>
      <div className="page-note">
        <Icon name="bi-info-circle" /> اطلاعات این صفحه در حال حاضر در حافظه
        مرورگر نگهداری می‌شود و با بارگذاری مجدد به داده اولیه برمی‌گردد.
      </div>
    </>
  );
}
function Courses({ courses, onNavigate }) {
  return (
    <>
      <PanelTitle
        eyebrow="مدیریت آموزشی"
        title="درس‌ها و کلاس‌ها"
        description="اطلاعات درس‌ها، استادان و زمان‌بندی کلاس‌ها."
        action={
          <button
            className="btn btn-primary"
            onClick={() => onNavigate("sessions")}
          >
            <Icon name="bi-calendar-plus" /> مشاهده جلسات
          </button>
        }
      />
      <div className="course-grid">
        {courses.map((c, i) => (
          <div className="content-card course-card" key={c.id}>
            <div className={`course-banner banner-${i % 4}`}>
              <span className="course-color">
                <Icon
                  name={
                    [
                      "bi-code-slash",
                      "bi-database",
                      "bi-diagram-3",
                      "bi-calculator",
                    ][i % 4]
                  }
                />
              </span>
              <span className="course-code">{c.id}</span>
            </div>
            <div className="course-card-body">
              <Badge>فعال</Badge>
              <h3>{c.title}</h3>
              <div className="course-teacher">
                <span className="teacher-avatar">{c.teacher.charAt(0)}</span>
                <span>{c.teacher}</span>
              </div>
              <div className="course-detail">
                <span>
                  <Icon name="bi-clock" />
                  {c.time}
                </span>
                <span>
                  <Icon name="bi-geo-alt" />
                  {c.room}
                </span>
                <span>
                  <Icon name="bi-people" />
                  {c.count.toLocaleString("fa-IR")} دانشجو
                </span>
              </div>
              <button
                className="btn btn-light-outline w-100"
                onClick={() => onNavigate("manual")}
              >
                ثبت حضور این درس <Icon name="bi-arrow-left" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function Sessions({ courses, attendance, onNavigate }) {
  return (
    <>
      <PanelTitle
        eyebrow="برنامه آموزشی"
        title="جلسات کلاس"
        description="نمای کلی جلسات و آخرین وضعیت ثبت حضور."
        action={
          <button
            className="btn btn-primary"
            onClick={() => onNavigate("manual")}
          >
            <Icon name="bi-plus-lg" /> ثبت حضور
          </button>
        }
      />
      <div className="content-card data-card">
        <div className="session-list">
          {courses.map((c, i) => {
            const rows = attendance.filter((a) => a.course === c.title);
            const count = rows.filter((a) => a.status === "حاضر").length;
            return (
              <div className="session-row" key={c.id}>
                <div className={`session-date date-${i % 4}`}>
                  <strong>{["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه"][i]}</strong>
                  <span>{(26 + i).toLocaleString("fa-IR")} مهر</span>
                </div>
                <div className="session-info">
                  <strong>{c.title}</strong>
                  <span>
                    {c.teacher} · {c.room}
                  </span>
                  <small>
                    <Icon name="bi-clock" /> {c.time}
                  </small>
                </div>
                <div className="session-stats">
                  <strong>
                    {count.toLocaleString("fa-IR")} <small>نفر حاضر</small>
                  </strong>
                  <span>
                    {rows.length.toLocaleString("fa-IR")} ثبت در داده آزمایشی
                  </span>
                </div>
                <button
                  className="btn btn-light-outline"
                  onClick={() => onNavigate("manual")}
                >
                  مدیریت حضور <Icon name="bi-arrow-left" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
function ManualAttendance({
  attendance,
  query,
  setQuery,
  courses,
  courseFilter,
  setCourseFilter,
  onStatus,
  onExport,
}) {
  return (
    <>
      <PanelTitle
        eyebrow="ثبت حضور و غیاب"
        title="ثبت دستی حضور"
        description="وضعیت حضور دانشجویان را برای هر کلاس ثبت و اصلاح کنید."
        action={
          <button className="btn btn-light-outline" onClick={onExport}>
            <Icon name="bi-download" /> خروجی CSV
          </button>
        }
      />
      <div className="content-card data-card">
        <div className="table-toolbar toolbar-wrap">
          <div className="search-wrap">
            <Icon name="bi-search" />
            <input
              className="form-control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی نام یا شماره دانشجویی"
            />
          </div>
          <select
            className="form-select filter-select"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
          >
            <option>همه درس‌ها</option>
            {courses.map((c) => (
              <option key={c.id}>{c.title}</option>
            ))}
          </select>
          <span className="result-count">
            {attendance.length.toLocaleString("fa-IR")} رکورد
          </span>
        </div>
        <div className="table-responsive">
          <table className="table custom-table align-middle">
            <thead>
              <tr>
                <th>دانشجو</th>
                <th>شماره دانشجویی</th>
                <th>درس</th>
                <th>ساعت ثبت</th>
                <th>وضعیت فعلی</th>
                <th>تغییر وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((a, i) => (
                <tr key={`${a.id}-${a.course}`}>
                  <td>
                    <div className="student-cell">
                      <span className={`student-avatar avatar-${i % 5}`}>
                        {a.name.charAt(0)}
                      </span>
                      <strong>{a.name}</strong>
                    </div>
                  </td>
                  <td className="id-cell">{a.id}</td>
                  <td>{a.course}</td>
                  <td>{a.time}</td>
                  <td>
                    <Badge
                      tone={
                        a.status === "حاضر"
                          ? "success"
                          : a.status === "تأخیر"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {a.status}
                    </Badge>
                  </td>
                  <td>
                    <div className="attendance-actions">
                      <button
                        className={`mini-status present ${a.status === "حاضر" ? "selected" : ""}`}
                        onClick={() => onStatus(a.id, "حاضر")}
                        title="حاضر"
                      >
                        <Icon name="bi-check2" />
                      </button>
                      <button
                        className={`mini-status late ${a.status === "تأخیر" ? "selected" : ""}`}
                        onClick={() => onStatus(a.id, "تأخیر")}
                        title="تأخیر"
                      >
                        <Icon name="bi-clock" />
                      </button>
                      <button
                        className={`mini-status absent ${a.status === "غایب" ? "selected" : ""}`}
                        onClick={() => onStatus(a.id, "غایب")}
                        title="غایب"
                      >
                        <Icon name="bi-x-lg" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-bottom">
          <span>
            <Icon name="bi-info-circle" /> برای تغییر وضعیت از دکمه‌های هر ردیف
            استفاده کنید.
          </span>
          <span>نمایش {attendance.length.toLocaleString("fa-IR")} مورد</span>
        </div>
      </div>
    </>
  );
}
function AttendanceTable({ rows, compact = false }) {
  return (
    <div className="table-responsive">
      <table
        className={`table custom-table align-middle ${compact ? "compact-table" : ""}`}
      >
        <thead>
          <tr>
            <th>دانشجو</th>
            <th>درس</th>
            <th>ساعت</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={`${a.id}-${a.course}`}>
              <td>
                <div className="student-cell">
                  <span className={`student-avatar avatar-${i % 5}`}>
                    {a.name.charAt(0)}
                  </span>
                  <div>
                    <strong>{a.name}</strong>
                    <small className="student-id-small">{a.id}</small>
                  </div>
                </div>
              </td>
              <td>{a.course}</td>
              <td>{a.time}</td>
              <td>
                <Badge
                  tone={
                    a.status === "حاضر"
                      ? "success"
                      : a.status === "تأخیر"
                        ? "warning"
                        : "danger"
                  }
                >
                  {a.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function FaceAttendance({
  courses,
  sessionCourse,
  setSessionCourse,
  cameraState,
  videoRef,
  streamRef,
  startCamera,
  stopCamera,
  simulateRecognition,
}) {
  useEffect(() => {
    if (cameraState === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState, videoRef, streamRef]);

  return (
    <>
      <PanelTitle
        eyebrow="حضور و غیاب هوشمند"
        title="تشخیص چهره"
        description="دوربین را فعال کنید و محیط آماده شناسایی آزمایشی را بررسی کنید."
        action={<Badge tone="purple">نسخه نمایشی</Badge>}
      />
      <div className="face-layout">
        <section className="content-card camera-card">
          <div className="card-heading">
            <div>
              <h3>نمای زنده دوربین</h3>
              <p>برای استفاده از وب‌کم، اجازه دسترسی مرورگر را تأیید کنید.</p>
            </div>
            <span
              className={`camera-status ${cameraState === "live" ? "is-live" : ""}`}
            >
              <span />{" "}
              {cameraState === "live" ? "دوربین فعال" : "دوربین غیرفعال"}
            </span>
          </div>
          <div
            className={`camera-view ${cameraState === "live" ? "camera-live" : ""}`}
          >
            {cameraState === "live" ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted />
                <div className="camera-overlay">
                  <span className="scan-corner tl" />
                  <span className="scan-corner tr" />
                  <span className="scan-corner bl" />
                  <span className="scan-corner br" />
                  <div className="scan-line" />
                  <span className="scan-label">
                    <Icon name="bi-broadcast" /> آماده بررسی تصویر
                  </span>
                </div>
              </>
            ) : (
              <div className="camera-placeholder">
                <span className="camera-placeholder-icon">
                  <Icon
                    name={
                      cameraState === "error"
                        ? "bi-camera-video-off"
                        : "bi-camera-video"
                    }
                  />
                </span>
                <strong>
                  {cameraState === "error"
                    ? "دسترسی به دوربین برقرار نشد"
                    : "دوربین هنوز فعال نشده است"}
                </strong>
                <p>
                  {cameraState === "error"
                    ? "مجوز دوربین و اتصال امن را بررسی کنید."
                    : "برای مشاهده تصویر دوربین، روی دکمه زیر بزنید."}
                </p>
              </div>
            )}
          </div>
          <div className="camera-controls">
            {cameraState === "live" ? (
              <button className="btn btn-light-outline" onClick={stopCamera}>
                <Icon name="bi-stop-circle" /> توقف دوربین
              </button>
            ) : (
              <button className="btn btn-primary" onClick={startCamera}>
                <Icon name="bi-camera-video" /> فعال‌سازی دوربین
              </button>
            )}
            <button
              className="btn btn-success-soft"
              disabled={cameraState !== "live"}
              onClick={simulateRecognition}
            >
              <Icon name="bi-person-check" /> شبیه‌سازی ثبت حضور
            </button>
          </div>
          <div className="camera-disclaimer">
            <Icon name="bi-shield-lock" />
            <span>
              این نسخه فقط تصویر دوربین را نمایش می‌دهد. تشخیص هویت واقعی هنوز
              به سرویس پایتون و مدل تشخیص چهره متصل نشده است.
            </span>
          </div>
        </section>
        <aside className="face-side">
          <section className="content-card face-settings">
            <div className="card-heading">
              <div>
                <h3>تنظیمات جلسه</h3>
                <p>کلاس مورد نظر را انتخاب کنید.</p>
              </div>
              <span className="heading-icon">
                <Icon name="bi-sliders" />
              </span>
            </div>
            <label className="form-label">درس / کلاس</label>
            <select
              className="form-select"
              value={sessionCourse}
              onChange={(e) => setSessionCourse(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id}>{c.title}</option>
              ))}
            </select>
            <div className="face-info-row">
              <span>
                <Icon name="bi-clock" /> زمان جلسه
              </span>
              <strong>
                {new Intl.DateTimeFormat("fa-IR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date())}
              </strong>
            </div>
            <div className="face-info-row">
              <span>
                <Icon name="bi-calendar3" /> تاریخ
              </span>
              <strong>
                {new Intl.DateTimeFormat("fa-IR", {
                  day: "numeric",
                  month: "long",
                }).format(new Date())}
              </strong>
            </div>
            <div className="face-info-row">
              <span>
                <Icon name="bi-cpu" /> موتور تشخیص
              </span>
              <Badge tone="neutral">در انتظار اتصال</Badge>
            </div>
          </section>
          <section className="content-card face-steps">
            <h3>مراحل استفاده</h3>
            {[
              ["bi-camera", "فعال‌سازی دوربین", "اجازه دسترسی به وب‌کم"],
              [
                "bi-person-bounding-box",
                "شناسایی چهره",
                "در نسخه بعدی فعال می‌شود",
              ],
              ["bi-check-circle", "ثبت خودکار حضور", "پس از اتصال موتور تشخیص"],
            ].map((s, i) => (
              <div className="face-step" key={s[1]}>
                <span className={`step-icon ${i === 0 ? "done" : ""}`}>
                  <Icon name={s[0]} />
                </span>
                <div>
                  <strong>{s[1]}</strong>
                  <small>{s[2]}</small>
                </div>
                {i === 0 && (
                  <Icon name="bi-check-circle-fill" className="step-check" />
                )}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
function Reports({ attendance, students, onExport }) {
  const total = attendance.length;
  const present = attendance.filter((a) => a.status === "حاضر").length;
  const late = attendance.filter((a) => a.status === "تأخیر").length;
  const absent = attendance.filter((a) => a.status === "غایب").length;
  const pct = total ? Math.round((present / total) * 100) : 0;
  return (
    <>
      <PanelTitle
        eyebrow="تحلیل و گزارش"
        title="گزارش‌های حضور و غیاب"
        description="تحلیل وضعیت حضور و دریافت خروجی از داده‌های ثبت‌شده."
        action={
          <button className="btn btn-primary" onClick={onExport}>
            <Icon name="bi-file-earmark-arrow-down" /> دریافت فایل CSV
          </button>
        }
      />
      <div className="stat-grid report-stats">
        <StatCard
          icon="bi-check-circle"
          label="حضور ثبت‌شده"
          value={present.toLocaleString("fa-IR")}
          detail="رکورد حاضر"
          color="green"
        />
        <StatCard
          icon="bi-clock"
          label="تأخیر"
          value={late.toLocaleString("fa-IR")}
          detail="رکورد با تأخیر"
          color="orange"
        />
        <StatCard
          icon="bi-x-circle"
          label="غیبت"
          value={absent.toLocaleString("fa-IR")}
          detail="رکورد غایب"
          color="red"
        />
        <StatCard
          icon="bi-graph-up-arrow"
          label="نرخ حضور"
          value={`${pct.toLocaleString("fa-IR")}٪`}
          detail="از کل رکوردها"
          color="blue"
        />
      </div>
      <div className="report-grid">
        <section className="content-card">
          <div className="card-heading">
            <div>
              <h3>توزیع وضعیت‌ها</h3>
              <p>بر اساس کل رکوردهای ثبت‌شده</p>
            </div>
          </div>
          <div className="report-bars">
            {[
              { label: "حاضر", count: present, color: "bar-green" },
              { label: "تأخیر", count: late, color: "bar-orange" },
              { label: "غایب", count: absent, color: "bar-red" },
            ].map((item) => (
              <div className="report-bar-row" key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.count.toLocaleString("fa-IR")}</strong>
                </div>
                <div className="bar-track">
                  <span
                    className={item.color}
                    style={{
                      width: `${total ? (item.count / total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="content-card report-highlight">
          <span className="highlight-icon">
            <Icon name="bi-people" />
          </span>
          <div className="eyebrow">مجموعه آموزشی</div>
          <strong className="highlight-number">
            {students.length.toLocaleString("fa-IR")}
          </strong>
          <h3>دانشجوی ثبت‌شده</h3>
          <p>تعداد دانشجویان در فهرست فعلی سامانه</p>
          <div className="highlight-footer">
            <span>
              <Icon name="bi-journal-bookmark" /> رکوردهای حضور
            </span>
            <strong>{total.toLocaleString("fa-IR")}</strong>
          </div>
        </section>
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h3>جزئیات آخرین رکوردها</h3>
            <p>اطلاعات قابل خروجی گرفتن</p>
          </div>
        </div>
        <AttendanceTable rows={attendance} />
      </section>
    </>
  );
}
function Settings({ settings, setSettings, onSave }) {
  const update = (key, value) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  return (
    <>
      <PanelTitle
        eyebrow="پیکربندی سامانه"
        title="تنظیمات"
        description="تنظیمات عمومی نسخه نمایشی سامانه را مدیریت کنید."
        action={
          <button className="btn btn-primary" onClick={onSave}>
            <Icon name="bi-check2" /> ذخیره تغییرات
          </button>
        }
      />
      <div className="settings-layout">
        <section className="content-card settings-card">
          <div className="settings-section-title">
            <span className="settings-icon">
              <Icon name="bi-sliders" />
            </span>
            <div>
              <h3>تنظیمات عمومی</h3>
              <p>اطلاعات پایه سامانه</p>
            </div>
          </div>
          <div className="setting-item">
            <div>
              <strong>نام سامانه</strong>
              <small>نام نمایشی در پنل مدیریت</small>
            </div>
            <input
              className="form-control settings-input"
              value={settings.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="setting-item">
            <div>
              <strong>حد مجاز تأخیر (دقیقه)</strong>
              <small>پس از این زمان، حضور به‌صورت تأخیر ثبت می‌شود.</small>
            </div>
            <input
              type="number"
              min="0"
              max="120"
              className="form-control settings-input narrow"
              value={settings.lateAfter}
              onChange={(e) => update("lateAfter", e.target.value)}
            />
          </div>
        </section>
        <section className="content-card settings-card">
          <div className="settings-section-title">
            <span className="settings-icon purple">
              <Icon name="bi-shield-check" />
            </span>
            <div>
              <h3>قابلیت‌های سامانه</h3>
              <p>فعال یا غیرفعال‌کردن امکانات</p>
            </div>
          </div>
          <div className="setting-item">
            <div>
              <strong>اعلان‌های سامانه</strong>
              <small>نمایش پیام‌های وضعیت و اطلاع‌رسانی</small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) => update("notifications", e.target.checked)}
              />
              <span />
            </label>
          </div>
          <div className="setting-item">
            <div>
              <strong>ماژول تشخیص چهره</strong>
              <small>نمایش صفحه تشخیص چهره در منو</small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.faceRecognition}
                onChange={(e) => update("faceRecognition", e.target.checked)}
              />
              <span />
            </label>
          </div>
          <div className="settings-warning">
            <Icon name="bi-info-circle" /> این تنظیمات در نسخه نمایشی نگهداری
            می‌شوند و هنوز به سرور متصل نیستند.
          </div>
        </section>
      </div>
    </>
  );
}

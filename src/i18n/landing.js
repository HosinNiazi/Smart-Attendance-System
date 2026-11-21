/**
 * Landing-page copy for both languages.
 * The product name stays "Hozorban" (حضوربان) in English to keep branding.
 */
export const landingCopy = {
  fa: {
    brand: "حضوربان",
    brandTagline: "سامانه هوشمند حضور و غیاب",
    brandAria: "حضوربان — بازگشت به بالای صفحه",
    navAria: "منوی صفحهٔ اصلی",
    nav: [
      { id: "features", label: "امکانات" },
      { id: "how", label: "نحوهٔ کار" },
      { id: "roles", label: "نقش‌ها" },
      { id: "security", label: "امنیت" },
      { id: "faq", label: "سوالات متداول" },
      { id: "contact", label: "تماس" },
    ],
    languageAria: "تغییر زبان",
    languageButton: "EN",
    themeLight: "فعال‌کردن تم روشن",
    themeDark: "فعال‌کردن تم تیره",
    themeLightTitle: "تم روشن",
    themeDarkTitle: "تم تیره",
    signIn: "ورود به سامانه",
    badge: "نسخهٔ ۱.۰ · آمادهٔ استقرار",
    heroTitleStart: "حضور و غیاب،",
    heroTitleHighlight: "هوشمند و بدون تماس",
    heroLead:
      "حضوربان با تشخیص چهره، صدا و اثر انگشت، ثبت حضور کلاس‌ها را سریع، دقیق و شفاف می‌کند؛ از داشبورد لحظه‌ای مدیر تا پنل سادهٔ دانشجو.",
    start: "شروع کنید",
    explore: "مشاهدهٔ امکانات",
    trust: ["راه‌اندازی سریع", "بدون سخت‌افزار اختصاصی", "مناسب موبایل و دسکتاپ"],
    todayReport: "گزارش امروز",
    todayAttendance: "حضور امروز",
    ringValue: "۹۲٪",
    dashStudents: "دانشجو",
    dashPresent: "حاضر",
    dashAbsent: "غایب",
    chipFace: "تشخیص چهره",
    chipVoice: "تشخیص صدا",
    chipSecure: "ثبت امن",
    statsAria: "آمار و شاخص‌ها",
    stats: [
      { value: "۳", label: "روش بیومتریک", detail: "چهره، صدا و اثر انگشت" },
      { value: "۲۴/۷", label: "دسترسی آنلاین", detail: "مدیریت و گزارش در هر ساعت" },
      { value: "۳", label: "پنل اختصاصی", detail: "مدیر، استاد و دانشجو" },
      { value: "۱", label: "منبع حقیقت", detail: "پایگاه دادهٔ متمرکز" },
    ],
    featuresHead: {
      eyebrow: "امکانات",
      title: "هر آنچه برای حضور و غیاب دقیق نیاز دارید",
      text: "ترکیبی از روش‌های بیومتریک، مدیریت آموزشی و گزارش‌های تحلیلی در یک سامانهٔ یکپارچه.",
    },
    features: [
      {
        icon: "bi-camera-video",
        tone: "blue",
        title: "تشخیص چهره",
        text: "ثبت حضور بدون تماس با تشخیص چهره و بررسی زنده‌بودن، برای کلاس‌های پرجمعیت سریع و دقیق.",
      },
      {
        icon: "bi-mic",
        tone: "violet",
        title: "تشخیص صدا",
        text: "تأیید هویت از روی نمونهٔ صوتی؛ مناسب جلسات آنلاین و کلاس‌هایی که دوربین کافی ندارند.",
      },
      {
        icon: "bi-fingerprint",
        tone: "green",
        title: "اثر انگشت",
        text: "احراز هویت با حسگر اثر انگشت دستگاه و استاندارد WebAuthn؛ ساده، امن و بدون رمز عبور.",
      },
      {
        icon: "bi-camera-reels",
        tone: "orange",
        title: "دوربین کلاس و کلاس زنده",
        text: "پایش یکپارچهٔ حاضرین از دوربین کلاس و برگزاری جلسهٔ زنده با ثبت خودکار حضور.",
      },
      {
        icon: "bi-calendar2-check",
        tone: "teal",
        title: "مرخصی و ثبت دستی",
        text: "ثبت دستی با دلیل، مدیریت مرخصی و توجیه غیبت، و اعتراض به وضعیت حضور در یک چرخهٔ شفاف.",
      },
      {
        icon: "bi-graph-up-arrow",
        tone: "rose",
        title: "گزارش و تحلیل روند",
        text: "گزارش‌های لحظه‌ای، خروجی اکسل و تحلیل روند حضور برای تصمیم‌گیری بهتر آموزشی.",
      },
    ],
    stepsHead: {
      eyebrow: "نحوهٔ کار",
      title: "در چهار گام ساده شروع کنید",
      text: "از ورود کاربر تا گزارش نهایی، مسیر مشخص و کوتاه است.",
    },
    steps: [
      {
        icon: "bi-person-badge",
        title: "نقش خود را انتخاب کنید",
        text: "مدیر، استاد یا دانشجو؛ هر نقش پنل و دسترسی اختصاصی خود را دارد.",
      },
      {
        icon: "bi-fingerprint",
        title: "حضور را ثبت کنید",
        text: "با چهره، صدا، اثر انگشت، دوربین کلاس یا ثبت دستی — بسته به امکانات کلاس.",
      },
      {
        icon: "bi-patch-check",
        title: "تأیید و ثبت خودکار",
        text: "سامانه هویت را بررسی و وضعیت حضور را در پایگاه دادهٔ مرکزی ثبت می‌کند.",
      },
      {
        icon: "bi-bar-chart-line",
        title: "گزارش بگیرید",
        text: "وضعیت لحظه‌ای، درصد حضور و روند هفتگی را در داشبورد ببینید و خروجی بگیرید.",
      },
    ],
    rolesHead: {
      eyebrow: "نقش‌ها",
      title: "یک سامانه، سه تجربهٔ اختصاصی",
      text: "هر نقش دقیقاً همان چیزی را می‌بیند که برای کارش لازم است.",
    },
    roles: [
      {
        icon: "bi-shield-lock",
        tone: "blue",
        title: "مدیر سامانه",
        text: "مدیریت دانشجویان، اساتید، درس‌ها و دانشکده‌ها؛ تنظیمات سامانه، پذیرش درخواست‌ها و گزارش فعالیت.",
        points: ["مدیریت کاربران و نقش‌ها", "پذیرش و تأیید ثبت‌نام", "گزارش جامع و پشتیبان‌گیری"],
      },
      {
        icon: "bi-person-workspace",
        tone: "violet",
        title: "استاد",
        text: "ایجاد جلسه، ثبت حضور کلاس و پیگیری وضعیت دانشجویان؛ همراه با پشتیبانی و راهنما.",
        points: ["ثبت حضور چندروشی", "مدیریت جلسات و کلاس زنده", "تحلیل روند کلاس"],
      },
      {
        icon: "bi-mortarboard",
        tone: "green",
        title: "دانشجو",
        text: "مشاهدهٔ حضور، ثبت درخواست مرخصی و اعتراض، و پیگیری پاسخ پشتیبانی در پنل شخصی.",
        points: ["مشاهدهٔ درصد حضور", "ثبت مرخصی و اعتراض", "تیکت پشتیبانی و تقویم"],
      },
    ],
    securityHead: {
      eyebrow: "امنیت و حریم خصوصی",
      title: "اعتماد، از طراحی شروع می‌شود",
      text: "دسترسی‌ها نقش‌محور، داده‌ها متمرکز و پشتیبان‌گیری قابل کنترل است تا اطلاعات آموزشی و بیومتریک در جای امن بمانند.",
    },
    security: [
      {
        icon: "bi-person-lock",
        title: "دسترسی نقش‌محور",
        text: "هر کاربر فقط به بخش‌های مرتبط با نقش خود دسترسی دارد و عملیات حساس کنترل می‌شود.",
      },
      {
        icon: "bi-database-lock",
        title: "منبع حقیقت متمرکز",
        text: "همهٔ تغییرات از طریق API و پایگاه داده ثبت می‌شوند؛ داده‌ها پراکنده و ناهمگون نمی‌شوند.",
      },
      {
        icon: "bi-cloud-arrow-down",
        title: "پشتیبان‌گیری و بازیابی",
        text: "خروجی JSON از داده‌های سامانه با گزینه‌های انتخابی، و بازیابی کنترل‌شده با تأیید مدیر.",
      },
      {
        icon: "bi-incognito",
        title: "حریم خصوصی بیومتریک",
        text: "نمونه‌های صوتی و تصویری فقط برای احراز هویت استفاده می‌شوند و در دسترس همه نیستند.",
      },
    ],
    faqHead: {
      eyebrow: "سوالات متداول",
      title: "پاسخ سوال‌های رایج",
      text: "اگر پاسخ خود را پیدا نکردید، از بخش پشتیبانی در پنل کمک بگیرید.",
    },
    faqs: [
      {
        q: "راه‌اندازی سامانه چقدر زمان می‌برد؟",
        a: "چون سامانه به‌صورت وب اجرا می‌شود، کافی است آدرس سرویس API را تنظیم کنید. مدیر می‌تواند دانشکده، دانشجویان و اساتید را وارد کند و در همان روز اولین جلسه را ثبت کند.",
      },
      {
        q: "آیا به دوربین یا سخت‌افزار خاصی نیاز است؟",
        a: "برای تشخیص چهره یک دوربین معمولی وب یا دوربین لپ‌تاپ کافی است. برای اثر انگشت، دستگاه باید استاندارد WebAuthn را پشتیبانی کند. تشخیص صدا فقط به میکروفون نیاز دارد.",
      },
      {
        q: "اگر دانشجو به اینترنت دسترسی نداشته باشد چه می‌شود؟",
        a: "ثبت دستی و مرخصی همیشه در دسترس است. روش‌های بیومتریک به اتصال نیاز دارند، اما وضعیت نهایی در پایگاه دادهٔ مرکزی نگهداری می‌شود تا بعداً قابل پیگیری باشد.",
      },
      {
        q: "داده‌های بیومتریک چطور محافظت می‌شوند؟",
        a: "دسترسی به داده‌ها نقش‌محور است و نمونه‌ها فقط برای احراز هویت به کار می‌روند. مدیر می‌تواند از اطلاعات پشتیبان تهیه کند و بازیابی را با تأیید انجام دهد.",
      },
      {
        q: "آیا خروجی گزارش‌ها قابل استفاده در اکسل است؟",
        a: "بله. گزارش‌های حضور و غیاب را می‌توان به‌صورت فایل اکسل دریافت کرد و برای تحلیل یا بایگانی آموزشی به کار برد.",
      },
      {
        q: "پشتیبانی در دسترس است؟",
        a: "در هر سه پنل، بخش «پشتیبانی» با سوالات متداول، دستیار هوشمند و ارتباط با مدیر سامانه وجود دارد. دانشجویان و اساتید می‌توانند درخواست خود را ثبت یا پیگیری کنند.",
      },
    ],
    contactHead: {
      eyebrow: "تماس و موقعیت",
      title: "با ما در ارتباط باشید",
      text: "برای هماهنگی، پرسش یا مشاهدهٔ حضوری، از راه‌های زیر با ما در تماس باشید.",
    },
    contactAddressLabel: "نشانی",
    contactMapCta: "مشاهده روی نقشه",
    contactEmailLabel: "ایمیل",
    contactPhoneLabel: "تلفن",
    contactSocialLabel: "شبکه‌های اجتماعی",
    lastUpdated: "آخرین به‌روزرسانی",
    versionLabel: "نسخه",
    ctaTitle: "آماده‌اید حضور و غیاب را هوشمند کنید؟",
    ctaText:
      "همین حالا وارد سامانه شوید و اولین جلسهٔ خود را ثبت کنید؛ بدون نصب و بدون پیچیدگی.",
    footerTagline: "سامانه هوشمند حضور و غیاب و مدیریت آموزشی",
    footerLinksAria: "پیوندهای پانوشت",
    identity: "دانشجوی نرم‌افزار · دانشکده شهید شمسی‌پور",
    version: "نسخهٔ ۱.۰.۰",
    copyright: "© ۱۴۰۵ حضوربان · تمامی حقوق محفوظ است.",
    madeFor: "ساخته‌شده برای مدیریت هوشمند آموزش",
  },
  en: {
    brand: "Hozorban",
    brandTagline: "Smart Attendance System",
    brandAria: "Hozorban — back to top",
    navAria: "Home page menu",
    nav: [
      { id: "features", label: "Features" },
      { id: "how", label: "How it works" },
      { id: "roles", label: "Roles" },
      { id: "security", label: "Security" },
      { id: "faq", label: "FAQ" },
      { id: "contact", label: "Contact" },
    ],
    languageAria: "Change language",
    languageButton: "FA",
    themeLight: "Switch to light mode",
    themeDark: "Switch to dark mode",
    themeLightTitle: "Light mode",
    themeDarkTitle: "Dark mode",
    signIn: "Sign in",
    badge: "Version 1.0 · Ready to deploy",
    heroTitleStart: "Attendance,",
    heroTitleHighlight: "smart and contactless",
    heroLead:
      "Hozorban uses face, voice and fingerprint recognition to make class attendance fast, accurate and transparent — from the admin's live dashboard to the student's simple panel.",
    start: "Get started",
    explore: "Explore features",
    trust: ["Quick setup", "No dedicated hardware", "Works on mobile & desktop"],
    todayReport: "Today's report",
    todayAttendance: "Today's attendance",
    ringValue: "92%",
    dashStudents: "Students",
    dashPresent: "Present",
    dashAbsent: "Absent",
    chipFace: "Face recognition",
    chipVoice: "Voice recognition",
    chipSecure: "Secure check-in",
    statsAria: "Statistics and highlights",
    stats: [
      { value: "3", label: "Biometric methods", detail: "Face, voice & fingerprint" },
      { value: "24/7", label: "Online access", detail: "Manage and report any time" },
      { value: "3", label: "Dedicated panels", detail: "Admin, teacher & student" },
      { value: "1", label: "Single source of truth", detail: "Centralized database" },
    ],
    featuresHead: {
      eyebrow: "Features",
      title: "Everything you need for accurate attendance",
      text: "A blend of biometric methods, academic management and analytical reports in one unified system.",
    },
    features: [
      {
        icon: "bi-camera-video",
        tone: "blue",
        title: "Face recognition",
        text: "Touch-free check-in with face recognition and liveness detection — fast and accurate even for large classes.",
      },
      {
        icon: "bi-mic",
        tone: "violet",
        title: "Voice recognition",
        text: "Verify identity from a voice sample; ideal for online sessions and classrooms without enough cameras.",
      },
      {
        icon: "bi-fingerprint",
        tone: "green",
        title: "Fingerprint",
        text: "Authenticate with the device fingerprint sensor and WebAuthn; simple, secure and passwordless.",
      },
      {
        icon: "bi-camera-reels",
        tone: "orange",
        title: "Classroom camera & live class",
        text: "Unified monitoring from the classroom camera and live sessions with automatic attendance.",
      },
      {
        icon: "bi-calendar2-check",
        tone: "teal",
        title: "Leave & manual entry",
        text: "Manual entry with a reason, leave management, absence justification and attendance objections in one transparent flow.",
      },
      {
        icon: "bi-graph-up-arrow",
        tone: "rose",
        title: "Reports & trend analysis",
        text: "Real-time reports, Excel export and attendance trend analysis for better academic decisions.",
      },
    ],
    stepsHead: {
      eyebrow: "How it works",
      title: "Start in four simple steps",
      text: "From sign-in to the final report, the path is clear and short.",
    },
    steps: [
      {
        icon: "bi-person-badge",
        title: "Choose your role",
        text: "Admin, teacher or student — each role has its own panel and permissions.",
      },
      {
        icon: "bi-fingerprint",
        title: "Mark attendance",
        text: "Face, voice, fingerprint, classroom camera or manual entry — whatever the class supports.",
      },
      {
        icon: "bi-patch-check",
        title: "Verify automatically",
        text: "The system verifies identity and records attendance in the central database.",
      },
      {
        icon: "bi-bar-chart-line",
        title: "Get reports",
        text: "See live status, attendance rate and weekly trends in the dashboard, then export them.",
      },
    ],
    rolesHead: {
      eyebrow: "Roles",
      title: "One system, three tailored experiences",
      text: "Each role sees exactly what it needs to get its work done.",
    },
    roles: [
      {
        icon: "bi-shield-lock",
        tone: "blue",
        title: "Administrator",
        text: "Manage students, teachers, courses and faculties; system settings, request approvals and activity reports.",
        points: [
          "User and role management",
          "Registration review & approval",
          "Comprehensive reports & backups",
        ],
      },
      {
        icon: "bi-person-workspace",
        tone: "violet",
        title: "Teacher",
        text: "Create sessions, mark class attendance and follow up on students — with support and guidance.",
        points: [
          "Multi-method attendance",
          "Session & live class management",
          "Class trend analysis",
        ],
      },
      {
        icon: "bi-mortarboard",
        tone: "green",
        title: "Student",
        text: "View attendance, submit leave and objection requests, and follow up on support replies in a personal panel.",
        points: [
          "View attendance rate",
          "Submit leave & objections",
          "Support tickets & calendar",
        ],
      },
    ],
    securityHead: {
      eyebrow: "Security & privacy",
      title: "Trust starts with design",
      text: "Role-based access, centralized data and controlled backups keep academic and biometric information in a safe place.",
    },
    security: [
      {
        icon: "bi-person-lock",
        title: "Role-based access",
        text: "Each user can only reach the parts relevant to their role, and sensitive operations are tightly controlled.",
      },
      {
        icon: "bi-database-lock",
        title: "Central source of truth",
        text: "All changes go through the API and database, so data never becomes scattered or inconsistent.",
      },
      {
        icon: "bi-cloud-arrow-down",
        title: "Backup & restore",
        text: "Selective JSON export of system data, with a controlled restore confirmed by an administrator.",
      },
      {
        icon: "bi-incognito",
        title: "Biometric privacy",
        text: "Voice and image samples are used only for authentication and are never publicly accessible.",
      },
    ],
    faqHead: {
      eyebrow: "FAQ",
      title: "Answers to common questions",
      text: "If you can't find your answer, use the support section in the panel.",
    },
    faqs: [
      {
        q: "How long does it take to set up the system?",
        a: "Because it runs on the web, you only need to configure the API service address. An administrator can add the faculty, students and teachers, and record the first session the same day.",
      },
      {
        q: "Do I need a special camera or hardware?",
        a: "A regular webcam or laptop camera is enough for face recognition. For fingerprint, the device must support the WebAuthn standard. Voice recognition only needs a microphone.",
      },
      {
        q: "What if a student has no internet access?",
        a: "Manual entry and leave requests are always available. Biometric methods need a connection, but the final status is stored in the central database so it can be reviewed later.",
      },
      {
        q: "How is biometric data protected?",
        a: "Access to data is role-based and samples are only used for authentication. An administrator can create backups and perform a restore with explicit confirmation.",
      },
      {
        q: "Can reports be used in Excel?",
        a: "Yes. Attendance reports can be downloaded as Excel files and used for academic analysis or archiving.",
      },
      {
        q: "Is support available?",
        a: "All three panels include a Support section with FAQs, a smart assistant and direct contact with the administrator. Students and teachers can submit and track requests.",
      },
    ],
    contactHead: {
      eyebrow: "Contact & location",
      title: "Get in touch with us",
      text: "For coordination, questions or a visit, reach us through any of the channels below.",
    },
    contactAddressLabel: "Address",
    contactMapCta: "Open in Maps",
    contactEmailLabel: "Email",
    contactPhoneLabel: "Phone",
    contactSocialLabel: "Social networks",
    lastUpdated: "Last updated",
    versionLabel: "Version",
    ctaTitle: "Ready to make attendance smart?",
    ctaText:
      "Sign in now and record your first session — no installation and no complexity.",
    footerTagline: "Smart attendance and academic management system",
    footerLinksAria: "Footer links",
    identity: "Software Engineering Student · Shahid Shamsipour Faculty",
    version: "Version 1.0.0",
    copyright: "© 2026 Hozorban · All rights reserved.",
    madeFor: "Built for smart academic management",
  },
};

export function landingDate(lang, date = new Date()) {
  try {
    return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

export function landingTimestamp(lang, iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

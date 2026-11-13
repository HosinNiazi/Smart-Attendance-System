import { Icon } from "./shared.jsx";

const navLinks = [
  { id: "features", label: "امکانات" },
  { id: "how", label: "نحوهٔ کار" },
  { id: "roles", label: "نقش‌ها" },
  { id: "security", label: "امنیت" },
  { id: "faq", label: "سوالات متداول" },
];

const stats = [
  { value: "۳", label: "روش بیومتریک", detail: "چهره، صدا و اثر انگشت" },
  { value: "۲۴/۷", label: "دسترسی آنلاین", detail: "مدیریت و گزارش در هر ساعت" },
  { value: "۳", label: "پنل اختصاصی", detail: "مدیر، استاد و دانشجو" },
  { value: "۱", label: "منبع حقیقت", detail: "پایگاه دادهٔ متمرکز" },
];

const features = [
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
];

const steps = [
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
];

const roles = [
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
];

const securityItems = [
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
];

const faqs = [
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
];

function scrollTo(id) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function faDate() {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
  } catch {
    return "";
  }
}

export function Landing({ theme = "light", onToggleTheme, onEnter }) {
  return (
    <div className="landing" dir="rtl">
      <div className="landing-bg" aria-hidden="true">
        <span className="landing-blob blob-a" />
        <span className="landing-blob blob-b" />
        <span className="landing-blob blob-c" />
      </div>

      <header className="landing-header">
        <div className="landing-header-inner">
          <button
            type="button"
            className="landing-brand"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="حضوربان — بازگشت به بالای صفحه"
          >
            <span className="brand-mark">
              <Icon name="bi-fingerprint" />
            </span>
            <span className="landing-brand-text">
              <strong>حضوربان</strong>
              <small>سامانه هوشمند حضور و غیاب</small>
            </span>
          </button>

          <nav className="landing-nav" aria-label="منوی صفحهٔ اصلی">
            {navLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => scrollTo(link.id)}
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="landing-header-actions">
            <button
              type="button"
              className="icon-button landing-theme"
              aria-label={
                theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تیره"
              }
              title={theme === "dark" ? "تم روشن" : "تم تیره"}
              onClick={onToggleTheme}
            >
              <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
            </button>
            <button
              type="button"
              className="btn btn-primary landing-cta-sm"
              onClick={onEnter}
            >
              <Icon name="bi-box-arrow-in-left" /> ورود به سامانه
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero" id="top">
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <span className="landing-badge">
                <i className="live-dot" /> نسخهٔ ۱.۰ · آمادهٔ استقرار
              </span>
              <h1>
                حضور و غیاب،{" "}
                <span className="landing-grad">هوشمند و بدون تماس</span>
              </h1>
              <p>
                حضوربان با تشخیص چهره، صدا و اثر انگشت، ثبت حضور کلاس‌ها را
                سریع، دقیق و شفاف می‌کند؛ از داشبورد لحظه‌ای مدیر تا پنل سادهٔ
                دانشجو.
              </p>
              <div className="landing-hero-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onEnter}
                >
                  <Icon name="bi-rocket-takeoff" /> شروع کنید
                </button>
                <button
                  type="button"
                  className="btn btn-light-outline"
                  onClick={() => scrollTo("features")}
                >
                  <Icon name="bi-grid-1x2" /> مشاهدهٔ امکانات
                </button>
              </div>
              <ul className="landing-trust">
                <li>
                  <Icon name="bi-check2-circle" /> راه‌اندازی سریع
                </li>
                <li>
                  <Icon name="bi-check2-circle" /> بدون سخت‌افزار اختصاصی
                </li>
                <li>
                  <Icon name="bi-check2-circle" /> مناسب موبایل و دسکتاپ
                </li>
              </ul>
            </div>

            <div className="landing-hero-visual" aria-hidden="true">
              <div className="landing-dash">
                <div className="landing-dash-head">
                  <span className="landing-dash-live">
                    <span className="live-dot" /> گزارش امروز
                  </span>
                  <span className="landing-dash-date">{faDate()}</span>
                </div>
                <div className="landing-dash-body">
                  <div
                    className="landing-ring"
                    style={{
                      background:
                        "conic-gradient(#54deb0 0deg 331deg, rgba(255,255,255,.16) 331deg 360deg)",
                    }}
                  >
                    <div className="landing-ring-inner">
                      <strong>۹۲٪</strong>
                      <span>حضور امروز</span>
                    </div>
                  </div>
                  <div className="landing-dash-stats">
                    <div>
                      <strong>۲۸</strong>
                      <span>دانشجو</span>
                    </div>
                    <div>
                      <strong>۲۶</strong>
                      <span>حاضر</span>
                    </div>
                    <div>
                      <strong>۲</strong>
                      <span>غایب</span>
                    </div>
                  </div>
                </div>
                <div className="landing-dash-bars">
                  {[72, 88, 64, 94, 80, 90, 68].map((height, index) => (
                    <span key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
              <div className="landing-chip chip-face">
                <Icon name="bi-camera-video" /> تشخیص چهره
              </div>
              <div className="landing-chip chip-voice">
                <Icon name="bi-mic" /> تشخیص صدا
              </div>
              <div className="landing-chip chip-secure">
                <Icon name="bi-shield-check" /> ثبت امن
              </div>
            </div>
          </div>
        </section>

        <section className="landing-stats" aria-label="آمار و شاخص‌ها">
          <div className="landing-stats-inner">
            {stats.map((item) => (
              <div className="landing-stat" key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-section-head">
            <span className="landing-eyebrow">امکانات</span>
            <h2>هر آنچه برای حضور و غیاب دقیق نیاز دارید</h2>
            <p>
              ترکیبی از روش‌های بیومتریک، مدیریت آموزشی و گزارش‌های تحلیلی در یک
              سامانهٔ یکپارچه.
            </p>
          </div>
          <div className="landing-features">
            {features.map((feature) => (
              <article className="landing-feature" key={feature.title}>
                <span className={`landing-feature-icon landing-tone-${feature.tone}`}>
                  <Icon name={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-how" id="how">
          <div className="landing-section-head">
            <span className="landing-eyebrow">نحوهٔ کار</span>
            <h2>در چهار گام ساده شروع کنید</h2>
            <p>از ورود کاربر تا گزارش نهایی، مسیر مشخص و کوتاه است.</p>
          </div>
          <div className="landing-steps">
            {steps.map((step, index) => (
              <article className="landing-step" key={step.title}>
                <span className="landing-step-num">
                  {(index + 1).toLocaleString("fa-IR")}
                </span>
                <span className="landing-step-icon">
                  <Icon name={step.icon} />
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="roles">
          <div className="landing-section-head">
            <span className="landing-eyebrow">نقش‌ها</span>
            <h2>یک سامانه، سه تجربهٔ اختصاصی</h2>
            <p>هر نقش دقیقاً همان چیزی را می‌بیند که برای کارش لازم است.</p>
          </div>
          <div className="landing-roles">
            {roles.map((role) => (
              <article className="landing-role" key={role.title}>
                <span className={`landing-role-icon landing-tone-${role.tone}`}>
                  <Icon name={role.icon} />
                </span>
                <h3>{role.title}</h3>
                <p>{role.text}</p>
                <ul>
                  {role.points.map((point) => (
                    <li key={point}>
                      <Icon name="bi-check2" /> {point}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-security" id="security">
          <div className="landing-security-inner">
            <div className="landing-section-head align-start">
              <span className="landing-eyebrow">امنیت و حریم خصوصی</span>
              <h2>اعتماد، از طراحی شروع می‌شود</h2>
              <p>
                دسترسی‌ها نقش‌محور، داده‌ها متمرکز و پشتیبان‌گیری قابل کنترل
                است تا اطلاعات آموزشی و بیومتریک در جای امن بمانند.
              </p>
            </div>
            <div className="landing-security-grid">
              {securityItems.map((item) => (
                <article className="landing-security-item" key={item.title}>
                  <span className="landing-security-icon">
                    <Icon name={item.icon} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section" id="faq">
          <div className="landing-section-head">
            <span className="landing-eyebrow">سوالات متداول</span>
            <h2>پاسخ سوال‌های رایج</h2>
            <p>اگر پاسخ خود را پیدا نکردید، از بخش پشتیبانی در پنل کمک بگیرید.</p>
          </div>
          <div className="landing-faq">
            {faqs.map((item, index) => (
              <details className="landing-faq-item" key={item.q} open={index === 0}>
                <summary>
                  <span>{item.q}</span>
                  <Icon name="bi-chevron-down" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-cta">
          <div className="landing-cta-inner">
            <div>
              <h2>آماده‌اید حضور و غیاب را هوشمند کنید؟</h2>
              <p>
                همین حالا وارد سامانه شوید و اولین جلسهٔ خود را ثبت کنید؛ بدون
                نصب و بدون پیچیدگی.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={onEnter}>
              ورود به سامانه <Icon name="bi-arrow-left" />
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <span className="brand-mark">
              <Icon name="bi-fingerprint" />
            </span>
            <div>
              <strong>حضوربان</strong>
              <small>سامانه هوشمند حضور و غیاب و مدیریت آموزشی</small>
            </div>
          </div>
          <nav className="landing-footer-links" aria-label="پیوندهای پانوشت">
            {navLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => scrollTo(link.id)}
              >
                {link.label}
              </button>
            ))}
          </nav>
          <div className="landing-footer-meta">
            <a href="mailto:admin@hozorban.local">
              <Icon name="bi-envelope" /> admin@hozorban.local
            </a>
            <span>نسخهٔ ۱.۰.۰</span>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <span>© ۱۴۰۵ حضوربان · تمامی حقوق محفوظ است.</span>
          <span>ساخته‌شده برای مدیریت هوشمند آموزش</span>
        </div>
      </footer>
    </div>
  );
}

<div align="center">

# حضوربان | HOZORBAN

### سامانه هوشمند مدیریت حضور و غیاب · Smart Attendance Management System

رابط کاربری فارسی، راست‌چین و واکنش‌گرا با تم روشن/تیره · Persian RTL UI with light/dark theme

![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white)
![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)

> [فارسی](#فارسی) · [English](#english)

</div>

---

## فارسی

### معرفی پروژه

**حضوربان (Hozorban)** یک سامانهٔ فول‌استک برای مدیریت حضور و غیاب در محیط‌های آموزشی است: از ثبت‌نام و احراز هویت دانشجو تا ثبت حضور با چندین روش (دستی، تشخیص چهره با بررسی زنده بودن، تشخیص صدا، اثر انگشت واقعی با WebAuthn)، گزارش‌گیری واقعی، مرخصی و اعتراض، و پنل زندهٔ کلاس.

- **منبع حقیقت داده:** PostgreSQL (از طریق REST API؛ توکن JWT در `sessionStorage`)
- **رابط کاربری:** فارسی، RTL، واکنش‌گرا، تم روشن/تیره، تقویم کاملاً شمسی
- **مناسب اجرا روی localhost یا سرور داخلی دانشگاه**

### امکانات

#### پنل مدیر

| بخش | توضیح |
|---|---|
| داشبورد | آمار کلی: دانشجویان، جلسات، نرخ حضور امروز، نمودارها |
| دانشجویان | افزودن/ویرایش/حذف، جست‌وجو، آپلود عکس (پیش‌نمایش فوری)، ورود گروهی از Excel/CSV |
| دروس و کلاس‌ها | مدیریت درس‌ها، روز/ساعت برگزاری، ظرفیت، استاد |
| جلسات کلاس | تقویم شمسی ماهانهٔ جلسات، ساخت/ویرایش/نهایی‌سازی جلسه |
| ثبت دستی حضور | ثبت سریع حاضر/غایب/تأخیر برای هر دانشجو |
| تشخیص چهره AI | اسکن خودکار چهره با `face-api`؛ بررسی زنده بودن (پلک زدن با نسبت جنبهٔ چشم)؛ اسکن هر ۷۰ میلی‌ثانیه |
| دوربین کلاس | دوربین ثابت کلاس؛ اسکن پیوسته و ثبت خودکار حضور بدون نیاز به تعامل دانشجو |
| تشخیص صدا | عبارت ثابت ۱۰ واژه‌ای؛ ذخیرهٔ ویژگی‌های FFT (۲۴ bin) و مقایسهٔ آن‌ها |
| اثر انگشت | WebAuthn (اعتبارنامهٔ کلید-عمومی روی دستگاه؛ دادهٔ بیومتریک از دستگاه خارج نمی‌شود) |
| پنل زندهٔ کلاس | شروع/پایان جلسه، مشاهدهٔ وضعیت زنده و ثبت از همان‌جا، نوار زنده برای دانشجو |
| تحلیل روند | نرخ حضور/غیبت/تأخیر در بازه‌های ۷/۳۰/۹۰ روزه یا بازهٔ دلخواه شمسی + تفکیک به درس |
| گزارش‌ها | فیلتر از/تا، خروجی **Excel واقعی (.xlsx)** با استایل، چاپ/PDF، پاک‌کردن فیلتر |
| مرخصی و توجیه | بررسی درخواست‌های مرخصی (تکی و **گروهی**) و اعتراض‌های حضور؛ تأیید/رد با ثبت اعلان |
| پذیرش درخواست‌ها | بررسی درخواست‌های ثبت‌نام دانشجویان |
| تیکت‌ها | پاسخ به تیکت‌های پشتیبانی دانشجو (پذیرش/رد/بستن) |
| اساتید | افزودن استاد جدید، اتصال استاد موجود از دانشکده دیگر، غیرفعال‌سازی/فعال‌سازی، **بازنشانی رمز عبور** |
| تنظیمات | تنظیمات سامانه در سطح سازمان |

#### پورتال دانشجو

- نمای کلی حضور و آخرین وضعیت
- **تقویم من:** تقویم شمسی با جلسات و وضعیت حضور هر روز
- **مرخصی و توجیه:** ثبت درخواست مرخصی/توجیه غیبت (تاریخ شروع/پایان شمسی، پیوست)
- **اعتراض به حضور:** ثبت اعتراض دربارهٔ ثبت اشتباه (مثلاً «حاضر بودم ولی غایب ثبت شد»)
- **تیکت‌ها:** ارسال و پیگیری پاسخ پشتیبانی
- **ثبت اثر انگشت (خودثبت‌نامی):** فعال‌سازی WebAuthn روی دستگاه خود دانشجو
- **نمونهٔ صوتی:** ضبط نمونهٔ صدا برای تشخیص صدا
- **پروفایل:** آپلود/تغییر عکس پروفایل
- **کمک و ارتباط با ما:** دستیار راهنمای آفلاین (rule-based) + فرم تیکت

#### امکانات مشترک

- احراز هویت JWT با کنترل دسترسی مبتنی بر نقش (`admin` / `teacher` / `student`)
- **امنیت حساب استاد:** رمز موقت یک‌بارمصرف هنگام ساخت حساب؛ اجبار به تعیین رمز جدید در نخستین ورود (دیالوگ غیرقابل بستن)؛ رمز جدید حداقل ۸ کاراکتر، متفاوت از رمز فعلی و غیرقابل تکرار از ۵ رمز اخیر؛ قفل خودکار حساب پس از ۵ تلاش ناموفق ورود (به مدت ۵ دقیقه)؛ تاریخچهٔ ورود (IP، زمان، دستگاه) در صفحهٔ پروفایل
- **بازنشانی رمز استاد توسط مدیر:** تولید رمز موقت جدید، اجبار به تغییر در ورود بعدی و ارسال خودکار رمز موقت از طریق ایمیل (SMTP)؛ در صورت نبود SMTP، رمز در لاگ سرور و پاسخ API نمایش داده می‌شود
- **تقویم کاملاً شمسی:** تمام تاریخ‌ها شمسی نمایش داده می‌شوند؛ مقادیر داخلی ISO میلادی هستند
- نوتیفیکیشن واقعی (ذخیره در دیتابیس + شمارندهٔ خوانده‌نشده)
- تم روشن/تیره، RTL کامل، فونت Vazirmatn

### فناوری‌ها

| لایه | فناوری | نقش |
|---|---|---|
| Frontend | React 19, Vite 7, React Router 7 | رابط کاربری کامپوننتی |
| استایل | Bootstrap 5 + Bootstrap RTL + CSS سفارشی | طراحی واکنش‌گرا و راست‌چین |
| تشخیص چهره | `@vladmandic/face-api` (TinyFaceDetector + FaceLandmark68 + FaceRecognition) | اجرا در مرورگر؛ مدل‌ها در `public/models` |
| صدا | Web Audio API (تحلیل FFT) | استخراج ۲۴ ویژگی فرکانسی از عبارت ثابت |
| اثر انگشت | WebAuthn (`@simplewebauthn/browser`) | احراز هویت پلتفرمی (Windows Hello و …) |
| خروجی Excel | `xlsx-js-style` | فایل .xlsx واقعی و استایل‌دار |
| Backend | Node.js, Express 4, `pg`, `zod`, `helmet`, `express-rate-limit`, `multer`, `bcryptjs`, `jsonwebtoken` | REST API امن |
| Database | PostgreSQL 16 | منبع حقیقت؛ مایگریشن‌های نسخه‌بندی‌شده |
| DevOps | Docker + docker-compose | دیتابیس + API در کانتینر |

### معماری

```
┌─────────────────────────┐        /api (JWT)         ┌──────────────────────────┐
│  Frontend (Vite :5173)  │ ───────────────────────▶  │  Express API (:8080)      │
│  React 19 + RTL + PWA-  │   /uploads (عکس‌ها)       │  zod · helmet · rate-limit│
│  like SPA               │ ───────────────────────▶  │  JWT (bcrypt) · RBAC      │
└─────────────────────────┘                           └───────────┬──────────────┘
        │                                                        │ SQL
        │ face-api (client-side)                                 ▼
        ▼                                              ┌──────────────────────────┐
 public/models (local)                                 │  PostgreSQL 16           │
                                                       │  organizations · users ·  │
                                                       │  students · courses ·     │
                                                       │  sessions · attendance ·  │
                                                       │  leave_requests · …       │
                                                       └──────────────────────────┘
```

در محیط توسعه، Vite مسیرهای `/api` و `/uploads` را به `http://localhost:8080` پراکسی می‌کند (`vite.config.js`).
### پیش‌نیازها

- **Node.js 20+** (پیشنهاد: Node 22 LTS) و npm
- **PostgreSQL 16** (یا Docker برای اجرای دیتابیس در کانتینر)
- مرورگر به‌روز (Chrome / Edge) با دسترسی به دوربین و میکروفون
- برای دوربین و WebAuthn: اجرا روی `localhost` یا **HTTPS** الزامی است

### راه‌اندازی محلی

#### ۱) دریافت پروژه

```bash
git clone https://github.com/HosinNiazi/Smart-Attendance-System.git
cd Smart-Attendance-System
```

#### ۲) نصب وابستگی‌ها

```bash
npm install
npm --prefix server install
```

#### ۳) پیکربندی محیطی

```bash
copy .env.example .env
copy server\.env.example server\.env
```

فایل `server/.env` را ویرایش کنید: `DATABASE_URL`، `JWT_SECRET` (حداقل ۳۲ کاراکتر) و `CORS_ORIGIN` را درست تنظیم کنید.

نمونهٔ `server/.env` برای محیط توسعه:

```env
NODE_ENV=development
PORT=8080
DATABASE_URL=postgres://postgres:password@localhost:5432/hozorban
JWT_SECRET=replace_with_a_long_random_secret_of_at_least_32_characters
CORS_ORIGIN=http://localhost:5173

# اختیاری: ارسال رمز موقت استاد با ایمیل (در صورت عدم تنظیم، رمز در لاگ سرور چاپ و در پنل مدیر نمایش داده می‌شود)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=no-reply@example.com
# SMTP_PASSWORD=...
# SMTP_FROM=no-reply@example.com
```

#### ۴) مایگریشن و دادهٔ نمونه

```bash
npm run api:migrate          # ساخت/به‌روزرسانی جداول (۱۴ مایگریشن)
npm --prefix server run seed # دادهٔ نمونه: مدیر، دانشجو، درس‌ها
```

#### ۵) اجرا (دو ترمینال)

```bash
npm run api:dev   # بک‌اند روی :8080 (node --watch)
npm run dev       # فرانت‌اند روی :5173
```

سپس مرورگر را روی `http://localhost:5173` باز کنید.

#### حساب‌های دمو (بعد از seed)

| نقش | ایمیل | رمز |
|---|---|---|
| مدیر | `admin@hozorban.local` | `Admin@123456` |
| دانشجو | `student@hozorban.local` | `Student@123456` |

دادهٔ نمونه: ۶ دانشجو (`40123001` تا `40123006`) و ۴ درس (`CS301`, `CS204`, `CS210`, `MA205`).

### ساخت نسخهٔ نهایی

```bash
npm run build     # خروجی در dist/
npm run preview   # پیش‌نمایش محلی build
```

### اجرا با Docker

```bash
docker compose up -d --build
```

این دستور PostgreSQL 16 (با healthcheck) و API (روی `127.0.0.1:8080`) را بالا می‌آورد؛ کانتینر API قبل از اجرا مایگریشن‌ها را اعمال می‌کند. فرانت‌اند را جداگانه build و روی یک static host یا reverse proxy سرو کنید.

### اسکریپت‌ها

| محل | دستور | کار |
|---|---|---|
| ریشه | `npm run dev` | سرور توسعه Vite (:5173) |
| ریشه | `npm run build` | build نهایی |
| ریشه | `npm run preview` | پیش‌نمایش build |
| ریشه | `npm run api:dev` | بک‌اند با watch |
| ریشه | `npm run api:migrate` | اجرای مایگریشن‌ها |
| server | `npm run dev` / `start` | اجرای API (با node) |
| server | `npm run migrate` / `seed` | مایگریشن / دادهٔ نمونه |
### ساختار پروژه

```
├── index.html                 # نقطهٔ ورود SPA
├── vite.config.js             # پراکسی /api و /uploads به :8080
├── public/models/             # مدل‌های face-api (TinyFaceDetector…)
├── src/
│   ├── main.jsx · App.jsx     # bootstrap و مسیریابی نقش‌محور
│   ├── api/                   # client (JWT) + adapter (نگاشت به شکل فرانت)
│   ├── calendar/jalali.js     # تقویم شمسی (ساخت ماه، toJalali، …)
│   ├── components/            # pages.jsx، phase2.jsx، Sessions.jsx
│   │   ├── JalaliDateInput.jsx# ورودی تاریخ شمسی مدرن (پاپ‌اور پورتالی)
│   │   └── shared.jsx         # Badge/Icon/Skeleton/…
│   ├── face/liveness.js       # کشف پلک/چشم باز برای liveness
│   ├── voice/                 # ضبط، FFT و نمونهٔ صوتی
│   ├── reports/               # خروجی Excel استایل‌دار
│   ├── help/                  # دستیار راهنمای آفلاین + چت
│   └── styles.css             # استایل کلی + تم روشن/تیره
└── server/
    ├── migrations/            # 001 تا 014 (سازمان، کاربر، احراز، بیومتریک، …)
    ├── src/server.js          # بیش از ۶۰ مسیر REST
    ├── src/db.js · migrate.js · seed.js
    ├── uploads/students/      # عکس‌های پروفایل
    └── Dockerfile             # node:22-alpine؛ migrate + start
```

### مایگریشن‌های دیتابیس

`001_initial` (سازمان‌ها، کاربران، دانشجویان، درس‌ها، جلسات، حضور) → `002_biometrics_enhancements` → `003_consolidate_organizations` → `004_registration_requests` → `005_fingerprint` (WebAuthn) → `006_support_tickets` → `007_leave_objections_notifications` → `008_phase2` (مرخصی گروهی، پنل زنده، ایندکس‌های تحلیل روند) → `009_faculties` → `010_teacher_management` → `011_teacher_password_change` → `012_course_ownership` → `013_password_recovery` (تاریخچهٔ ورود، جلوگیری از تکرار رمز) → `014_add_user_security_columns` (قفل حساب و تلاش‌های ناموفق)

### خلاصهٔ API (بیش از ۶۰ مسیر)

| گروه | نمونه مسیرها |
|---|---|
| احراز هویت | POST /api/auth/login · GET /api/me · GET /api/bootstrap |
| دانشجویان | GET/POST /api/students · PATCH /api/students/:id · POST …/photos · POST /api/import/students |
| دروس و جلسات | POST/PATCH/DELETE /api/courses · POST/PATCH /api/sessions · POST …/finalize |
| حضور | PUT /api/attendance · PATCH /api/attendance/:id |
| حضور زنده | GET /api/sessions/live · GET /api/sessions/:id/live · POST …/live/start · POST …/live/end |
| تحلیل | GET /api/analytics/trend · GET /api/analytics/courses |
| مرخصی و اعتراض | POST/GET /api/leave-requests · POST /api/leave-requests/bulk · POST …/:id/review · POST/GET /api/attendance-objections |
| نوتیفیکیشن | GET /api/notifications · GET …/unread-count · POST …/read · POST …/read-all |
| اثر انگشت | POST/GET/DELETE /api/fingerprint/credentials · POST …/self/options · POST …/authenticate/verify |
| سایر | تیکت‌ها · درخواست‌های ثبت‌نام · تنظیمات · نمونهٔ صدا · آپلود عکس |

### امنیت و حریم خصوصی

- گذرواژه‌ها با **bcrypt (cost=12)** هش می‌شوند؛ توکن JWT با نقش و شناسهٔ سازمان صادر می‌شود.
- helmet، محدودسازی نرخ درخواست (express-rate-limit)، اعتبارسنجی ورودی‌ها با **zod**، CORS محدود به CORS_ORIGIN.
- **دادهٔ بیومتریک:** اثر انگشت فقط به‌شکل اعتبارنامهٔ WebAuthn (کلید عمومی) ذخیره می‌شود؛ چهره و صدا بیشتر در مرورگر پردازش می‌شوند و فقط ارجاع/ویژگی ذخیره می‌گردد.
- برای داده‌های هویتی، رضایت آگاهانه و امکان بازبینی انسانی نتیجهٔ تشخیص الزامی است؛ لاگ عملیات مهم نگهداری کنید.
- در تولید حتماً JWT_SECRET قوی، HTTPS و محدودسازی دسترسی دیتابیس اعمال شود.

### وضعیت پروژه

هستهٔ سامانه (احراز هویت، مدیریت، ثبت حضور چندروشه، گزارش واقعی، مرخصی/اعتراض/اعلان، پنل زنده، تقویم شمسی) **پیاده‌سازی و اجراشده** است. بخش‌های در حال تکامل: دقت مدل چهره در نور کم، پوشش بیشتر تست خودکار.

### توسعه‌دهنده

**محمد حسین نیازی ایوری** — دانشجوی نرم‌افزار، دانشگاه شهید شمسی‌پور تهران

Repository: [github.com/HosinNiazi/Smart-Attendance-System](https://github.com/HosinNiazi/Smart-Attendance-System)

---

## English

### Overview

**Hozorban** is a full-stack smart attendance platform for educational environments. It covers the whole lifecycle: student enrollment & authentication, multi-method attendance capture (manual, AI face recognition with liveness, fixed-phrase voice check, real fingerprint via WebAuthn), real reporting, leave requests & objections, notifications, and a live classroom panel.

- **Source of truth:** PostgreSQL via a REST API (JWT in `sessionStorage`)
- **UI:** Persian, RTL, responsive, light/dark theme, fully Jalali (Persian) calendar
- **Deployable on localhost or an internal campus server**

### Features

#### Admin panel

| Module | Description |
|---|---|
| Dashboard | Global stats: students, sessions, today's attendance rate, charts |
| Students | Add/edit/delete, search, photo upload (instant preview), bulk Excel/CSV import |
| Courses | Manage courses, schedule, capacity, instructor |
| Sessions | Jalali month calendar of sessions; create/edit/finalize sessions |
| Manual attendance | Quick present/absent/late marking |
| Face AI attendance | Auto face scanning with face-api; liveness via eye-aspect-ratio blink detection; 70 ms scan interval |
| Classroom camera | Fixed classroom camera; continuous silent scanning and automatic check-in |
| Voice attendance | Fixed 10-word Persian phrase; FFT feature vectors (24 bins) stored & compared |
| Fingerprint | WebAuthn (public-key credentials; biometrics never leave the device) |
| Live class panel | Start/end session, watch live status, mark from the same screen; students see a live banner |
| Trend analytics | Present/absent/late rates over 7/30/90-day or custom Jalali ranges, per-course breakdown |
| Reports | From/to filters, real styled **.xlsx export**, print/PDF, one-click filter reset |
| Leave & objections | Review (individual & **group**) leave requests and attendance objections; approve/reject with notifications |
| Registration requests | Approve/reject incoming student registration requests |
| Support tickets | Respond/accept/reject/close student tickets |
| Settings | Organization-level configuration |

#### Student portal

- Personal attendance overview and latest status
- **My calendar:** Jalali calendar with per-day sessions and attendance state
- **Leave & excuse:** request leave/absence excuse with Jalali start/end dates and attachment
- **Attendance objections:** dispute an incorrect record (e.g. marked absent while present)
- **Support tickets:** submit and track responses
- **Fingerprint self-enrollment:** register the device authenticator yourself
- **Voice sample:** record a voice sample for voice attendance
- **Profile:** upload/change profile photo
- **Help:** offline rule-based assistant chat + support contact form

#### Shared platform

- JWT authentication with role-based access control (`admin` / `teacher` / `student`)
- **Full Jalali calendar:** all dates display in Persian; values are stored as ISO internally
- Real database-backed notifications with unread counter
- Light/dark theme, full RTL, Vazirmatn font

### Tech stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 19, Vite 7, React Router 7 | Component-based SPA |
| Styling | Bootstrap 5 + RTL + custom CSS | Responsive RTL design |
| Face recognition | `@vladmandic/face-api` (TinyFaceDetector + 68-point landmarks + recognition) | Runs in the browser; models in `public/models` |
| Voice | Web Audio API (FFT analysis) | 24-bin frequency features from the fixed phrase |
| Fingerprint | WebAuthn (`@simplewebauthn/browser`) | Platform authenticator (Windows Hello, etc.) |
| Excel export | `xlsx-js-style` | Real, styled `.xlsx` files |
| Backend | Node.js, Express 4, `pg`, `zod`, `helmet`, `express-rate-limit`, `multer`, `bcryptjs`, `jsonwebtoken` | Secure REST API |
| Database | PostgreSQL 16 | Source of truth; versioned SQL migrations |
| DevOps | Docker + docker-compose | Database + API containers |

### Architecture

```
┌─────────────────────────┐        /api (JWT)         ┌──────────────────────────┐
│  Frontend (Vite :5173)  │ ───────────────────────▶  │  Express API (:8080)     │
│  React 19 + RTL SPA     │   /uploads (photos)       │  zod · helmet · rate-limit│
└─────────────────────────┘ ───────────────────────▶  │  JWT (bcrypt) · RBAC     │
        │                                             └───────────┬──────────────┘
        │ face-api in the browser                                 │ SQL
        ▼                                                         ▼
 public/models (local)                                ┌──────────────────────────┐
                                                      │  PostgreSQL 16           │
                                                      │  organizations · users · │
                                                      │  students · sessions ·   │
                                                      │  attendance · leave_req… │
                                                      └──────────────────────────┘
```

In development, Vite proxies `/api` and `/uploads` to `http://localhost:8080` (see `vite.config.js`).

### Prerequisites

- **Node.js 20+** (Node 22 LTS recommended) and npm
- **PostgreSQL 16** (or Docker)
- A modern browser (Chrome / Edge) with camera & microphone access
- Camera and WebAuthn require **localhost or HTTPS**

### Getting started

```bash
git clone https://github.com/HosinNiazi/Smart-Attendance-System.git
cd Smart-Attendance-System

# 1) Install dependencies
npm install
npm --prefix server install

# 2) Configure environment
copy .env.example .env               # Windows (use cp on Linux/macOS)
copy server\.env.example server\.env
# edit server/.env: DATABASE_URL, JWT_SECRET (>= 32 chars), CORS_ORIGIN

# 3) Migrate + seed demo data
npm run api:migrate
npm --prefix server run seed

# 4) Run (two terminals)
npm run api:dev    # backend on :8080 (node --watch)
npm run dev        # frontend on :5173
```

Open `http://localhost:5173`.

#### Demo accounts (after seeding)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@hozorban.local` | `Admin@123456` |
| Student | `student@hozorban.local` | `Student@123456` |

Seed data: 6 students (`40123001`–`40123006`) and 4 courses (`CS301`, `CS204`, `CS210`, `MA205`).

Example `server/.env` for local development:

```env
NODE_ENV=development
PORT=8080
DATABASE_URL=postgres://postgres:password@localhost:5432/hozorban
JWT_SECRET=replace_with_a_long_random_secret_of_at_least_32_characters
CORS_ORIGIN=http://localhost:5173

# اختیاری: ارسال رمز موقت استاد با ایمیل (در صورت عدم تنظیم، رمز در لاگ سرور چاپ و در پنل مدیر نمایش داده می‌شود)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=no-reply@example.com
# SMTP_PASSWORD=...
# SMTP_FROM=no-reply@example.com
```

### Production build

```bash
npm run build     # outputs to dist/
npm run preview   # local preview of the build
```

### Docker

```bash
docker compose up -d --build
```

Starts PostgreSQL 16 (with healthcheck) and the API on `127.0.0.1:8080`; the API container applies migrations before boot. Serve the frontend build separately (static host or reverse proxy).

### Scripts

| Location | Command | Purpose |
|---|---|---|
| root | `npm run dev` / `build` / `preview` | Vite dev server / production build / preview |
| root | `npm run api:dev` / `api:migrate` | Backend with watch / run migrations |
| server | `npm run dev` / `start` | Run the API |
| server | `npm run migrate` / `seed` | Migrations / demo seed |

### Project structure

```
├── index.html                 # SPA entry
├── vite.config.js             # proxies /api and /uploads to :8080
├── public/models/             # face-api models (TinyFaceDetector, landmarks, recognition)
├── src/
│   ├── main.jsx · App.jsx     # bootstrap & role-based routing
│   ├── api/                   # client (JWT) + adapter (API → UI shape)
│   ├── calendar/jalali.js     # Jalali calendar helpers (buildJalaliMonth, toJalali, …)
│   ├── components/
│   │   ├── JalaliDateInput.jsx# modern Persian date picker (portal popover)
│   │   ├── pages.jsx · phase2.jsx · Sessions.jsx · shared.jsx
│   ├── face/liveness.js       # blink / eye-open liveness detection
│   ├── voice/                 # recording, FFT feature store
│   ├── reports/               # styled Excel export
│   ├── help/                  # offline rule-based assistant + chat
│   └── styles.css             # global styles + light/dark theme
└── server/
    ├── migrations/            # 001 → 014 (org, users, auth, biometrics, …)
    ├── src/server.js          # 60+ REST routes
    ├── src/db.js · migrate.js · seed.js
    ├── uploads/students/      # profile photos
    └── Dockerfile             # node:22-alpine; migrate + start
```

### Database migrations

`001_initial` (organizations, users, students, courses, sessions, attendance) → `002_biometrics_enhancements` → `003_consolidate_organizations` → `004_registration_requests` → `005_fingerprint` (WebAuthn) → `006_support_tickets` → `007_leave_objections_notifications` → `008_phase2` (group leave, live sessions, trend-analytics indexes) → `009_faculties` → `010_teacher_management` → `011_teacher_password_change` → `012_course_ownership` → `013_password_recovery` (login history, password reuse prevention) → `014_add_user_security_columns` (account lockout, failed attempts)

### API overview (60+ routes)

| Group | Examples |
|---|---|
| Auth | `POST /api/auth/login` · `GET /api/me` · `GET /api/bootstrap` |
| Students | `GET/POST /api/students` · `PATCH /api/students/:id` · `POST …/photos` · `POST /api/import/students` |
| Courses & sessions | `POST/PATCH/DELETE /api/courses` · `POST/PATCH /api/sessions` · `POST …/finalize` |
| Attendance | `PUT /api/attendance` · `PATCH /api/attendance/:id` |
| Live attendance | `GET /api/sessions/live` · `GET /api/sessions/:id/live` · `POST …/live/start` · `POST …/live/end` |
| Analytics | `GET /api/analytics/trend` · `GET /api/analytics/courses` |
| Leave & objections | `POST/GET /api/leave-requests` · `POST /api/leave-requests/bulk` · `POST …/:id/review` · `POST/GET /api/attendance-objections` |
| Notifications | `GET /api/notifications` · `GET …/unread-count` · `POST …/read` · `POST …/read-all` |
| Fingerprint | `POST/GET/DELETE /api/fingerprint/credentials` · `POST …/self/options` · `POST …/authenticate/verify` |
| Misc | tickets · registration requests · settings · voice samples · photo upload |

### Security & privacy

- Passwords hashed with **bcrypt (cost 12)**; JWT carries role + organization id.
- `helmet`, `express-rate-limit`, **zod**-validated inputs, CORS locked to `CORS_ORIGIN`.
- **Biometric data:** fingerprints are stored only as WebAuthn public-key credentials; face and voice are processed in-browser and only references/features are persisted.
- For identity data: informed consent and human review of uncertain recognitions are mandatory; keep audit logs of important actions.
- In production always set a strong `JWT_SECRET`, enforce HTTPS, and restrict database access.

### Project status

The core platform (auth, administration, multi-method attendance, real reporting, leave/objections/notifications, live panel, Jalali calendar) is **implemented and running**. Evolving areas: face-model accuracy in low light and broader automated test coverage.

### Developer

**Mohammad Hossein Niazi Ivri** — Software Engineering student, Shahid Shamsipour University of Tehran

Repository: [github.com/HosinNiazi/Smart-Attendance-System](https://github.com/HosinNiazi/Smart-Attendance-System)

---

<div align="center">

**HOZORBAN — Smart Attendance Management System**

هوشمندسازی مدیریت حضور و غیاب در محیط‌های آموزشی

</div>

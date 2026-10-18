# 🎓 Smart Attendance System | سامانه حضور و غیاب هوشمند

**An intelligent attendance management system using face recognition technology.**

**سامانه‌ای هوشمند برای مدیریت و ثبت حضور و غیاب دانشجویان با استفاده از فناوری تشخیص چهره.**

---

## 🌐 Languages | زبان‌ها

- [فارسی](#-فارسی)
- [English](#-english)

---

# 🇮🇷 فارسی

## 📌 معرفی پروژه

**سامانه حضور و غیاب هوشمند (Smart Attendance System)** پروژه‌ای نرم‌افزاری با هدف هوشمندسازی فرایند ثبت، مدیریت و گزارش‌گیری حضور و غیاب دانشجویان است.

هدف این پروژه، توسعه یک سامانه تحت وب است که بتواند با استفاده از وب‌کم لپ‌تاپ و فناوری تشخیص چهره، فرایند ثبت حضور دانشجویان را ساده‌تر، سریع‌تر و دقیق‌تر کند.

این پروژه به‌صورت مرحله‌ای توسعه داده می‌شود و در نسخه نهایی، بخش رابط کاربری، سرور، پایگاه داده و موتور تشخیص چهره با یکدیگر یکپارچه خواهند شد.

## 🎯 اهداف پروژه

- کاهش نیاز به ثبت دستی حضور و غیاب
- استفاده از تشخیص چهره برای شناسایی دانشجویان
- ثبت و مدیریت اطلاعات دانشجویان
- مدیریت کلاس‌ها و جلسات آموزشی
- ذخیره‌سازی سوابق حضور و غیاب
- تهیه گزارش‌های حضور و غیاب
- ایجاد رابط کاربری مدرن، واکنش‌گرا و فارسی
- طراحی معماری قابل توسعه و نگهداری

## ✨ قابلیت‌ها

### قابلیت‌های رابط کاربری

- رابط کاربری تحت وب با React
- طراحی راست‌چین (RTL) و پشتیبانی از زبان فارسی
- استفاده از Bootstrap 5 برای طراحی واکنش‌گرا
- نمایش اطلاعات و وضعیت‌های سامانه
- بخش اختصاصی حضور و غیاب با دوربین
- نمایش وضعیت اتصال دوربین و مدیریت خطاها

### قابلیت‌های برنامه‌ریزی‌شده

- ثبت‌نام و مدیریت دانشجویان
- مدیریت کلاس‌ها و جلسات
- شناسایی دانشجو با استفاده از تشخیص چهره
- ثبت خودکار حضور پس از تأیید هویت
- جلوگیری از ثبت تکراری حضور در یک جلسه
- ذخیره اطلاعات در پایگاه داده SQL Server
- گزارش‌گیری روزانه، هفتگی و ماهانه
- مدیریت کاربران و سطوح دسترسی
- اتصال رابط کاربری به API سمت سرور

> **وضعیت توسعه:** قابلیت‌های بالا شامل امکانات فعلی و اهداف توسعه هستند. اتصال کامل به پایگاه داده، تشخیص چهره واقعی و ثبت خودکار حضور باید پس از پیاده‌سازی و آزمایش اجزای مربوطه تأیید شوند.

## 🛠️ فناوری‌های مورد استفاده

| فناوری | کاربرد |
|---|---|
| HTML5 | ساختار صفحات وب |
| CSS3 | طراحی و استایل‌دهی |
| JavaScript | منطق سمت کاربر |
| React | توسعه رابط کاربری |
| Vite | اجرای محیط توسعه و ساخت پروژه |
| Bootstrap 5 | طراحی واکنش‌گرا |
| Node.js | محیط اجرای سرور |
| Express.js | توسعه API سمت سرور |
| Microsoft SQL Server | ذخیره‌سازی اطلاعات |
| Python | پیاده‌سازی بخش پردازش تصویر |
| FastAPI | ارائه API برای موتور تشخیص چهره |

*فناوری‌های سمت سرور و تشخیص چهره، بخشی از معماری هدف پروژه هستند و استفاده عملی از آن‌ها به تکمیل و یکپارچه‌سازی این بخش‌ها بستگی دارد.*

## 🏗️ معماری پیشنهادی

```text
Smart Attendance System
│
├── Frontend
│   ├── React
│   ├── Vite
│   ├── JavaScript
│   └── Bootstrap 5 RTL
│
├── Backend
│   ├── Node.js
│   ├── Express.js
│   └── REST API
│
├── Database
│   └── Microsoft SQL Server
│
└── Face Recognition Service
    ├── Python
    ├── FastAPI
    └── Face Recognition Engine
```

### روند کلی عملکرد

1. وب‌کم لپ‌تاپ تصویر دانشجو را دریافت می‌کند.
2. تصویر برای پردازش به سرویس تشخیص چهره ارسال می‌شود.
3. سرویس، هویت فرد را با اطلاعات ثبت‌شده مقایسه می‌کند.
4. در صورت تأیید هویت و معتبر بودن جلسه، درخواست ثبت حضور به سرور ارسال می‌شود.
5. سرور اطلاعات حضور را در پایگاه داده ذخیره می‌کند.
6. نتیجه در رابط کاربری نمایش داده می‌شود.

این روند، معماری هدف سامانه است و پس از پیاده‌سازی و آزمایش اجزا فعال خواهد شد.

## 💻 پیش‌نیازها

برای اجرای نسخه فعلی رابط کاربری به موارد زیر نیاز دارید:

- Node.js و npm
- مرورگر به‌روز مانند Google Chrome
- دسترسی به وب‌کم لپ‌تاپ برای آزمایش قابلیت دوربین

برای نسخه کامل پروژه نیز نصب و پیکربندی Node.js، SQL Server و Python موردنیاز خواهد بود.

## 🚀 راه‌اندازی پروژه

### ۱. دریافت مخزن

```bash
git clone YOUR_REPOSITORY_URL
cd smart-attendance-frontend
```

`YOUR_REPOSITORY_URL` را با آدرس واقعی مخزن خود جایگزین کنید.

### ۲. نصب وابستگی‌ها

```bash
npm install
```

### ۳. اجرای محیط توسعه

```bash
npm run dev
```

سپس آدرس محلی نمایش‌داده‌شده در ترمینال را در مرورگر باز کنید. معمولاً این آدرس به شکل زیر است:

```text
http://localhost:5173
```

> برای دسترسی به وب‌کم، مجوز دوربین مرورگر و دسترسی دوربین در تنظیمات ویندوز باید فعال باشد. در صورت استفاده از آدرس شبکه یا اجرای غیرامن، دسترسی دوربین ممکن است محدود شود.

## 📁 ساختار پیشنهادی پروژه

```text
smart-attendance-system/
│
├── smart-attendance-frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── assets/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── smart-attendance-backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── config/
│   ├── package.json
│   └── server.js
│
├── face-recognition-service/
│   ├── app/
│   ├── requirements.txt
│   └── main.py
│
├── database/
│   └── schema.sql
│
├── .gitignore
└── README.md
```

*این ساختار، پیشنهاد توسعه پروژه است و لزوماً با ساختار فعلی فایل‌های مخزن یکسان نیست.*

## 🔒 امنیت و حریم خصوصی

از آنجا که سامانه با تصاویر چهره و اطلاعات هویتی کار می‌کند، رعایت اصول زیر اهمیت دارد:

- دریافت رضایت آگاهانه کاربران برای پردازش داده‌های چهره
- محافظت از اطلاعات شخصی و داده‌های بیومتریک
- محدود کردن دسترسی به اطلاعات بر اساس نقش کاربران
- استفاده از ارتباط امن در محیط عملیاتی
- جلوگیری از ثبت چندباره حضور برای یک دانشجو در یک جلسه
- نگهداری امن اطلاعات احراز هویت و تنظیمات اتصال
- تعریف سیاست مشخص برای نگهداری و حذف تصاویر و داده‌های چهره

تشخیص چهره به‌تنهایی تضمین‌کننده زنده بودن تصویر یا جلوگیری از جعل هویت نیست؛ برای استفاده واقعی باید راهکارهای مناسب تشخیص جعل و ارزیابی امنیت نیز در نظر گرفته شوند.

## 🗺️ نقشه راه توسعه

- [x] شروع توسعه رابط کاربری
- [x] راه‌اندازی اولیه محیط React و Vite
- [ ] تکمیل و آزمایش اتصال وب‌کم داخلی لپ‌تاپ
- [ ] طراحی و پیاده‌سازی API سمت سرور
- [ ] طراحی جداول پایگاه داده SQL Server
- [ ] پیاده‌سازی سرویس تشخیص چهره
- [ ] اتصال سرویس تشخیص چهره به سرور
- [ ] ثبت خودکار حضور و جلوگیری از ثبت تکراری
- [ ] توسعه پنل مدیریت دانشجویان و کلاس‌ها
- [ ] ایجاد گزارش‌های حضور و غیاب
- [ ] انجام آزمون‌های امنیتی و عملکردی
- [ ] آماده‌سازی نسخه قابل استقرار

## 🤝 مشارکت

پیشنهادها، گزارش خطاها و مشارکت در توسعه پروژه استقبال می‌شوند. برای مشارکت:

1. مخزن را Fork کنید.
2. یک Branch جدید ایجاد کنید.
3. تغییرات خود را اعمال کنید.
4. یک Pull Request ارسال کنید.

## 📄 مجوز استفاده

مجوز پروژه هنوز مشخص نشده است. پیش از انتشار عمومی، مجوز مناسب را انتخاب کرده و فایل `LICENSE` را به مخزن اضافه کنید.

---

# 🇬🇧 English

## 📌 Project Overview

**Smart Attendance System** is a web-based software project designed to modernize student attendance tracking and management.

The goal is to build a system that uses a laptop webcam and face recognition technology to simplify attendance recording, reduce manual work, and provide reliable attendance records.

The project is being developed incrementally. The intended final architecture integrates a web frontend, a backend API, a relational database, and a dedicated face recognition service.

## 🎯 Project Goals

- Reduce manual attendance recording.
- Identify students using face recognition.
- Manage student profiles, classes, and sessions.
- Store and retrieve attendance records.
- Generate attendance reports.
- Provide a modern, responsive, Persian-friendly interface.
- Build a maintainable and extensible software architecture.

## ✨ Features

### Current Frontend Focus

- React-based web interface.
- Right-to-left (RTL) layout and Persian language support.
- Responsive UI built with Bootstrap 5.
- Attendance interface with webcam access.
- Camera status handling and error messages.

### Planned Features

- Student registration and management.
- Class and session management.
- Face-based student identification.
- Automatic attendance recording after identity verification.
- Duplicate attendance prevention.
- Microsoft SQL Server integration.
- Daily, weekly, and monthly attendance reports.
- User management and role-based access control.
- Frontend integration with backend APIs.

> **Development status:** The list includes both current frontend work and planned functionality. Backend integration, database persistence, real face recognition, and automatic attendance recording must be implemented and tested before being considered complete.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Web page structure |
| CSS3 | Styling |
| JavaScript | Client-side logic |
| React | Frontend development |
| Vite | Development server and build tooling |
| Bootstrap 5 | Responsive UI |
| Node.js | Backend runtime |
| Express.js | Backend API |
| Microsoft SQL Server | Relational database |
| Python | Image processing and recognition |
| FastAPI | Face recognition service API |

*Backend and face recognition technologies represent the planned architecture and may not yet be fully integrated.*

## 🏗️ Proposed Architecture

```text
Smart Attendance System
│
├── Frontend
│   ├── React
│   ├── Vite
│   ├── JavaScript
│   └── Bootstrap 5 RTL
│
├── Backend
│   ├── Node.js
│   ├── Express.js
│   └── REST API
│
├── Database
│   └── Microsoft SQL Server
│
└── Face Recognition Service
    ├── Python
    ├── FastAPI
    └── Face Recognition Engine
```

### Expected Workflow

1. The laptop webcam captures a student's image.
2. The image is processed by the face recognition service.
3. The service compares the detected identity with registered student data.
4. If identity verification and session validation succeed, an attendance request is sent to the backend.
5. The backend stores the attendance record in the database.
6. The result is displayed in the frontend.

This workflow describes the intended system behavior and will become operational as the required components are implemented and integrated.

## 💻 Prerequisites

To run the current frontend:

- Node.js and npm
- A modern browser, such as Google Chrome
- Webcam access for testing the camera interface

The complete system will additionally require a configured Node.js backend, Microsoft SQL Server, and Python environment.

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone YOUR_REPOSITORY_URL
cd smart-attendance-frontend
```

Replace `YOUR_REPOSITORY_URL` with your actual repository URL.

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open the local URL printed in the terminal. It is commonly:

```text
http://localhost:5173
```

> Webcam access requires browser permission and appropriate Windows camera privacy settings. Camera access may be restricted when using an insecure origin or an unsupported address.

## 📁 Proposed Project Structure

```text
smart-attendance-system/
│
├── smart-attendance-frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── assets/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── smart-attendance-backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── config/
│   ├── package.json
│   └── server.js
│
├── face-recognition-service/
│   ├── app/
│   ├── requirements.txt
│   └── main.py
│
├── database/
│   └── schema.sql
│
├── .gitignore
└── README.md
```

*This is a proposed structure for future development and may differ from the current repository layout.*

## 🔒 Security and Privacy

Since the system processes facial images and identity-related information, privacy and security are essential.

- Obtain informed consent before processing facial data.
- Protect personal and biometric information.
- Apply role-based access controls.
- Use secure communication in production.
- Prevent duplicate attendance records.
- Protect authentication credentials and database configuration.
- Define clear data retention and deletion policies.

Face recognition alone does not guarantee liveness detection or protection against spoofing. A production deployment should include appropriate anti-spoofing measures and security testing.

## 🗺️ Development Roadmap

- [x] Begin frontend development.
- [x] Set up the initial React and Vite environment.
- [ ] Complete and test laptop webcam access.
- [ ] Implement the backend API.
- [ ] Design the SQL Server database schema.
- [ ] Implement the face recognition service.
- [ ] Integrate the recognition service with the backend.
- [ ] Implement automatic attendance recording.
- [ ] Prevent duplicate attendance entries.
- [ ] Develop student and class management panels.
- [ ] Generate attendance reports.
- [ ] Perform security and performance testing.
- [ ] Prepare a deployable release.

## 🤝 Contributing

Contributions, bug reports, and suggestions are welcome.

1. Fork the repository.
2. Create a new branch.
3. Make your changes.
4. Submit a Pull Request.

## 📄 License

The project license has not been selected yet. Choose an appropriate open-source license and add a `LICENSE` file before publicly distributing the project.

---

**Developed as an ongoing software project focused on web development, automation, and face recognition.**

**در حال توسعه با هدف یادگیری و پیاده‌سازی توسعه وب، خودکارسازی و تشخیص چهره.**

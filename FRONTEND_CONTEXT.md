# Hozorban Smart Attendance System - Frontend Complete Context

> **Purpose**: Complete technical documentation for the React/Vite/Bootstrap frontend so other agents can understand, extend, or rebuild the UI layer without ambiguity.

---

## 1. Project Overview

| Aspect | Detail |
|--------|--------|
| **Product Name** | حضوربان (Hozorban) — Smart Attendance System |
| **Stack** | React 18, Vite 7, Bootstrap 5 (RTL), Bootstrap Icons, `@vladmandic/face-api` (face recognition), Web Audio API (voice) |
| **Language** | Persian (RTL), JavaScript (ESM) |
| **Entry Point** | `src/main.jsx` → `src/App.jsx` |
| **Dev Server** | `npm run dev` (Vite, port 5173, proxies `/api` & `/uploads` to `http://localhost:8080`) |
| **Build** | `npm run build` → `dist/` |
| **State Management** | React hooks (`useState`, `useRef`, `useEffect`, `useMemo`) + `localStorage` / `sessionStorage` as offline cache; **PostgreSQL via REST API is the source of truth** |
| **Authentication** | JWT in `sessionStorage` (`smart-attendance:api-token`), role-based nav (admin / teacher / student) |

---

## 2. Directory Structure

```
src/
├── main.jsx                    # App bootstrap, theme, error boundary
├── App.jsx                     # Root component: auth, global state, routing, API integration
├── styles.css                  # Complete design system (2900+ lines, RTL, dark mode, responsive)
├── api/
│   ├── client.js               # Fetch wrapper, JWT, domain helpers (CRUD + bootstrap)
│   └── adapter.js              # Server → frontend data mapping (bootstrap → UI shapes)
├── components/
│   ├── shared.jsx              # Reusable UI primitives (Icon, Badge, PanelTitle, StatCard, EmptyState, AppErrorBoundary)
│   ├── pages.jsx               # All page-level components (Dashboard, Students, Courses, ManualAttendance, FaceAttendance, etc.)
│   └── Sessions.jsx            # Persian-calendar session scheduling UI
├── face/
│   └── liveness.js             # Eye-aspect-ratio helper for blink liveness detection
├── voice/
│   ├── VoiceAttendance.jsx     # Voice enrollment + recognition (fixed phrase, FFT features, IndexedDB cache)
│   └── audioStore.js           # IndexedDB wrapper for audio clips / profiles
└── public/
    └── models/                 # face-api model files (tinyFaceDetector, faceLandmark68TinyNet, faceRecognitionNet)
```

---

## 3. Core Architecture

### 3.1 App.jsx — Central State & Orchestration
- **Single source of truth**: `loadFromServer({silent})` fetches `/api/bootstrap` → `adaptBootstrap()` → updates all React state.
- **Mutations** (add student, create course, mark attendance, upload photo, save voice, finalize session, settings) → call API helper → `loadFromServer({silent:true})` to refresh.
- **Offline fallback**: `localStorage` keys (`smart-attendance:students`, `:courses`, `:attendance`, `:sessions`, `:settings`, `:theme`) — used only before first successful bootstrap.
- **Role-based navigation**: `ROLE_PERMISSIONS` maps roles to allowed page IDs.
- **Login screen**: Role selector (admin/teacher/student) pre-fills demo credentials; on success stores profile in `sessionStorage`.

### 3.2 API Layer (`src/api/`)
| File | Responsibility |
|------|----------------|
| `client.js` | `api()`, `signIn()`, `fetchBootstrap()`, domain helpers (`createStudent`, `uploadStudentPhoto`, `saveVoiceSample`, `createCourse`, `createSession`, `finalizeSession`, `upsertAttendance`, `saveSettingsPayload`, `migrateBrowserSnapshot`) |
| `adapter.js` | `adaptBootstrap(raw)` → `{students, courses, attendance, sessionHistory, settings, voiceProfiles}` — maps DB UUIDs to frontend string IDs (studentNumber), builds `faceImage`/`faceImages` arrays from `/uploads` URLs, converts voice samples to profile objects |

### 3.3 Data Shapes (Frontend)

```ts
// Student (frontend)
{
  id: string;              // studentNumber (e.g. "40123001")
  name: string;            // fullName
  major: string;
  term: string;
  phone: string;
  status: "فعال" | "غیرفعال";
  databaseId: string;      // UUID from DB
  faceImages: string[];    // URLs like "/uploads/students/<uuid>.png"
  faceImage: string;       // faceImages[0] || ""
}

// Course (frontend)
{
  id: string;              // code (e.g. "CS301")
  title: string;
  teacher: string;
  weekday: string;
  startTime: string;       // "HH:MM"
  endTime: string;
  time: string;            // formatted "شنبه، 10:00 تا 12:00"
  room: string;
  studentIds: string[];    // frontend student IDs
  count: number;
  databaseId: string;      // UUID
}

// Session (frontend, keyed by `${courseTitle}::${YYYY-MM-DD}`)
{
  id: string;              // same as key
  course: string;
  date: string;            // "YYYY-MM-DD"
  teacher: string;
  startTime, endTime: string;
  graceMinutes, openBeforeMinutes, closeAfterMinutes: number;
  started: boolean;
  finalized: boolean;
  cancelled: boolean;
  status: "scheduled"|"started"|"finalized"|"cancelled";
  studentIds: string[];
  databaseId: string;      // UUID
  audit: AuditEntry[];
}

// Attendance Record (frontend)
{
  id: string;              // frontend student ID
  name: string;
  course: string;
  sessionId: string;       // session key
  sessionDate: string;
  time: string;            // "HH:MM" or "—"
  status: "حاضر"|"تأخیر"|"غایب"|"غیبت موجه"|"خروج زودهنگام"|"ثبت‌نشده";
  method: "manual"|"face"|"voice"|"class_camera"|"system";
  history: HistoryEntry[];
  databaseId: string;      // UUID from attendance_records
  databaseSessionId: string; // UUID
}
```

---

## 4. Pages / Views (from `pages.jsx` + `Sessions.jsx`)

| Page ID | Component | Purpose |
|---------|-----------|---------|
| `dashboard` | `Dashboard` | Stats cards, today attendance donut, latest records, quick actions, active courses strip |
| `students` | `Students` | Searchable table, add/edit/delete (admin), photo upload trigger |
| `courses` | `Courses` | Grid of course cards + modal form to create (code, title, teacher, room, weekday, time, student picker) |
| `sessions` | `Sessions` | Persian calendar (Jalali), schedule new sessions, filter by course, open/start/finalize |
| `manual` | `ManualAttendance` | Table with filter (course, search), per-row status buttons (حاضر/تأخیر/غایب/غیبت موجه/خروج زودهنگام), reason field, CSV export |
| `face` | `FaceAttendance` (variant="face") | Webcam face recognition: model loading, reference descriptor build, live scan, liveness (blink), auto-mark attendance |
| `class-camera` | `FaceAttendance` (variant="classroom") | Same engine, classroom monitoring mode — shows all students with recognition boxes, manual override buttons |
| `voice` | `VoiceAttendance` | Fixed 10-word phrase; enroll up to 3 samples/student (IndexedDB + backend `/voice-samples`); live mic recording (60s max) or file upload; FFT-based 24-bin feature vector; cosine similarity with margin threshold |
| `reports` | `Reports` | Filters (course, date range, status), summary cards, audit log table, CSV export |
| `profile` | `Profile` | Name, avatar upload, role display |
| `settings` | `Settings` | System name, late threshold, notifications toggle, face-recognition toggle — persisted to DB via `saveSettingsPayload` |
| `student-portal` | `StudentPortal` | Student self-service: personal attendance history, enrolled courses, stats (read-only) |

---

## 5. Face Recognition Pipeline (`FaceAttendance`)

1. **Model Load** (`useEffect []`): dynamic `import("@vladmandic/face-api")`, load 3 models from `/models/` (tinyFaceDetector, faceLandmark68TinyNet, faceRecognitionNet) → `modelStatus="ready"`.
2. **Descriptor Build** (`useEffect [modelStatus, students]`): for each student, take `faceImage` (first reference photo), `fetchImage`, `detectSingleFace().withFaceLandmarks().withFaceDescriptor()` → array of `{studentId, descriptor}`.
3. **Live Scan** (`useEffect [cameraState, modelStatus]` @ ~30fps):
   - `detectAllFaces(video).withFaceLandmarks().withFaceDescriptors()`
   - For each face: Euclidean distance to all registered descriptors → best match if `< 0.54` AND margin to 2nd best `> 0.035`.
   - **Liveness** (non-classroom): eye-aspect-ratio (EAR) blink detection — requires open→close→open sequence before auto-mark.
   - Streak counter: 2 consecutive frames → `onMarkAttendance(studentId, "حاضر", {method:"face"})`.
4. **UI Overlay**: `faceBoxes` state → absolutely positioned boxes with labels (recognized/review/unknown) + scan-line animation.

**Key Tunables** (in `pages.jsx`):
- `scoreThreshold: 0.5` (detection)
- `distance < 0.54` (match)
- `margin > 0.035` (uniqueness)
- `EAR closeThreshold ≈ 0.11`, `reopenThreshold ≈ openBaseline * 0.82`

---

## 6. Voice Recognition Pipeline (`VoiceAttendance`)

1. **Feature Extraction** (`audioFeatures(blob)`):
   - Web Audio API `decodeAudioData` → mono Float32Array @ 16 kHz.
   - 512-sample Hann-windowed frames, 50% overlap.
   - Custom FFT → 24 log-energy bands (80 Hz – Nyquist).
   - Mean-center + L2-normalize → 24-dim unit vector.
2. **Enrollment**: up to 3 samples/student stored in IndexedDB (`audioStore.js`) **and** POSTed to `/api/students/:id/voice-samples` (features + version).
3. **Identification** (`identifyVoice(features, profiles)`):
   - Cosine similarity (dot product of normalized vectors).
   - Best score `≥ 0.88` AND margin to 2nd best `≥ 0.055` → accept.
4. **Live Recording**: `getUserMedia` + `ScriptProcessorNode` (4096 samples) → PCM chunks → WAV encode → `audioFeatures` → identify → mark attendance.
5. **File Upload**: same pipeline, supports MP3/WAV/M4A/WebM/OGG/FLAC (≤15 MB).

---

## 7. Persian Calendar (`Sessions.jsx`)

- Uses `Intl.DateTimeFormat("fa-IR-u-ca-persian")` for Jalali rendering.
- Month grid (42 cells), persian month start detection via heuristic offset.
- Sessions mapped by `course::date` key; attendance records augment unscheduled sessions.
- Schedule form: course picker, date (from calendar), time, grace/minutes, student roster checkboxes.

---

## 8. Styling System (`styles.css`)

- **CSS Custom Properties**: `--primary`, `--ink`, `--muted`, `--line`, `--surface`, `--bg` — swapped for dark mode via `:root[data-theme="dark"]`.
- **Typography**: `Vazirmatn` (falls back to Tahoma), 13 px base.
- **Layout**: Fixed 260 px RTL sidebar, `main-area` margin, responsive breakpoints (1250, 1000, 700, 600, 390 px).
- **Components**: `.content-card`, `.stat-card`, `.custom-table`, `.face-student`, `.camera-view`, `.voice-phrase`, `.calendar-grid`, `.student-portal-*`, `.login-screen`, `.modal-backdrop-custom`, `.attendance-success-toast`.
- **Dark Mode**: comprehensive overrides for all components.
- **Print Stylesheet**: hides UI chrome, shows only `.reports-page`.

---

## 9. API Contract (Frontend → Backend)

| Method | Endpoint | Payload | Response |
|--------|----------|---------|----------|
| POST | `/api/auth/login` | `{email, password}` | `{token, user:{id,name,role,studentId,avatarUrl}}` |
| GET | `/api/bootstrap` | — | `{students[], courses[], sessions[], attendance[], settings, faceImages[], voiceSamples[]}` |
| POST | `/api/students` | `{studentNumber, fullName, major, term, phone, status}` | `{id, studentNumber, fullName, ...}` |
| PATCH | `/api/students/:id` | Partial student | Updated student |
| POST | `/api/students/:id/photos` | `FormData(photo)` | `{id, studentId, objectKey, mimeType, createdAt}` |
| POST | `/api/courses` | `{code, title, teacherName, room, weekday, startTime, endTime, studentIds[]}` | `{id, code, title}` |
| PATCH | `/api/courses/:id` | Partial course | Updated course |
| DELETE | `/api/courses/:id` | — | 204 |
| POST | `/api/sessions` | `{courseId, date, teacherName, startTime, endTime, graceMinutes, openBeforeMinutes, closeAfterMinutes, studentIds[]}` | `{id, status}` |
| PATCH | `/api/sessions/:id` | `{status}` | `{id, status}` |
| POST | `/api/sessions/:id/finalize` | — | `{id, status:"finalized", absent:number}` |
| PUT | `/api/attendance` | `{sessionId, studentId, status, method, reason?}` | Attendance record |
| PUT | `/api/settings` | `{systemName, lateAfterMinutes, notificationsEnabled, faceRecognitionEnabled}` | Settings |
| POST | `/api/students/:id/voice-samples` | `{features:number[24], featureVersion}` | Voice sample record |

---

## 10. Key Files Quick Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/App.jsx` | ~1650 | Root: auth, global state, API integration, navigation, mutations |
| `src/components/pages.jsx` | ~2100 | All page components except Sessions & Voice |
| `src/components/Sessions.jsx` | ~140 | Persian calendar + session scheduling |
| `src/components/shared.jsx` | ~57 | UI primitives |
| `src/api/client.js` | ~94 | Fetch wrapper + domain helpers |
| `src/api/adapter.js` | ~193 | Bootstrap → frontend shape mapper |
| `src/face/liveness.js` | ~22 | EAR calculation |
| `src/voice/VoiceAttendance.jsx` | ~334 | Voice enroll/recognize UI |
| `src/voice/audioStore.js` | ~81 | IndexedDB audio cache |
| `src/styles.css` | ~2900 | Complete design system |
| `public/models/*` | 6 files | face-api model weights |

---

## 11. Known Issues / TODOs (for next agent)

1. **Face model load** sometimes stalls on slow machines — add progress UI.
2. **Voice FFT** uses custom implementation; consider `meyda` or `web-audio-beat-detection` for robustness.
3. **Student photos**: current backend deletes old file on replace — good, but frontend still allows multiple via `faceImages` array; align to single-photo policy.
4. **Session timezone**: `session_date` returned as `YYYY-MM-DD` string (fixed in adapter), but `startTime`/`endTime` are strings — ensure consistent parsing.
5. **Offline sync**: `migrateBrowserSnapshot` endpoint not yet implemented on backend.
6. **Accessibility**: Add ARIA live regions for toast/recognition messages; ensure keyboard navigation in custom dropdowns.
7. **Bundle size**: `face-api.esm` chunk > 1.3 MB — consider lazy import only when FaceAttendance mounts.

---

## 12. Running the Frontend

```bash
cd smart-attendance-frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api & /uploads to :8080)
npm run build        # production bundle in dist/
```

**Demo Accounts** (seeded by backend):
- `admin@hozorban.local` / `Admin@123456`
- `teacher@hozorban.local` / `Teacher@123456`
- `student@hozorban.local` / `Student@123456`

---

*Generated from source as of 2026-11-04. All paths relative to `smart-attendance-frontend/`.*
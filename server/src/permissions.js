// Faculty staff roles and the exact screens/actions each one may use.
//
// The database keeps the historical column name (`users.admin_level`) so old
// tokens, migrations and the platform panel keep working; the four values are
// interpreted as staff roles:
//
//   owner    → مدیر دانشکده        (everything, including staff management)
//   manager  → مدیر آموزش          (everything except staff management)
//   operator → کارمند آموزش        (manual attendance + read-only context)
//   viewer   → کارمند آموزش (فقط مشاهده)
//
// Keeping the catalogue in one pure module means the API, the bootstrap payload
// and the tests all read the same source of truth.

export const STAFF_ROLES = ["owner", "manager", "operator", "viewer"];

export const STAFF_ROLE_LABELS = {
  owner: "مدیر دانشکده",
  manager: "مدیر آموزش",
  operator: "کارمند آموزش",
  viewer: "کارمند آموزش (فقط مشاهده)",
};

export const STAFF_ROLE_HINTS = {
  owner: "دسترسی کامل به دانشکده، از جمله تعیین سطح دسترسی کارمندان.",
  manager:
    "همهٔ بخش‌های آموزشی به‌جز تعیین سطح دسترسی کارمندان و مدیریت مدیر دانشکده.",
  operator:
    "ثبت دستی حضور و مشاهدهٔ دانشجویان، درس‌ها، جلسات و گزارش‌ها؛ بدون تشخیص چهره، صدا، اثر انگشت، آزمون و تنظیمات.",
  viewer:
    "همان کارمند آموزش، اما بدون ثبت یا تغییر داده؛ فقط مشاهدهٔ گزارش‌ها و وضعیت.",
};

// Every permission is an action on a module. The frontend uses the same keys to
// decide which navigation entries and buttons are visible.
export const PERMISSIONS = [
  "dashboard.view",
  "profile.view",
  "students.view",
  "students.manage",
  "courses.view",
  "courses.manage",
  "sessions.view",
  "sessions.manage",
  "exams.view",
  "exams.manage",
  "attendance.manual.view",
  "attendance.manual.manage",
  "attendance.face.view",
  "attendance.face.manage",
  "attendance.voice.view",
  "attendance.voice.manage",
  "attendance.fingerprint.view",
  "attendance.fingerprint.manage",
  "attendance.live.view",
  "attendance.live.manage",
  "attendance.trends.view",
  "reports.view",
  "leave.view",
  "leave.manage",
  "objections.view",
  "objections.manage",
  "teachers.view",
  "teachers.manage",
  "registrations.manage",
  "tickets.view",
  "tickets.manage",
  "activity.view",
  "support.view",
  "settings.view",
  "settings.manage",
  "staff.manage",
];

const READ_ONLY_PREFIXES = [
  "dashboard.view",
  "profile.view",
  "students.view",
  "courses.view",
  "sessions.view",
  "attendance.manual.view",
  "attendance.trends.view",
  "reports.view",
  "leave.view",
  "objections.view",
  "support.view",
];

// کارمند آموزش: enough context to record attendance by hand and follow up on
// requests, but no biometrics, exams, grading, staff or settings.
const OPERATOR_PERMISSIONS = [
  ...READ_ONLY_PREFIXES,
  "attendance.manual.manage",
];

// کارمند آموزش (فقط مشاهده): the same visibility with every write removed.
const VIEWER_PERMISSIONS = [...READ_ONLY_PREFIXES];

export const ROLE_PERMISSIONS = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((permission) => permission !== "staff.manage"),
  operator: OPERATOR_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

export function normalizeStaffRole(level) {
  return STAFF_ROLES.includes(level) ? level : "owner";
}

/** All permissions granted to a staff role. Unknown levels fall back to owner. */
export function permissionsForRole(level) {
  return ROLE_PERMISSIONS[normalizeStaffRole(level)] || ROLE_PERMISSIONS.owner;
}

/** Does `level` include `permission`? Owners implicitly pass everything. */
export function staffRoleAllows(level, permission) {
  const role = normalizeStaffRole(level);
  if (role === "owner") return true;
  if (!permission) return false;
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

/**
 * Maps a request to the permission it needs. `null` means "no extra permission
 * required" (auth, own profile, bootstrap, notifications, public endpoints).
 *
 * Unmapped `/api` routes return "unmapped": staff roles are denied by default so
 * a forgotten endpoint can never leak data, while the owner keeps full access.
 */
export function permissionForRequest(method, rawPath) {
  const path = String(rawPath || "").split("?")[0];
  const verb = String(method || "GET").toUpperCase();
  const isRead = verb === "GET" || verb === "HEAD";

  // Never gated here: signing in, changing a password, switching faculty,
  // reading one's own profile, bootstrap data and notification polling.
  if (path.startsWith("/api/auth/")) return null;
  if (path === "/api/faculties" || path === "/health") return null;
  if (path === "/api/me") return "profile.view";
  if (path === "/api/me/photo") return "profile.view";
  if (path === "/api/bootstrap") return "dashboard.view";
  if (path.startsWith("/api/notifications")) return "dashboard.view";
  if (path === "/api/registrations" && verb === "POST")
    return "registrations.manage";

  if (path.startsWith("/api/platform/")) return "staff.manage";
  if (path === "/api/staff" || path.startsWith("/api/staff/"))
    return "staff.manage";
  // Account unlocks are a staff-management action.
  if (path.startsWith("/api/users/")) return "staff.manage";

  if (path.startsWith("/api/import/students")) return "students.manage";
  if (path.startsWith("/api/import/courses")) return "courses.manage";

  if (path.startsWith("/api/students")) {
    if (path.endsWith("/voice-samples")) return "attendance.voice.manage";
    if (path.endsWith("/photos")) return "attendance.face.manage";
    return isRead ? "students.view" : "students.manage";
  }

  if (path.startsWith("/api/courses"))
    return isRead ? "courses.view" : "courses.manage";

  if (path.startsWith("/api/sessions")) {
    if (path.endsWith("/live") && isRead) return "attendance.live.view";
    if (path.endsWith("/live/start") || path.endsWith("/live/end"))
      return "attendance.live.manage";
    return isRead ? "sessions.view" : "sessions.manage";
  }

  if (path.startsWith("/api/attendance-objections")) {
    if (path.endsWith("/review")) return "objections.manage";
    return isRead ? "objections.view" : "objections.manage";
  }

  if (path.startsWith("/api/attendance")) return "attendance.manual.manage";

  if (path.startsWith("/api/face-recognition")) return "attendance.face.view";
  if (path.startsWith("/api/fingerprint/self")) return "profile.view";
  if (path.startsWith("/api/fingerprint")) return "attendance.fingerprint.manage";

  if (path.startsWith("/api/leave-requests")) {
    if (path.endsWith("/review")) return "leave.manage";
    return isRead ? "leave.view" : "leave.manage";
  }

  if (path.startsWith("/api/analytics")) return "attendance.trends.view";

  if (path.startsWith("/api/exams")) {
    if (path.endsWith("/analysis") || path.endsWith("/reports"))
      return "reports.view";
    return isRead ? "exams.view" : "exams.manage";
  }

  if (path.startsWith("/api/teachers")) {
    if (path.startsWith("/api/teachers/lookup") || isRead) return "teachers.view";
    return "teachers.manage";
  }

  if (path.startsWith("/api/admin/activity")) return "activity.view";
  if (path.startsWith("/api/registrations")) return "registrations.manage";
  if (path.startsWith("/api/tickets")) return isRead ? "tickets.view" : "tickets.manage";
  if (path === "/api/settings") return "settings.manage";
  if (path.startsWith("/api/migrations/")) return "staff.manage";

  return "unmapped";
}

// Pure access rules for the platform (super admin) layer.
//
// Keeping the levels and the HTTP-method policy in one small module makes the
// guarantees testable without a database: the server only translates the
// returned message into a 403 response.

export const PLATFORM_LEVEL_RANK = { auditor: 1, operator: 2, owner: 3 };
export const ADMIN_LEVEL_RANK = { viewer: 1, operator: 2, manager: 3, owner: 4 };

export const FACULTY_ADMIN_LEVELS = ["owner", "manager", "operator", "viewer"];
export const PLATFORM_LEVELS = ["owner", "operator", "auditor"];

/** Does `level` satisfy the `minLevel` requirement? */
export function platformLevelAllows(level, minLevel = "auditor") {
  return (PLATFORM_LEVEL_RANK[level] || 0) >= (PLATFORM_LEVEL_RANK[minLevel] || 0);
}

/**
 * Faculty-admin levels are enforced by HTTP method so "read only" is a hard
 * guarantee rather than a per-page convention.
 *
 * Returns a Persian error message when the request must be rejected, or null
 * when it may proceed.
 */
export function facultyLevelDenial(level, method, path) {
  const effective = level || "owner";
  const verb = String(method || "GET").toUpperCase();
  if (path.startsWith("/api/auth/")) return null;
  const isRead = verb === "GET" || verb === "HEAD";

  if (effective === "viewer") {
    return isRead
      ? null
      : "سطح دسترسی شما فقط مشاهده است و امکان تغییر داده ندارد.";
  }

  if (effective === "operator") {
    if (verb === "DELETE") return "حذف رکوردها برای سطح دسترسی شما مجاز نیست.";
    if (!isRead && /^\/api\/(settings|teachers)(\/|$)/.test(path))
      return "این بخش برای سطح دسترسی شما فقط قابل مشاهده است.";
    return null;
  }

  if (effective === "manager") {
    if (verb === "DELETE")
      return "حذف رکوردها فقط برای مدیر ارشد دانشکده مجاز است.";
    if (!isRead && /^\/api\/teachers(\/|$)/.test(path))
      return "مدیریت استادان فقط برای مدیر ارشد دانشکده مجاز است.";
    return null;
  }

  // owner (or an unknown level that defaulted to owner) may do everything.
  return null;
}

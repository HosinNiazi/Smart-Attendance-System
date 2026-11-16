// End-to-end check for the platform (super admin) layer.
//
// Requires the API to be running (npm run api:dev) and the database to be
// migrated. Creates its own faculty/admins with a unique suffix and removes
// everything again, so it never touches demo data. Run with:
//
//   npm --prefix server run test:platform
//
// Every check hits the real HTTP API, so it verifies routing, auth, RBAC,
// impersonation, audit and archive behaviour together.

import "dotenv/config";
import { pool } from "../src/db.js";

const API = process.env.PLATFORM_TEST_API || "http://localhost:8080";
const stamp = String(Date.now()).slice(-7);
const PASSWORD = `Plat@${stamp}`;
const NEW_PASSWORD = `PlatNew@${stamp}`;

const createdOrganizations = [];
const createdUsers = [];

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(`${name}${detail ? ` → ${detail}` : ""}`);
  return false;
}

async function call(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

const login = (identifier, password, facultyId) =>
  call("/api/auth/login", {
    method: "POST",
    body: { identifier, password, ...(facultyId ? { facultyId } : {}) },
  });

async function changePassword(token, currentPassword, newPassword) {
  return call("/api/auth/change-password", {
    method: "POST",
    token,
    body: { currentPassword, newPassword },
  });
}

async function createFacultyAdmin(facultyId, fullName, email, level) {
  return call(`/api/platform/faculties/${facultyId}/admin`, {
    method: "POST",
    token: platformToken,
    body: { fullName, email, level },
  });
}

// A helper that logs a freshly created admin in, changes the forced password
// and returns a usable token.
async function activateAdmin(email, temporaryPassword, facultyId) {
  const first = await login(email, temporaryPassword, facultyId);
  if (first.status !== 200) return { token: null, first };
  const changed = await changePassword(first.data.token, temporaryPassword, NEW_PASSWORD);
  if (changed.status !== 200) return { token: null, first, changed };
  const second = await login(email, NEW_PASSWORD, facultyId);
  return { token: second.data?.token || null, first, changed, second };
}

let platformToken = "";
let facultyId = "";
let facultyAdminId = "";
let platformAuditorId = "";

try {
  /* ------------------------------ platform login ------------------------------ */

  const badLogin = await call("/api/platform/auth/login", {
    method: "POST",
    body: { identifier: "platform@hozorban.local", password: "definitely-wrong" },
  });
  check("platform login rejects a wrong password", badLogin.status === 401, `status=${badLogin.status}`);

  const platformLogin = await call("/api/platform/auth/login", {
    method: "POST",
    body: {
      identifier: process.env.PLATFORM_ADMIN_EMAIL || "platform@hozorban.local",
      password: process.env.PLATFORM_ADMIN_PASSWORD || "Platform@123456",
    },
  });
  check("platform login succeeds", platformLogin.status === 200, JSON.stringify(platformLogin.data).slice(0, 120));
  platformToken = platformLogin.data?.token;
  check(
    "platform account is an owner",
    platformLogin.data?.user?.platformLevel === "owner",
    platformLogin.data?.user?.platformLevel,
  );

  const noToken = await call("/api/platform/faculties");
  check("platform API rejects anonymous calls", noToken.status === 401, `status=${noToken.status}`);

  const me = await call("/api/platform/me", { token: platformToken });
  check("platform me returns the owner", me.status === 200 && me.data?.user?.platformLevel === "owner");

  const overview = await call("/api/platform/overview", { token: platformToken });
  check(
    "platform overview returns numeric stats",
    overview.status === 200 && typeof overview.data?.stats?.faculties === "number",
  );

  const facultiesBefore = await call("/api/platform/faculties", { token: platformToken });
  check(
    "platform faculty list works",
    facultiesBefore.status === 200 && Array.isArray(facultiesBefore.data?.faculties),
  );
  check(
    "hidden platform organization is never listed",
    !(facultiesBefore.data?.faculties || []).some((item) => item.code === "PLATFORM"),
  );

  const publicFaculties = await call("/api/faculties");
  check(
    "public faculty list only contains faculties",
    publicFaculties.status === 200 &&
      Array.isArray(publicFaculties.data?.faculties) &&
      !(publicFaculties.data.faculties || []).some((item) => item.code === "PLATFORM"),
  );
  const otherFacultyId = (publicFaculties.data?.faculties || []).find(
    (item) => item.id !== facultyId,
  )?.id;

  /* ----------------------------- faculty lifecycle ---------------------------- */

  const facultyEmail = `e2e.faculty.${stamp}@example.com`;
  const created = await call("/api/platform/faculties", {
    method: "POST",
    token: platformToken,
    body: {
      name: `دانشکده آزمون ${stamp}`,
      code: `E2E${stamp}`,
      contactName: "رابط آزمون",
      contactEmail: `contact.${stamp}@example.com`,
      contactPhone: "02100000000",
      adminFullName: "مدیر آزمون",
      adminEmail: facultyEmail,
      adminLevel: "owner",
    },
  });
  check("create faculty returns 201", created.status === 201, JSON.stringify(created.data).slice(0, 160));
  facultyId = created.data?.faculty?.id;
  facultyAdminId = created.data?.admin?.id;
  if (facultyId) createdOrganizations.push(facultyId);
  const facultyTempPassword = created.data?.account?.temporaryPassword;
  check("create faculty returns a one-time password", typeof facultyTempPassword === "string" && facultyTempPassword.length >= 8);
  check("new faculty starts empty", created.data?.faculty?.students === 0 && created.data?.faculty?.teachers === 0);
  check("new faculty stores its contact", created.data?.faculty?.contactName === "رابط آزمون");

  const duplicateName = await call("/api/platform/faculties", {
    method: "POST",
    token: platformToken,
    body: {
      name: `دانشکده آزمون ${stamp}`,
      code: `E2D${stamp}`,
      adminFullName: "مدیر تکراری",
      adminEmail: `dup.${stamp}@example.com`,
    },
  });
  check("duplicate faculty name is rejected", duplicateName.status === 409, `status=${duplicateName.status}`);

  const duplicateCode = await call("/api/platform/faculties", {
    method: "POST",
    token: platformToken,
    body: {
      name: `دانشکده دیگر ${stamp}`,
      code: `E2E${stamp}`,
      adminFullName: "مدیر تکراری",
      adminEmail: `dup2.${stamp}@example.com`,
    },
  });
  check("duplicate faculty code is rejected", duplicateCode.status === 409, `status=${duplicateCode.status}`);

  const updated = await call(`/api/platform/faculties/${facultyId}`, {
    method: "PATCH",
    token: platformToken,
    body: { contactPhone: "02111111111" },
  });
  check("faculty update persists contact changes", updated.status === 200 && updated.data?.faculty?.contactPhone === "02111111111");

  const detail = await call(`/api/platform/faculties/${facultyId}`, { token: platformToken });
  check(
    "faculty detail lists its single owner",
    detail.status === 200 && detail.data?.admins?.length === 1 && detail.data.admins[0].level === "owner",
    JSON.stringify({ status: detail.status, data: detail.data }),
  );

  /* --------------------------- faculty admin login/RBAC ------------------------ */

  const firstLogin = await login(facultyEmail, facultyTempPassword, facultyId);
  check("faculty admin signs in with the temporary password", firstLogin.status === 200);
  check("temporary password forces a change", firstLogin.data?.user?.mustChangePassword === true);
  const blockedBeforeChange = await call("/api/students", { token: firstLogin.data?.token });
  check("faculty admin API is blocked before changing the password", blockedBeforeChange.status === 403, `status=${blockedBeforeChange.status}`);
  const changed = await changePassword(firstLogin.data.token, facultyTempPassword, PASSWORD);
  check("faculty admin changes the temporary password", changed.status === 200);
  const ownerLogin = await login(facultyEmail, PASSWORD, facultyId);
  check("faculty admin signs in with the new password", ownerLogin.status === 200);
  const facultyToken = ownerLogin.data?.token;

  if (otherFacultyId) {
    const wrongFaculty = await login(facultyEmail, PASSWORD, otherFacultyId);
    check("login is scoped to the selected faculty", wrongFaculty.status === 401, `status=${wrongFaculty.status}`);
  }

  const facultyToPlatform = await call("/api/platform/faculties", { token: facultyToken });
  check("faculty token cannot read the platform API", facultyToPlatform.status === 403, `status=${facultyToPlatform.status}`);

  const platformToFaculty = await call("/api/students", { token: platformToken });
  check("platform token cannot read faculty data directly", platformToFaculty.status === 403, `status=${platformToFaculty.status}`);

  /* ------------------------------- impersonation ------------------------------ */

  const noReason = await call(`/api/platform/faculties/${facultyId}/enter`, {
    method: "POST",
    token: platformToken,
    body: { reason: "" },
  });
  check("entering a faculty requires a reason", noReason.status === 422, `status=${noReason.status}`);

  const entered = await call(`/api/platform/faculties/${facultyId}/enter`, {
    method: "POST",
    token: platformToken,
    body: { reason: "آزمون خودکار کامل لایهٔ مدیر سامانه" },
  });
  check("enter faculty returns 201", entered.status === 201, JSON.stringify(entered.data).slice(0, 160));
  const impToken = entered.data?.token;
  const impSessionId = entered.data?.impersonation?.sid;
  check("impersonation token is scoped to the faculty", entered.data?.user?.faculty?.id === facultyId);
  check("impersonation token can read faculty data", (await call("/api/students", { token: impToken })).status === 200);
  const impPlatform = await call("/api/platform/faculties", { token: impToken });
  check("impersonation token cannot use the platform API", impPlatform.status === 403, `status=${impPlatform.status}`);

  const impStudent = await call("/api/students", {
    method: "POST",
    token: impToken,
    body: { studentNumber: `IMP${stamp}`, fullName: "دانشجوی آزمون سامانه", status: "active" },
  });
  check("impersonation token can write faculty data", impStudent.status === 201, JSON.stringify(impStudent.data).slice(0, 140));
  const impStudentId = impStudent.data?.id;

  const auditAfterEnter = await call(`/api/platform/audit?organizationId=${facultyId}&action=platform.impersonation&limit=20`, {
    token: platformToken,
  });
  const auditItems = auditAfterEnter.data?.items || [];
  check("audit records the impersonation start", auditItems.some((item) => item.action === "platform.impersonation.start"));
  check("audit marks the platform actor", auditItems.every((item) => item.platformActor === true));

  const activeSessions = await call("/api/platform/impersonations", { token: platformToken });
  check(
    "active session appears in the platform session list",
    (activeSessions.data?.sessions || []).some((item) => item.id === impSessionId),
  );

  const exited = await call("/api/auth/exit-impersonation", { method: "POST", token: impToken });
  check("exit impersonation succeeds", exited.status === 200);
  const afterExit = await call("/api/students", { token: impToken });
  check("impersonation token is dead after exit", afterExit.status === 401, `status=${afterExit.status}`);

  const enterAgain = await call(`/api/platform/faculties/${facultyId}/enter`, {
    method: "POST",
    token: platformToken,
    body: { reason: "آزمون پایان اجباری نشست" },
  });
  const secondImpToken = enterAgain.data?.token;
  const secondSid = enterAgain.data?.impersonation?.sid;
  const revoked = await call(`/api/platform/impersonations/${secondSid}`, {
    method: "DELETE",
    token: platformToken,
  });
  check("platform can revoke a live session", revoked.status === 200);
  check(
    "revoked session token is rejected immediately",
    (await call("/api/students", { token: secondImpToken })).status === 401,
  );

  /* --------------------------- faculty admin levels --------------------------- */

  const viewerEmail = `e2e.viewer.${stamp}@example.com`;
  const viewerCreated = await createFacultyAdmin(facultyId, "ناظر آزمون", viewerEmail, "viewer");
  check("platform creates a viewer admin", viewerCreated.status === 201, JSON.stringify(viewerCreated.data).slice(0, 140));
  if (viewerCreated.data?.admin?.id) createdUsers.push(viewerCreated.data.admin.id);
  const viewer = await activateAdmin(viewerEmail, viewerCreated.data?.account?.temporaryPassword, facultyId);
  const viewerToken = viewer.token;
  check("viewer signs in after changing the password", Boolean(viewerToken));
  check("viewer can read students", (await call("/api/students", { token: viewerToken })).status === 200);
  check(
    "viewer cannot write students",
    (await call("/api/students", {
      method: "POST",
      token: viewerToken,
      body: { studentNumber: `VW${stamp}`, fullName: "نویسنده ممنوع", status: "active" },
    })).status === 403,
  );
  check(
    "viewer cannot delete a student",
    (await call(`/api/students/${impStudentId}`, { method: "DELETE", token: viewerToken })).status === 403,
  );

  const operatorEmail = `e2e.operator.${stamp}@example.com`;
  const operatorCreated = await createFacultyAdmin(facultyId, "اپراتور آزمون", operatorEmail, "operator");
  check("platform creates an operator admin", operatorCreated.status === 201);
  if (operatorCreated.data?.admin?.id) createdUsers.push(operatorCreated.data.admin.id);
  const operator = await activateAdmin(operatorEmail, operatorCreated.data?.account?.temporaryPassword, facultyId);
  const operatorToken = operator.token;
  const operatorStudent = await call("/api/students", {
    method: "POST",
    token: operatorToken,
    body: { studentNumber: `OP${stamp}`, fullName: "دانشجوی اپراتور", status: "active" },
  });
  check("operator can create a student", operatorStudent.status === 201, `status=${operatorStudent.status}`);
  check(
    "operator cannot delete",
    (await call(`/api/students/${operatorStudent.data?.id}`, { method: "DELETE", token: operatorToken })).status === 403,
  );
  check(
    "operator cannot write settings",
    (await call("/api/settings", { method: "PUT", token: operatorToken, body: {} })).status === 403,
  );
  check(
    "operator cannot add teachers",
    (await call("/api/teachers", {
      method: "POST",
      token: operatorToken,
      body: { fullName: "استاد ممنوع", email: `t.${stamp}@example.com` },
    })).status === 403,
  );

  const managerEmail = `e2e.manager.${stamp}@example.com`;
  const managerCreated = await createFacultyAdmin(facultyId, "مدیر آزمون دوم", managerEmail, "manager");
  check("platform creates a manager admin", managerCreated.status === 201);
  if (managerCreated.data?.admin?.id) createdUsers.push(managerCreated.data.admin.id);
  const manager = await activateAdmin(managerEmail, managerCreated.data?.account?.temporaryPassword, facultyId);
  const managerToken = manager.token;
  check("manager can write settings", (await call("/api/settings", { method: "PUT", token: managerToken, body: {} })).status !== 403);
  check(
    "manager cannot add teachers",
    (await call("/api/teachers", {
      method: "POST",
      token: managerToken,
      body: { fullName: "استاد ممنوع دو", email: `t2.${stamp}@example.com` },
    })).status === 403,
  );
  check(
    "manager cannot delete",
    (await call(`/api/students/${operatorStudent.data?.id}`, { method: "DELETE", token: managerToken })).status === 403,
  );

  const demoteLastOwner = await call(`/api/platform/faculties/${facultyId}/admins/${facultyAdminId}`, {
    method: "PATCH",
    token: platformToken,
    body: { level: "manager" },
  });
  check("the last faculty owner cannot be demoted", demoteLastOwner.status === 409, `status=${demoteLastOwner.status}`);

  const promoteViewer = await call(`/api/platform/faculties/${facultyId}/admins/${viewerCreated.data?.admin?.id}`, {
    method: "PATCH",
    token: platformToken,
    body: { level: "operator" },
  });
  check("platform can change a faculty admin level", promoteViewer.status === 200 && promoteViewer.data?.admin?.level === "operator");

  const resetViewer = await call(`/api/platform/faculties/${facultyId}/admins/${viewerCreated.data?.admin?.id}/reset-password`, {
    method: "POST",
    token: platformToken,
  });
  check("platform can reset a faculty admin password", resetViewer.status === 200 && typeof resetViewer.data?.temporaryPassword === "string");

  /* ------------------------------- platform admins ---------------------------- */

  const auditorEmail = `e2e.auditor.${stamp}@example.com`;
  const auditorCreated = await call("/api/platform/admins", {
    method: "POST",
    token: platformToken,
    body: { fullName: "ناظر سامانه آزمون", email: auditorEmail, level: "auditor" },
  });
  check("owner creates a platform auditor", auditorCreated.status === 201, JSON.stringify(auditorCreated.data).slice(0, 140));
  platformAuditorId = auditorCreated.data?.admin?.id;
  const auditorTemp = auditorCreated.data?.account?.temporaryPassword;
  const auditorFirst = await call("/api/platform/auth/login", {
    method: "POST",
    body: { identifier: auditorEmail, password: auditorTemp },
  });
  check("platform auditor cannot use the panel before changing the password", auditorFirst.status === 200 && auditorFirst.data?.user?.mustChangePassword === true);
  const auditorChanged = await changePassword(auditorFirst.data.token, auditorTemp, NEW_PASSWORD);
  check("platform auditor changes the password", auditorChanged.status === 200);
  const auditorLogin = await call("/api/platform/auth/login", {
    method: "POST",
    body: { identifier: auditorEmail, password: NEW_PASSWORD },
  });
  const auditorToken = auditorLogin.data?.token;
  check("platform auditor signs in", auditorLogin.status === 200);
  check("auditor can read the platform", (await call("/api/platform/faculties", { token: auditorToken })).status === 200);
  check("auditor can read the audit log", (await call("/api/platform/audit?limit=5", { token: auditorToken })).status === 200);
  check(
    "auditor cannot create faculties",
    (await call("/api/platform/faculties", {
      method: "POST",
      token: auditorToken,
      body: { name: `ممنوع ${stamp}`, code: `NO${stamp}`, adminFullName: "x y", adminEmail: `no.${stamp}@example.com` },
    })).status === 403,
  );
  check(
    "auditor cannot enter a faculty",
    (await call(`/api/platform/faculties/${facultyId}/enter`, {
      method: "POST",
      token: auditorToken,
      body: { reason: "ناظر نباید وارد شود" },
    })).status === 403,
  );
  check(
    "auditor cannot create platform admins",
    (await call("/api/platform/admins", {
      method: "POST",
      token: auditorToken,
      body: { fullName: "ممنوع", email: `no2.${stamp}@example.com`, level: "auditor" },
    })).status === 403,
  );

  const selfDeactivate = await call(`/api/platform/admins/${platformLogin.data?.user?.id}`, {
    method: "PATCH",
    token: platformToken,
    body: { isActive: false },
  });
  check("a platform owner cannot deactivate themselves", selfDeactivate.status === 400, `status=${selfDeactivate.status}`);

  /* ----------------------------- archive / restore ---------------------------- */

  const enterBeforeArchive = await call(`/api/platform/faculties/${facultyId}/enter`, {
    method: "POST",
    token: platformToken,
    body: { reason: "آزمون آرشیو با نشست فعال" },
  });
  const sessionDuringArchive = enterBeforeArchive.data?.token;
  const archived = await call(`/api/platform/faculties/${facultyId}/archive`, {
    method: "POST",
    token: platformToken,
  });
  check("archiving a faculty succeeds", archived.status === 200 && archived.data?.faculty?.isActive === false);
  check(
    "archiving ends live impersonation sessions",
    (await call("/api/students", { token: sessionDuringArchive })).status === 401,
  );
  check(
    "archived faculty rejects logins",
    (await login(facultyEmail, PASSWORD, facultyId)).status >= 400,
  );
  check(
    "archived faculty cannot be entered",
    (await call(`/api/platform/faculties/${facultyId}/enter`, {
      method: "POST",
      token: platformToken,
      body: { reason: "تلاش ورود به دانشکده آرشیو شده" },
    })).status === 409,
  );

  const restored = await call(`/api/platform/faculties/${facultyId}`, {
    method: "PATCH",
    token: platformToken,
    body: { isActive: true },
  });
  check("restoring a faculty succeeds", restored.status === 200 && restored.data?.faculty?.isActive === true);
  const loginAfterRestore = await login(facultyEmail, PASSWORD, facultyId);
  check("restored faculty accepts logins again", loginAfterRestore.status === 200);

  /* ---------------------------------- audit ----------------------------------- */

  const filteredAudit = await call(`/api/platform/audit?organizationId=${facultyId}&action=platform.faculty&limit=100`, {
    token: platformToken,
  });
  check("audit filter by faculty and action works", filteredAudit.status === 200 && (filteredAudit.data?.items || []).length > 0);
  check(
    "audit filter never leaks another faculty",
    (filteredAudit.data?.items || []).every((item) => item.organizationId === facultyId),
  );

  const allAudit = await call("/api/platform/audit?limit=200", { token: platformToken });
  check(
    "global audit only contains faculties",
    (allAudit.data?.items || []).every((item) => item.organizationId !== null),
  );

  /* ---------------------------------- cleanup --------------------------------- */

  const leftoverStudentIds = [impStudentId, operatorStudent.data?.id].filter(Boolean);
  for (const studentId of leftoverStudentIds) {
    await pool.query("DELETE FROM users WHERE student_id = $1", [studentId]);
    await pool.query("DELETE FROM students WHERE id = $1", [studentId]);
  }
  await pool.query("UPDATE admin_impersonations SET ended_at = now() WHERE organization_id = ANY($1::uuid[])", [
    createdOrganizations,
  ]);
  for (const userId of createdUsers) {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  if (platformAuditorId) {
    await pool.query("DELETE FROM users WHERE id = $1", [platformAuditorId]);
  }
  for (const organizationId of createdOrganizations) {
    await pool.query("DELETE FROM users WHERE organization_id = $1", [organizationId]);
    await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  }
} catch (error) {
  failures.push(`unexpected error → ${error.stack || error.message}`);
} finally {
  try {
    const leftover = await pool.query(
      `SELECT count(*)::int AS n FROM organizations WHERE code LIKE $1`,
      [`E2E${stamp}`],
    );
    if (leftover.rows[0].n > 0) failures.push("cleanup left a test faculty behind");
  } catch {
    // ignore cleanup verification errors
  }
  const total = passed + failures.length;
  console.log(`\nPlatform E2E: ${passed}/${total} checks passed`);
  if (failures.length) {
    console.log("Failures:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  await pool.end();
  if (failures.length) process.exitCode = 1;
}

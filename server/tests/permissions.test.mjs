import test from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  normalizeStaffRole,
  permissionForRequest,
  permissionsForRole,
  staffRoleAllows,
} from "../src/permissions.js";

test("every role only uses permissions from the catalogue", () => {
  for (const role of STAFF_ROLES) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      assert.ok(
        PERMISSIONS.includes(permission),
        `${role} references unknown permission ${permission}`,
      );
    }
  }
});

test("owner keeps every permission", () => {
  assert.deepEqual(permissionsForRole("owner"), PERMISSIONS);
  assert.equal(staffRoleAllows("owner", "staff.manage"), true);
});

test("education manager may do everything except staff management", () => {
  const permissions = permissionsForRole("manager");
  assert.equal(permissions.includes("staff.manage"), false);
  for (const permission of PERMISSIONS) {
    if (permission === "staff.manage") continue;
    assert.ok(permissions.includes(permission), `manager lacks ${permission}`);
  }
});

test("education staff can record manual attendance but not biometrics or exams", () => {
  const permissions = permissionsForRole("operator");
  assert.ok(permissions.includes("attendance.manual.manage"));
  for (const denied of [
    "attendance.face.view",
    "attendance.voice.view",
    "attendance.fingerprint.view",
    "exams.view",
    "exams.manage",
    "settings.view",
    "settings.manage",
    "staff.manage",
    "teachers.manage",
    "registrations.manage",
    "tickets.view",
    "activity.view",
  ]) {
    assert.equal(permissions.includes(denied), false, `operator should not have ${denied}`);
  }
});

test("read-only staff keeps visibility but loses every write", () => {
  const permissions = permissionsForRole("viewer");
  assert.equal(permissions.includes("attendance.manual.view"), true);
  assert.equal(permissions.includes("attendance.manual.manage"), false);
  assert.equal(permissions.includes("students.view"), true);
  assert.equal(permissions.includes("students.manage"), false);
  assert.equal(permissions.includes("leave.manage"), false);
});

test("unknown levels fail safe to owner for legacy rows", () => {
  assert.equal(normalizeStaffRole(undefined), "owner");
  assert.equal(normalizeStaffRole("owner"), "owner");
  assert.equal(normalizeStaffRole("manager"), "manager");
  assert.equal(normalizeStaffRole("nonsense"), "owner");
});

test("auth and bootstrap need no extra permission; profile is always granted", () => {
  for (const [method, path, expected = null] of [
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/switch-faculty"],
    ["GET", "/api/me", "profile.view"],
    ["GET", "/api/bootstrap", "dashboard.view"],
    ["GET", "/api/notifications", "dashboard.view"],
    ["GET", "/api/notifications/unread-count", "dashboard.view"],
    ["GET", "/api/faculties"],
    ["GET", "/health"],
  ]) {
    assert.equal(permissionForRequest(method, path), expected, `${method} ${path}`);
  }
});

test("module routes map to the right permission", () => {
  const cases = [
    ["GET", "/api/students", "students.view"],
    ["POST", "/api/students", "students.manage"],
    ["PATCH", "/api/students/abc", "students.manage"],
    ["POST", "/api/students/abc/photos", "attendance.face.manage"],
    ["POST", "/api/students/abc/voice-samples", "attendance.voice.manage"],
    ["POST", "/api/import/students", "students.manage"],
    ["POST", "/api/courses", "courses.manage"],
    ["POST", "/api/sessions", "sessions.manage"],
    ["GET", "/api/sessions/live", "attendance.live.view"],
    ["POST", "/api/sessions/abc/live/start", "attendance.live.manage"],
    ["PUT", "/api/attendance", "attendance.manual.manage"],
    ["GET", "/api/face-recognition/events", "attendance.face.view"],
    ["GET", "/api/fingerprint/credentials", "attendance.fingerprint.manage"],
    ["POST", "/api/leave-requests/abc/review", "leave.manage"],
    ["GET", "/api/leave-requests", "leave.view"],
    ["POST", "/api/leave-requests", "leave.manage"],
    ["POST", "/api/attendance-objections/abc/review", "objections.manage"],
    ["POST", "/api/attendance-objections", "objections.manage"],
    ["GET", "/api/attendance-objections", "objections.view"],
    ["GET", "/api/exams", "exams.view"],
    ["POST", "/api/exams", "exams.manage"],
    ["GET", "/api/exams/abc/analysis", "reports.view"],
    ["GET", "/api/teachers", "teachers.view"],
    ["DELETE", "/api/teachers/abc", "teachers.manage"],
    ["GET", "/api/admin/activity", "activity.view"],
    ["PATCH", "/api/registrations/abc/approve", "registrations.manage"],
    ["GET", "/api/tickets", "tickets.view"],
    ["POST", "/api/tickets/abc/respond", "tickets.manage"],
    ["PUT", "/api/settings", "settings.manage"],
    ["GET", "/api/staff", "staff.manage"],
    ["POST", "/api/staff", "staff.manage"],
    ["GET", "/api/platform/overview", "staff.manage"],
  ];
  for (const [method, path, expected] of cases) {
    assert.equal(permissionForRequest(method, path), expected, `${method} ${path}`);
  }
});

test("query strings are ignored and unknown routes stay locked", () => {
  assert.equal(permissionForRequest("GET", "/api/students?page=2"), "students.view");
  assert.equal(permissionForRequest("GET", "/api/secret"), "unmapped");
});

test("role checks combine with the route permission", () => {
  const manual = permissionForRequest("PUT", "/api/attendance");
  assert.equal(staffRoleAllows("operator", manual), true);
  assert.equal(staffRoleAllows("viewer", manual), false);

  const reports = permissionForRequest("GET", "/api/analytics/trend");
  assert.equal(staffRoleAllows("viewer", reports), true);
  assert.equal(staffRoleAllows("operator", reports), true);
  assert.equal(staffRoleAllows("viewer", "settings.manage"), false);

  const exams = permissionForRequest("POST", "/api/exams");
  assert.equal(staffRoleAllows("manager", exams), true);
  assert.equal(staffRoleAllows("operator", exams), false);

  assert.equal(staffRoleAllows("manager", "staff.manage"), false);
});

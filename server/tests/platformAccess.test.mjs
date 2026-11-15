import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_LEVEL_RANK,
  FACULTY_ADMIN_LEVELS,
  PLATFORM_LEVELS,
  PLATFORM_LEVEL_RANK,
  facultyLevelDenial,
  platformLevelAllows,
} from "../src/platformAccess.js";

describe("platformLevelAllows", () => {
  it("orders owner above operator above auditor", () => {
    assert.equal(platformLevelAllows("owner", "owner"), true);
    assert.equal(platformLevelAllows("operator", "owner"), false);
    assert.equal(platformLevelAllows("operator", "operator"), true);
    assert.equal(platformLevelAllows("auditor", "operator"), false);
    assert.equal(platformLevelAllows("auditor", "auditor"), true);
  });

  it("defaults to the lowest requirement", () => {
    assert.equal(platformLevelAllows("auditor"), true);
    assert.equal(platformLevelAllows(undefined), false);
  });

  it("exposes the documented levels and ranks", () => {
    assert.deepEqual(PLATFORM_LEVELS, ["owner", "operator", "auditor"]);
    assert.deepEqual(FACULTY_ADMIN_LEVELS, [
      "owner",
      "manager",
      "operator",
      "viewer",
    ]);
    assert.ok(PLATFORM_LEVEL_RANK.owner > PLATFORM_LEVEL_RANK.operator);
    assert.ok(ADMIN_LEVEL_RANK.owner > ADMIN_LEVEL_RANK.manager);
    assert.ok(ADMIN_LEVEL_RANK.manager > ADMIN_LEVEL_RANK.operator);
    assert.ok(ADMIN_LEVEL_RANK.operator > ADMIN_LEVEL_RANK.viewer);
  });
});

describe("facultyLevelDenial", () => {
  it("lets every level read faculty data", () => {
    for (const level of FACULTY_ADMIN_LEVELS) {
      assert.equal(facultyLevelDenial(level, "GET", "/api/students"), null);
      assert.equal(facultyLevelDenial(level, "HEAD", "/api/students"), null);
    }
  });

  it("blocks every write for a viewer", () => {
    assert.ok(facultyLevelDenial("viewer", "POST", "/api/students"));
    assert.ok(facultyLevelDenial("viewer", "PUT", "/api/courses/1"));
    assert.ok(facultyLevelDenial("viewer", "PATCH", "/api/settings"));
    assert.ok(facultyLevelDenial("viewer", "DELETE", "/api/exams/1"));
  });

  it("still lets a viewer change their own password", () => {
    assert.equal(
      facultyLevelDenial("viewer", "POST", "/api/auth/change-password"),
      null,
    );
    assert.equal(facultyLevelDenial("viewer", "POST", "/api/auth/logout"), null);
  });

  it("blocks deletes for an operator but allows other writes", () => {
    assert.ok(facultyLevelDenial("operator", "DELETE", "/api/students/1"));
    assert.equal(facultyLevelDenial("operator", "POST", "/api/students"), null);
    assert.equal(facultyLevelDenial("operator", "PUT", "/api/courses/1"), null);
  });

  it("keeps settings and teachers read-only for an operator", () => {
    assert.ok(facultyLevelDenial("operator", "PUT", "/api/settings"));
    assert.ok(facultyLevelDenial("operator", "POST", "/api/settings"));
    assert.ok(facultyLevelDenial("operator", "POST", "/api/teachers"));
    assert.ok(facultyLevelDenial("operator", "PATCH", "/api/teachers/1"));
    assert.equal(facultyLevelDenial("operator", "GET", "/api/teachers"), null);
  });

  it("blocks deletes and teacher management for a manager", () => {
    assert.ok(facultyLevelDenial("manager", "DELETE", "/api/students/1"));
    assert.ok(facultyLevelDenial("manager", "POST", "/api/teachers"));
    assert.ok(facultyLevelDenial("manager", "PUT", "/api/teachers/1"));
    assert.equal(facultyLevelDenial("manager", "PUT", "/api/settings"), null);
    assert.equal(facultyLevelDenial("manager", "POST", "/api/courses"), null);
  });

  it("gives the owner unrestricted access", () => {
    assert.equal(facultyLevelDenial("owner", "DELETE", "/api/students/1"), null);
    assert.equal(facultyLevelDenial("owner", "POST", "/api/teachers"), null);
    assert.equal(facultyLevelDenial("owner", "PUT", "/api/settings"), null);
  });

  it("treats a missing level as owner for legacy admins", () => {
    assert.equal(facultyLevelDenial(null, "DELETE", "/api/students/1"), null);
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  FACE_DESCRIPTOR_LENGTH,
  MAX_REFERENCE_PHOTOS,
  evaluateFaceAttendance,
  normalizeDescriptor,
  normalizeQuality,
  validateFaceEnrollment,
} from "../src/faceVerification.js";

function descriptor(value = 0.1) {
  return Array.from({ length: FACE_DESCRIPTOR_LENGTH }, () => value);
}

test("normalizeDescriptor accepts arrays, typed arrays and JSON strings", () => {
  assert.equal(normalizeDescriptor(descriptor()).length, FACE_DESCRIPTOR_LENGTH);
  assert.equal(
    normalizeDescriptor(new Float32Array(descriptor())).length,
    FACE_DESCRIPTOR_LENGTH,
  );
  assert.equal(
    normalizeDescriptor(JSON.stringify(descriptor())).length,
    FACE_DESCRIPTOR_LENGTH,
  );
});

test("normalizeDescriptor rejects wrong shapes and non-finite values", () => {
  assert.equal(normalizeDescriptor(null), null);
  assert.equal(normalizeDescriptor([1, 2, 3]), null);
  assert.equal(normalizeDescriptor("not json"), null);
  const withNaN = descriptor();
  withNaN[3] = Number.NaN;
  assert.equal(normalizeDescriptor(withNaN), null);
  const tooLarge = descriptor();
  tooLarge[0] = 9;
  assert.equal(normalizeDescriptor(tooLarge), null);
});

test("normalizeQuality keeps only known bounded fields", () => {
  const quality = normalizeQuality({
    score: 0.91,
    faces: 1,
    width: 240,
    height: 240,
    blur: 0.1,
    secret: "ignored",
  });
  assert.deepEqual(quality, {
    score: 0.91,
    faces: 1,
    width: 240,
    height: 240,
    blur: 0.1,
  });
  assert.equal(normalizeQuality({ score: 5 }), null);
  assert.equal(normalizeQuality(null), null);
});

test("validateFaceEnrollment accepts one clear face", () => {
  const result = validateFaceEnrollment({
    descriptor: descriptor(),
    quality: { score: 0.9, faces: 1, width: 200, height: 200 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.featureVersion, 1);
  assert.equal(result.descriptor.length, FACE_DESCRIPTOR_LENGTH);
});

test("validateFaceEnrollment rejects an unusable photo", () => {
  assert.equal(
    validateFaceEnrollment({ descriptor: null, quality: null }).reason,
    "descriptor_invalid",
  );
  assert.equal(
    validateFaceEnrollment({
      descriptor: descriptor(),
      quality: { faces: 0 },
    }).reason,
    "faces_count",
  );
  assert.equal(
    validateFaceEnrollment({
      descriptor: descriptor(),
      quality: { faces: 2 },
    }).reason,
    "faces_count",
  );
  assert.equal(
    validateFaceEnrollment({
      descriptor: descriptor(),
      quality: { score: 0.1 },
    }).reason,
    "score_low",
  );
  assert.equal(
    validateFaceEnrollment({
      descriptor: descriptor(),
      quality: { width: 20 },
    }).reason,
    "face_too_small",
  );
});

test("face attendance is irrelevant for manual methods", () => {
  assert.deepEqual(evaluateFaceAttendance({ method: "manual" }), {
    ok: true,
    applicable: false,
  });
});

test("face attendance respects the faculty setting", () => {
  const result = evaluateFaceAttendance({
    method: "face",
    verification: { distance: 0.3, liveness: "blink" },
    settings: { faceRecognitionEnabled: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "disabled");
});

test("face attendance requires a verification payload", () => {
  const result = evaluateFaceAttendance({ method: "face" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "verification_missing");
});

test("face attendance rejects implausible distances and narrow margins", () => {
  assert.equal(
    evaluateFaceAttendance({
      method: "face",
      verification: { distance: 0.9, liveness: "blink" },
    }).reason,
    "distance_out_of_range",
  );
  assert.equal(
    evaluateFaceAttendance({
      method: "face",
      verification: { distance: 0.5, margin: 0.001, liveness: "blink" },
    }).reason,
    "margin_too_small",
  );
  assert.equal(
    evaluateFaceAttendance({
      method: "face",
      verification: { distance: 0.595, liveness: "blink" },
    }).reason,
    "distance_too_far",
  );
});

test("personal mode accepts a blink-verified match", () => {
  const result = evaluateFaceAttendance({
    method: "face",
    verification: {
      distance: 0.31,
      margin: 0.12,
      threshold: 0.54,
      liveness: "blink",
      frameCount: 2,
      deviceId: "camera-1",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "accepted");
  assert.equal(result.distance, 0.31);
  assert.equal(result.liveness, "blink");
});

test("single-candidate matches may omit margin and threshold", () => {
  const result = evaluateFaceAttendance({
    method: "face",
    verification: {
      distance: 0.28,
      margin: null,
      threshold: null,
      liveness: "blink",
      frameCount: 2,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.margin, null);
  assert.equal(result.threshold, 0.54);
});

test("classroom mode needs several consecutive frames when liveness is absent", () => {
  const oneFrame = evaluateFaceAttendance({
    method: "face",
    verification: { distance: 0.3, margin: 0.1, frameCount: 1 },
  });
  assert.equal(oneFrame.ok, false);
  assert.equal(oneFrame.reason, "liveness_missing");

  const threeFrames = evaluateFaceAttendance({
    method: "face",
    verification: { distance: 0.3, margin: 0.1, frameCount: 3 },
  });
  assert.equal(threeFrames.ok, true);
  assert.equal(threeFrames.decision, "accepted");
  assert.equal(threeFrames.frameCount, 3);
});

test("reference gallery limit stays small", () => {
  assert.ok(MAX_REFERENCE_PHOTOS >= 3 && MAX_REFERENCE_PHOTOS <= 10);
});

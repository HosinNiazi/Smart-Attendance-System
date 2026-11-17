import test from "node:test";
import assert from "node:assert/strict";

import {
  FACE_DESCRIPTOR_LENGTH,
  MAX_REFERENCE_PHOTOS,
  DESCRIPTOR_MATCH_TOLERANCE,
  evaluateFaceAttendance,
  normalizeDescriptor,
  normalizeQuality,
  validateFaceEnrollment,
  verifyDescriptorClaim,
} from "../src/faceVerification.js";

function descriptor(value = 0.1) {
  return Array.from({ length: FACE_DESCRIPTOR_LENGTH }, () => value);
}

// Realistic descriptors are near unit-norm with varied entries, so distances
// land in the same range face-api produces (0.2 – 0.6).
function realisticDescriptor() {
  return Array.from({ length: FACE_DESCRIPTOR_LENGTH }, (_, index) =>
    Number((Math.sin(index * 0.7) * 0.08).toFixed(6)),
  );
}
function shiftedDescriptor() {
  const copy = realisticDescriptor();
  copy[0] += 0.1; // exactly 0.1 away from realisticDescriptor()
  return copy.map((value) => Number(value.toFixed(6)));
}
function offsetDescriptor(offset) {
  return realisticDescriptor().map((value) =>
    Number((value + offset).toFixed(6)),
  );
}
function negatedDescriptor() {
  return realisticDescriptor().map((value) => -value);
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

test("faculty policy overrides the matching distance", () => {
  const strict = evaluateFaceAttendance({
    method: "face",
    verification: {
      distance: 0.52,
      margin: 0.1,
      liveness: "blink",
      frameCount: 2,
    },
    settings: { faceMatchDistance: 0.45 },
  });
  assert.equal(strict.ok, false);
  assert.equal(strict.reason, "distance_too_far");

  const lenient = evaluateFaceAttendance({
    method: "face",
    verification: {
      distance: 0.5,
      margin: 0.1,
      liveness: "blink",
      frameCount: 2,
    },
    settings: { faceMatchDistance: 0.6 },
  });
  assert.equal(lenient.ok, true);
  assert.equal(lenient.threshold, 0.6);
});

test("faculty policy overrides the confidence margin", () => {
  const strict = evaluateFaceAttendance({
    method: "face",
    verification: {
      distance: 0.3,
      margin: 0.04,
      liveness: "blink",
      frameCount: 2,
    },
    settings: { faceMatchMargin: 0.08 },
  });
  assert.equal(strict.ok, false);
  assert.equal(strict.reason, "margin_too_small");
});

test("faculty policy overrides the required frame count", () => {
  const twoFramesNeeded = evaluateFaceAttendance({
    method: "face",
    verification: { distance: 0.3, margin: 0.1, frameCount: 2 },
    settings: { faceMinFrames: 2 },
  });
  assert.equal(twoFramesNeeded.ok, true);

  const fiveFramesNeeded = evaluateFaceAttendance({
    method: "face",
    verification: { distance: 0.3, margin: 0.1, frameCount: 4 },
    settings: { faceMinFrames: 5 },
  });
  assert.equal(fiveFramesNeeded.ok, false);
  assert.equal(fiveFramesNeeded.reason, "liveness_missing");
});

test("a faculty may waive liveness for single-person attendance", () => {
  const result = evaluateFaceAttendance({
    method: "face",
    verification: { distance: 0.3, margin: 0.1, frameCount: 1 },
    settings: { faceLivenessRequired: false, faceMinFrames: 3 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.liveness, "none_provided");
});

test("reference gallery limit stays small", () => {
  assert.ok(MAX_REFERENCE_PHOTOS >= 3 && MAX_REFERENCE_PHOTOS <= 10);
});

test("descriptor claim matches an identical stored descriptor", () => {
  const live = realisticDescriptor();
  const result = verifyDescriptorClaim({
    liveDescriptor: live,
    storedDescriptors: [realisticDescriptor()],
    claimedDistance: 0.01,
    maxDistance: 0.54,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.ok(result.serverDistance < 0.01);
});

test("descriptor claim rejects a face that is too far from the gallery", () => {
  const result = verifyDescriptorClaim({
    liveDescriptor: realisticDescriptor(),
    storedDescriptors: [negatedDescriptor()],
    claimedDistance: 0.1,
    maxDistance: 0.54,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "distance_mismatch");
  assert.ok(result.serverDistance > 0.6);
});

test("descriptor claim rejects a forged claimed distance", () => {
  // The real server distance is ≈ 0.35, but the client claims 0.05.
  const result = verifyDescriptorClaim({
    liveDescriptor: realisticDescriptor(),
    storedDescriptors: [offsetDescriptor(0.031)],
    claimedDistance: 0.05,
    maxDistance: 0.54,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "distance_mismatch");
});

test("descriptor claim tolerates small drift within the tolerance", () => {
  const result = verifyDescriptorClaim({
    liveDescriptor: shiftedDescriptor(),
    storedDescriptors: [realisticDescriptor()],
    claimedDistance: 0.1,
    maxDistance: 0.54,
  });
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.serverDistance - 0.1) < DESCRIPTOR_MATCH_TOLERANCE);
});

test("a missing live descriptor is skipped but flagged", () => {
  const result = verifyDescriptorClaim({
    liveDescriptor: null,
    storedDescriptors: [descriptor(0.1)],
    claimedDistance: 0.1,
    maxDistance: 0.54,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "live_descriptor_missing");
  assert.equal(result.skipped, true);

  const noGallery = verifyDescriptorClaim({
    liveDescriptor: descriptor(0.1),
    storedDescriptors: [],
    claimedDistance: 0.1,
    maxDistance: 0.54,
  });
  assert.equal(noGallery.ok, true);
  assert.equal(noGallery.skipped, true);
});

// Pure helpers for face enrollment and server-side attendance verification.
//
// The browser still performs the actual matching (the models run client-side),
// but the server now:
//   * validates and stores the 128-dimension descriptor at enrollment time,
//   * refuses photos that the client reports as unusable,
//   * refuses face attendance without a plausible verification payload,
//   * records every decision in face_recognition_events.
//
// Keeping the rules here (instead of inline in server.js) makes them unit
// testable without a database or a browser.

export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_FEATURE_VERSION = 1;
export const FACE_DESCRIPTOR_MODEL = "face-recognition-128-v1";

// Matching thresholds mirror the browser defaults so the two sides agree.
export const DEFAULT_FACE_MAX_DISTANCE = 0.54;
export const DEFAULT_FACE_MIN_MARGIN = 0.035;

// Hard limits the server accepts even if a client claims better numbers.
export const MAX_FACE_DISTANCE_ALLOWED = 0.75;
export const MIN_FACE_MARGIN_ALLOWED = 0.005;

// Enrollment keeps a small gallery per student instead of a single photo.
export const MAX_REFERENCE_PHOTOS = 5;

// Phase 3+: how far the server-recomputed distance may drift from the
// distance the browser claimed before the claim is treated as forged.
export const DESCRIPTOR_MATCH_TOLERANCE = 0.15;

// Photos with a detection score below this are not usable as references.
export const MIN_ENROLLMENT_SCORE = 0.4;
// A face smaller than this many pixels is too blurry for a stable descriptor.
export const MIN_ENROLLMENT_FACE_PX = 80;

export const FACE_METHODS = new Set(["face", "class_camera"]);

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

// Accepts an array / typed array / JSON string and returns a plain array of
// 128 finite numbers, or null when the value cannot be a face descriptor.
export function normalizeDescriptor(value) {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return null;
    }
  }
  if (!list || typeof list.length !== "number") return null;
  if (list.length !== FACE_DESCRIPTOR_LENGTH) return null;
  const out = [];
  for (const item of Array.from(list)) {
    const number = Number(item);
    if (!Number.isFinite(number) || Math.abs(number) > 2) return null;
    out.push(round(number));
  }
  return out;
}

function numberInRange(value, min, max) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

// Keeps only the quality fields we understand, so arbitrary client JSON cannot
// bloat the row or be echoed back to other users.
export function normalizeQuality(value) {
  if (!value || typeof value !== "object") return null;
  const quality = {};
  if (numberInRange(value.score, 0, 1)) quality.score = round(value.score);
  if (numberInRange(value.faces, 0, 50)) quality.faces = Math.trunc(value.faces);
  if (numberInRange(value.width, 0, 20000)) quality.width = Math.trunc(value.width);
  if (numberInRange(value.height, 0, 20000))
    quality.height = Math.trunc(value.height);
  if (numberInRange(value.blur, 0, 1)) quality.blur = round(value.blur);
  return Object.keys(quality).length ? quality : null;
}

// Rules applied when a student photo is uploaded.
export function validateFaceEnrollment({ descriptor, quality }) {
  const normalized = normalizeDescriptor(descriptor);
  if (!normalized) {
    return {
      ok: false,
      reason: "descriptor_invalid",
      message:
        "چهرهٔ قابل استفاده در این تصویر پیدا نشد. عکس روشن، روبه‌رو و بدون تارشدگی انتخاب کنید.",
    };
  }

  const normalizedQuality = normalizeQuality(quality);
  if (normalizedQuality) {
    if (normalizedQuality.faces != null && normalizedQuality.faces !== 1) {
      return {
        ok: false,
        reason: "faces_count",
        message:
          normalizedQuality.faces === 0
            ? "در این تصویر چهره‌ای شناسایی نشد؛ عکس روشن‌تر انتخاب کنید."
            : "در این تصویر بیش از یک چهره دیده می‌شود؛ عکسی با یک نفر انتخاب کنید.",
      };
    }
    if (
      normalizedQuality.score != null &&
      normalizedQuality.score < MIN_ENROLLMENT_SCORE
    ) {
      return {
        ok: false,
        reason: "score_low",
        message: "کیفیت تصویر برای ثبت مرجع چهره کافی نیست؛ عکس واضح‌تری انتخاب کنید.",
      };
    }
    if (
      normalizedQuality.width != null &&
      normalizedQuality.width < MIN_ENROLLMENT_FACE_PX
    ) {
      return {
        ok: false,
        reason: "face_too_small",
        message: "چهره در تصویر خیلی کوچک است؛ نزدیک‌تر از دوربین عکس بگیرید.",
      };
    }
  }

  return {
    ok: true,
    descriptor: normalized,
    quality: normalizedQuality,
    featureVersion: FACE_FEATURE_VERSION,
  };
}

// Rules applied when attendance is saved with method "face" / "class_camera".
// Returns a decision object instead of throwing so the route can store a
// rejected event before responding with an error.
export function evaluateFaceAttendance({
  method,
  verification,
  settings,
  maxDistance = DEFAULT_FACE_MAX_DISTANCE,
  minMargin = DEFAULT_FACE_MIN_MARGIN,
} = {}) {
  if (!FACE_METHODS.has(method)) {
    return { ok: true, applicable: false };
  }

  if (settings && settings.faceRecognitionEnabled === false) {
    return {
      ok: false,
      applicable: true,
      reason: "disabled",
      message: "تشخیص چهره برای این دانشکده غیرفعال است.",
    };
  }

  // Faculty-level policy. Values arrive as numeric columns from PostgreSQL, so
  // coerce once and fall back to the defaults for missing/legacy rows.
  const policyDistance = Number(settings?.faceMatchDistance);
  const policyMargin = Number(settings?.faceMatchMargin);
  const policyFrames = Number(settings?.faceMinFrames);
  const effectiveMaxDistance =
    Number.isFinite(policyDistance) && policyDistance > 0
      ? policyDistance
      : maxDistance;
  const effectiveMinMargin =
    Number.isFinite(policyMargin) && policyMargin >= 0
      ? policyMargin
      : minMargin;
  const minFrames =
    Number.isInteger(policyFrames) && policyFrames >= 1 ? policyFrames : 3;
  const livenessRequired = settings?.faceLivenessRequired !== false;

  if (!verification || typeof verification !== "object") {
    return {
      ok: false,
      applicable: true,
      reason: "verification_missing",
      message:
        "ثبت حضور با چهره نیازمند اطلاعات اعتبارسنجی است. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.",
    };
  }

  const distance = Number(verification.distance);
  if (!Number.isFinite(distance) || distance < 0 || distance > MAX_FACE_DISTANCE_ALLOWED) {
    return {
      ok: false,
      applicable: true,
      reason: "distance_out_of_range",
      message: "میزان تطبیق چهره برای ثبت حضور کافی نیست.",
      distance: Number.isFinite(distance) ? distance : null,
    };
  }
  if (distance > effectiveMaxDistance + 0.05) {
    return {
      ok: false,
      applicable: true,
      reason: "distance_too_far",
      message: "چهره به اندازهٔ کافی با عکس مرجع مطابقت ندارد.",
      distance,
    };
  }

  const margin = verification.margin == null ? null : Number(verification.margin);
  const marginFloor = Math.max(MIN_FACE_MARGIN_ALLOWED, effectiveMinMargin);
  if (
    margin != null &&
    (!Number.isFinite(margin) || margin < marginFloor)
  ) {
    return {
      ok: false,
      applicable: true,
      reason: "margin_too_small",
      message: "چهرهٔ شناسایی‌شده به چند دانشجو نزدیک است؛ دوباره مقابل دوربین قرار بگیرید.",
      distance,
      margin: Number.isFinite(margin) ? margin : null,
    };
  }

  const liveness = ["blink", "motion", "teacher_confirm"].includes(
    verification.liveness,
  )
    ? verification.liveness
    : "none_provided";
  const frameCount = Math.trunc(Number(verification.frameCount) || 0);

  if (livenessRequired && liveness === "none_provided" && frameCount < minFrames) {
    return {
      ok: false,
      applicable: true,
      reason: "liveness_missing",
      message:
        "برای ثبت حضور باید پلک بزنید یا چهره چند فریم پیوسته تأیید شود.",
      distance,
      margin,
      liveness,
      frameCount,
    };
  }

  return {
    ok: true,
    applicable: true,
    decision: "accepted",
    distance,
    margin,
    threshold:
      verification.threshold != null && Number.isFinite(Number(verification.threshold))
        ? Number(verification.threshold)
        : effectiveMaxDistance,
    minMargin: effectiveMinMargin,
    minFrames,
    liveness,
    frameCount,
    deviceId:
      typeof verification.deviceId === "string"
        ? verification.deviceId.slice(0, 200)
        : null,
    referenceId:
      typeof verification.referenceId === "string" ? verification.referenceId : null,
  };
}

// Euclidean distance between two already-normalized descriptors. Kept here so
// the server recomputes exactly what the browser computes.
export function normalizedDistance(a, b) {
  let sum = 0;
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

// Phase 3+ (A): the browser cannot be trusted on its own word, but it can send
// the *live* descriptor of the face it matched. The server re-normalizes it the
// same way the browser does, recomputes the distance against the stored
// gallery and rejects the claim when
//   * the best stored distance is beyond the policy threshold (+ slack), or
//   * it drifts too far from the distance the client reported.
// A missing live descriptor keeps old clients working but is flagged so the
// event log shows when the stronger check did not run.
export function verifyDescriptorClaim({
  liveDescriptor,
  storedDescriptors,
  claimedDistance,
  maxDistance,
  tolerance = DESCRIPTOR_MATCH_TOLERANCE,
} = {}) {
  const query = normalizeDescriptor(liveDescriptor);
  if (!query)
    return {
      ok: false,
      reason: "live_descriptor_missing",
      serverDistance: null,
      skipped: true,
    };

  const stored = (storedDescriptors || [])
    .map((item) => normalizeDescriptor(item))
    .filter(Boolean);
  if (!stored.length)
    return {
      ok: true,
      reason: null,
      serverDistance: null,
      skipped: true,
    };

  let best = Infinity;
  for (const descriptor of stored) {
    const distance = normalizedDistance(query, descriptor);
    if (distance < best) best = distance;
  }

  const threshold = Number(maxDistance);
  if (
    Number.isFinite(threshold) &&
    best > threshold + 0.05
  )
    return { ok: false, reason: "distance_mismatch", serverDistance: best };

  const claimed = Number(claimedDistance);
  if (Number.isFinite(claimed) && Math.abs(best - claimed) > tolerance)
    return { ok: false, reason: "distance_mismatch", serverDistance: best };

  return { ok: true, reason: null, serverDistance: best, skipped: false };
}

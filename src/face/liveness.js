/**
 * Blink-based liveness via Eye Aspect Ratio (EAR).
 *
 * Typical blinks last ~100–400ms, so the scanner must run faster than that
 * or closed frames are missed entirely. Baseline is frozen after calibration
 * so a partial blink cannot drag thresholds down.
 */

export const FACE_DESCRIPTOR_VERSION = 1;
export const FACE_MATCH_DISTANCE = 0.52;
export const FACE_MATCH_MARGIN = 0.04;
export const FACE_SCAN_INTERVAL_MS = 160;
export const CLASSROOM_SCAN_INTERVAL_MS = 200;

const CALIBRATION_SAMPLES = 8;
const CLOSED_FRAMES_NEEDED = 2;
const OPEN_FRAMES_NEEDED = 2;
const MIN_BASELINE = 0.18;
const MAX_BASELINE = 0.42;
const CLOSE_RATIO = 0.68;
const DEEP_CLOSE_RATIO = 0.55;
const REOPEN_RATIO = 0.86;
const ABS_CLOSE_FLOOR = 0.12;
const LOST_FRAMES_LIMIT = 10;
const LOST_FRAMES_KEEP_VERIFIED = 18;

export function eyeAspectRatio(points) {
  if (!points || points.length < 6) return null;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const vertical =
    d(points[1], points[5]) + d(points[2], points[4]);
  const horizontal = Math.max(d(points[0], points[3]), 1e-6);
  const ear = vertical / (2 * horizontal);
  if (!Number.isFinite(ear) || ear <= 0 || ear > 1) return null;
  return ear;
}

export function averageEyeRatio(landmarks) {
  if (!landmarks) return null;
  const left = eyeAspectRatio(landmarks.getLeftEye());
  const right = eyeAspectRatio(landmarks.getRightEye());
  if (left == null || right == null) return null;
  return {
    left,
    right,
    mean: (left + right) / 2,
    min: Math.min(left, right),
    max: Math.max(left, right),
  };
}

export function createLivenessState() {
  return {
    phase: "calibrating", // calibrating | ready | closing | closed | verified
    verified: false,
    openBaseline: 0,
    openSamples: 0,
    closedFrames: 0,
    openFrames: 0,
    lostFrames: 0,
    lastEar: null,
    hint: "چهره را ثابت نگه دارید تا کالیبره شود",
  };
}

function thresholds(baseline) {
  const closeThreshold = Math.max(ABS_CLOSE_FLOOR, baseline * CLOSE_RATIO);
  const reopenThreshold = Math.max(
    closeThreshold + 0.035,
    baseline * REOPEN_RATIO,
  );
  return { closeThreshold, reopenThreshold };
}

/**
 * Advance blink state machine with one EAR sample.
 * Returns the mutated state (same object) for convenience.
 */
export function updateLiveness(state, earSample) {
  if (!state) return createLivenessState();
  if (state.verified) {
    state.lostFrames = 0;
    state.hint = "زنده‌بودن تأیید شد";
    return state;
  }

  if (!earSample || earSample.mean == null) {
    state.lostFrames += 1;
    return state;
  }

  state.lostFrames = 0;
  state.lastEar = earSample.mean;
  const { mean, min } = earSample;

  if (state.phase === "calibrating") {
    // Only accept clear open-eye samples for the baseline.
    if (mean >= MIN_BASELINE && mean <= MAX_BASELINE && min > ABS_CLOSE_FLOOR + 0.02) {
      state.openBaseline =
        state.openSamples === 0
          ? mean
          : state.openBaseline * 0.7 + mean * 0.3;
      state.openSamples += 1;
    }
    if (state.openSamples >= CALIBRATION_SAMPLES) {
      state.phase = "ready";
      state.hint = "یک‌بار به‌آرامی پلک بزنید";
    } else {
      state.hint = `کالیبره چشم… ${state.openSamples}/${CALIBRATION_SAMPLES}`;
    }
    return state;
  }

  const baseline = Math.max(state.openBaseline, MIN_BASELINE);
  const { closeThreshold, reopenThreshold } = thresholds(baseline);

  // Soft refresh of baseline only while fully open and waiting for a blink.
  if (
    state.phase === "ready" &&
    mean > reopenThreshold &&
    min > closeThreshold + 0.02
  ) {
    state.openBaseline = baseline * 0.97 + mean * 0.03;
  }

  const bothClosed = mean < closeThreshold && min < closeThreshold + 0.025;
  const clearlyOpen = mean > reopenThreshold && min > closeThreshold + 0.02;

  const deepCloseThreshold = Math.max(
    ABS_CLOSE_FLOOR,
    baseline * DEEP_CLOSE_RATIO,
  );
  const deepClosed = mean < deepCloseThreshold && min < closeThreshold + 0.01;

  if (state.phase === "ready") {
    if (bothClosed) {
      state.closedFrames = 1;
      // A deep single-frame blink is enough — short blinks often last <200ms.
      if (deepClosed) {
        state.phase = "closed";
        state.openFrames = 0;
        state.hint = "حالا چشم‌ها را باز کنید";
      } else {
        state.phase = "closing";
        state.hint = "چشم‌ها بسته شد…";
      }
    } else {
      state.hint = "یک‌بار به‌آرامی پلک بزنید";
    }
    return state;
  }

  if (state.phase === "closing") {
    if (bothClosed) {
      state.closedFrames += 1;
      if (state.closedFrames >= CLOSED_FRAMES_NEEDED || deepClosed) {
        state.phase = "closed";
        state.openFrames = 0;
        state.hint = "حالا چشم‌ها را باز کنید";
      } else {
        state.hint = "چشم‌ها بسته شد…";
      }
    } else if (clearlyOpen) {
      // False start — back to waiting.
      state.closedFrames = 0;
      state.phase = "ready";
      state.hint = "یک‌بار به‌آرامی پلک بزنید";
    }
    return state;
  }

  if (state.phase === "closed") {
    if (clearlyOpen) {
      state.openFrames = 1;
      state.phase = "opening";
      state.hint = "در حال تأیید پلک…";
    } else if (bothClosed) {
      state.hint = "حالا چشم‌ها را باز کنید";
    }
    return state;
  }

  if (state.phase === "opening") {
    if (clearlyOpen) {
      state.openFrames += 1;
      if (state.openFrames >= OPEN_FRAMES_NEEDED) {
        state.verified = true;
        state.phase = "verified";
        state.hint = "زنده‌بودن تأیید شد";
      } else {
        state.hint = "در حال تأیید پلک…";
      }
    } else if (bothClosed) {
      // Another close before reopen completed — stay in closed cycle.
      state.phase = "closed";
      state.openFrames = 0;
      state.closedFrames = Math.max(state.closedFrames, CLOSED_FRAMES_NEEDED);
      state.hint = "حالا چشم‌ها را باز کنید";
    }
  }

  return state;
}

export function tickLivenessLost(state, keepVerified = false) {
  if (!state) return null;
  state.lostFrames += 1;
  const limit = state.verified && keepVerified
    ? LOST_FRAMES_KEEP_VERIFIED
    : LOST_FRAMES_LIMIT;
  if (state.lostFrames > limit) return null;
  return state;
}

export function livenessPhaseLabel(state) {
  if (!state) return "در انتظار چهره";
  if (state.verified) return "زنده‌بودن تأیید شد";
  return state.hint || "در حال بررسی زنده‌بودن";
}

export function objectKeyFromPhotoUrl(url) {
  if (!url) return "";
  const marker = "/uploads/students/";
  const index = String(url).indexOf(marker);
  if (index >= 0) return String(url).slice(index + marker.length).split(/[?#]/)[0];
  const parts = String(url).split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Lightweight procedural sound effects via Web Audio API.
 * No audio files needed — everything synthesized from oscillators.
 */

let ctx = null;
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  return ctx;
}

function ensurePermission() {
  // Browsers block audio until user interaction. Trigger resume on first play.
  const c = getCtx();
  if (c && c.state === "suspended") c.resume();
}

function tone(freq, startAt, durationMs, type = "sine", gain = 0.12) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const t0 = c.currentTime + startAt;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000);
}

export function playBeep() {
  ensurePermission();
  tone(880, 0, 280, "sine", 0.14);
}

export function playSuccess() {
  ensurePermission();
  // Two-tier bell: higher then lower harmonically
  tone(988, 0, 360, "sine", 0.15);
  tone(1319, 280, 520, "sine", 0.12);
}

export function playUnknown() {
  ensurePermission();
  // Low dissonant buzz
  tone(330, 0, 350, "square", 0.06);
}

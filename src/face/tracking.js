// Lightweight face tracking for the classroom camera.
//
// Detection alone is noisy: the same student can be matched, lost and matched
// again between frames, and a single stray frame could otherwise award
// attendance. Tracks keep a face identity across frames (by box overlap) and
// the vote window requires several consecutive agreements before attendance is
// written.

export function boxIou(a, b) {
  if (!a || !b) return 0;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  if (intersection <= 0) return 0;
  const union =
    a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function createTrackingState() {
  return { tracks: [], nextId: 1 };
}

// Assigns each detection to an existing track when its box overlaps enough,
// otherwise creates a new track. Returns the same state (mutated) plus one
// trackId per detection, in input order.
export function advanceTracking(
  state,
  boxes,
  now = 0,
  { ttlMs = 1500, minIou = 0.2 } = {},
) {
  if (!state || !Array.isArray(boxes)) {
    return { state: createTrackingState(), faces: [] };
  }

  const alive = state.tracks.filter((track) => now - track.lastSeen <= ttlMs);
  const used = new Set();
  const faces = boxes.map((box) => {
    let best = null;
    let bestScore = 0;
    for (const track of alive) {
      if (used.has(track.id)) continue;
      const score = boxIou(track.box, box);
      if (score > bestScore) {
        bestScore = score;
        best = track;
      }
    }
    if (best && bestScore >= minIou) {
      used.add(best.id);
      best.box = box;
      best.lastSeen = now;
      return { box, trackId: best.id };
    }
    const track = { id: state.nextId++, box, lastSeen: now, window: [] };
    state.tracks.push(track);
    alive.push(track);
    used.add(track.id);
    return { box, trackId: track.id };
  });

  state.tracks = state.tracks.filter((track) => now - track.lastSeen <= ttlMs);
  return { state, faces };
}

// Adds one observation to a track's vote window. Returns the number of times
// this student has been seen on this track within the last `window` frames.
export function recordTrackVote(state, trackId, studentId, { window = 5 } = {}) {
  const track = state?.tracks?.find((item) => item.id === trackId);
  if (!track || !studentId) return 0;
  track.window = [...(track.window || []), String(studentId)].slice(-window);
  return track.window.filter((id) => id === String(studentId)).length;
}

export function trackVoteCount(state, trackId, studentId, { window = 5 } = {}) {
  const track = state?.tracks?.find((item) => item.id === trackId);
  if (!track) return 0;
  return (track.window || [])
    .slice(-window)
    .filter((id) => id === String(studentId)).length;
}

// True when the most recent `needed` observations of the track are all for the
// same student. This rejects flapping between two lookalikes.
export function hasStableVotes(state, trackId, studentId, needed = 3) {
  const track = state?.tracks?.find((item) => item.id === trackId);
  if (!track || !Array.isArray(track.window)) return false;
  if (track.window.length < needed) return false;
  const tail = track.window.slice(-needed);
  return tail.every((id) => id === String(studentId));
}

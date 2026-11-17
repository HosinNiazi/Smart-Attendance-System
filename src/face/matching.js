// Descriptor matching helpers for the face pages.
//
// Phase 3: instead of comparing the live frame to every reference photo
// independently, each student gets a *centroid* descriptor built from all of
// their accepted references. The final distance is the best of
//   * the closest single reference (robust to one bad photo), and
//   * the centroid (stable when a student has several photos).
// This both raises accuracy and shrinks the comparison work: the centroid lets
// the detector skip the remaining references of a student once their centroid
// is clearly out of range.

export function normalizeVector(vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) return null;
  if (vector.length !== 128) return null;
  let sum = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) return null;
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (norm <= 0) return null;
  const out = new Float32Array(128);
  for (let index = 0; index < 128; index += 1)
    out[index] = vector[index] / norm;
  return out;
}

// descriptors: [{ studentId, referenceId, descriptor }]
// Returns { centroids: Map<studentId, Float32Array>, byStudent: Map<studentId, Float32Array[]> }
export function buildMatcherData(descriptors) {
  const byStudent = new Map();
  for (const item of descriptors || []) {
    if (!item?.studentId || !item.descriptor) continue;
    const list = byStudent.get(item.studentId) || [];
    list.push({
      descriptor: item.descriptor,
      referenceId: item.referenceId ?? null,
    });
    byStudent.set(item.studentId, list);
  }
  const centroids = new Map();
  for (const [studentId, list] of byStudent) {
    const normalized = list
      .map((entry) => normalizeVector(entry.descriptor))
      .filter(Boolean);
    if (!normalized.length) continue;
    if (normalized.length === 1) {
      centroids.set(studentId, normalized[0]);
      continue;
    }
    const centroid = new Float32Array(128);
    for (const vector of normalized)
      for (let index = 0; index < 128; index += 1)
        centroid[index] += vector[index];
    centroids.set(studentId, normalizeVector(centroid));
  }
  return { centroids, byStudent };
}

// distance is a plain function so tests (and the caller) can inject the same
// euclideanDistance helper face-api uses. `prune` skips the per-reference scan
// for students whose centroid is already clearly out of range — the common
// case in a classroom, which keeps the per-frame cost close to O(students).
export function matchDescriptor(
  descriptor,
  { centroids, byStudent },
  distance,
  { prune = 0.7 } = {},
) {
  if (!descriptor || !centroids || !distance) return [];
  const query = normalizeVector(descriptor);
  if (!query) return [];

  const ranked = [];
  for (const [studentId, centroid] of centroids) {
    let nearest = distance(query, centroid);
    let referenceId = null;
    // With several references, the single closest photo can still win over the
    // centroid, so only students with more than one reference (and a centroid
    // not already way out of range) get the extra scan.
    const references = byStudent.get(studentId);
    if (references && references.length > 1 && nearest < prune) {
      for (const reference of references) {
        const normalized = normalizeVector(reference.descriptor);
        if (!normalized) continue;
        const d = distance(query, normalized);
        if (d < nearest) {
          nearest = d;
          referenceId = reference.referenceId;
        }
      }
    }
    ranked.push({ studentId, distance: nearest, referenceId });
  }
  return ranked.sort((a, b) => a.distance - b.distance);
}

// Euclidean distance over two descriptor-like arrays (client-side twin of the
// server helper, so the pages do not need face-api for plain math).
export function euclideanDistance(a, b) {
  let sum = 0;
  const length = Math.min(a?.length || 0, b?.length || 0);
  for (let index = 0; index < length; index += 1) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

// True when `value` is inside [minMarginFloor, Infinity) — i.e. the runner-up
// is far enough from the winner. Kept here so client and server policy stay in
// one shape.
export function marginOk(bestDistance, secondDistance, minMargin) {
  if (!Number.isFinite(bestDistance)) return false;
  if (!Number.isFinite(secondDistance)) return true;
  return secondDistance - bestDistance > minMargin;
}

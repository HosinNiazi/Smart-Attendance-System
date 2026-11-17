import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatcherData,
  marginOk,
  matchDescriptor,
  normalizeVector,
} from "../../src/face/matching.js";

// Deterministic fake distance: 1 - overlap of the first coordinate. Not a real
// metric, but consistent enough to test ranking and pruning behaviour.
const distance = (a, b) => Math.abs(a[0] - b[0]);

const vector = (value) => {
  const out = new Float32Array(128);
  out[0] = value;
  out[1] = Math.sqrt(1 - value * value); // keep the norm ≈ 1
  return out;
};

test("normalizeVector rejects bad shapes and returns a unit vector", () => {
  assert.equal(normalizeVector(null), null);
  assert.equal(normalizeVector([1, 2, 3]), null);
  const bad = vector(0.5);
  bad[5] = Number.NaN;
  assert.equal(normalizeVector(bad), null);
  const ok = normalizeVector([2, ...Array(127).fill(0)]);
  assert.equal(ok.length, 128);
  assert.ok(Math.abs(1 - ok.reduce((sum, v) => sum + v * v, 0)) < 1e-6);
});

test("buildMatcherData averages references into a centroid", () => {
  const { centroids, byStudent } = buildMatcherData([
    { studentId: "s1", referenceId: "r1", descriptor: vector(0.2) },
    { studentId: "s1", referenceId: "r2", descriptor: vector(0.4) },
    { studentId: "s2", referenceId: "r3", descriptor: vector(0.9) },
  ]);
  assert.equal(centroids.size, 2);
  assert.equal(byStudent.get("s1").length, 2);
  const centroid = centroids.get("s1");
  assert.ok(centroid[0] > 0.29 && centroid[0] < 0.31);
});

test("matchDescriptor ranks students and keeps the closest reference id", () => {
  const data = buildMatcherData([
    { studentId: "s1", referenceId: "r1", descriptor: vector(0.2) },
    { studentId: "s1", referenceId: "r2", descriptor: vector(0.3) },
    { studentId: "s2", referenceId: "r3", descriptor: vector(0.9) },
  ]);
  const ranked = matchDescriptor(vector(0.31), data, distance);
  assert.equal(ranked[0].studentId, "s1");
  // The single reference r2 is closer than the centroid, and its id is kept.
  assert.equal(ranked[0].referenceId, "r2");
  assert.ok(ranked[0].distance < ranked[1].distance);
  assert.equal(ranked[1].studentId, "s2");
});

test("matchDescriptor prunes per-reference scans for far centroids", () => {
  const data = buildMatcherData([
    { studentId: "s1", referenceId: "r1", descriptor: vector(0.05) },
    { studentId: "s1", referenceId: "r2", descriptor: vector(0.95) },
  ]);
  const query = vector(0.94);
  const ranked = matchDescriptor(query, data, distance, { prune: 0.1 });
  // The centroid is far out of range, so r2 (which would match well) was
  // skipped and the reported distance stays at the centroid distance.
  assert.ok(ranked[0].distance > 0.3);
  assert.equal(ranked[0].referenceId, null);
});

test("matchDescriptor returns an empty ranking for unusable input", () => {
  assert.deepEqual(matchDescriptor(null, buildMatcherData([]), distance), []);
  const data = buildMatcherData([{ studentId: "s1", descriptor: vector(0.2) }]);
  const bad = new Float32Array(128);
  bad[0] = Number.NaN;
  assert.deepEqual(matchDescriptor(bad, data, distance), []);
});

test("marginOk mirrors the runner-up rule", () => {
  assert.equal(marginOk(0.3, Infinity, 0.035), true);
  assert.equal(marginOk(0.3, 0.31, 0.035), false);
  assert.equal(marginOk(0.3, 0.33, 0.035), false);
  assert.equal(marginOk(0.3, 0.34, 0.035), true);
  assert.equal(marginOk(0.3, 0.34, 0.05), false);
});

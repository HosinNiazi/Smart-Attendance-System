import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceTracking,
  boxIou,
  createTrackingState,
  hasStableVotes,
  recordTrackVote,
  trackVoteCount,
} from "../../src/face/tracking.js";

const box = (x, y, width = 100, height = 100) => ({ x, y, width, height });

test("boxIou measures overlap and ignores disjoint boxes", () => {
  assert.equal(boxIou(box(0, 0), box(0, 0)), 1);
  assert.equal(boxIou(box(0, 0), box(500, 500)), 0);
  const partial = boxIou(box(0, 0), box(50, 0));
  assert.ok(partial > 0 && partial < 1, String(partial));
});

test("advanceTracking keeps the same id for a moving face", () => {
  const state = createTrackingState();
  const first = advanceTracking(state, [box(0, 0)], 0);
  const id = first.faces[0].trackId;
  const second = advanceTracking(state, [box(10, 5)], 100);
  assert.equal(second.faces[0].trackId, id);
});

test("advanceTracking creates new ids for separate faces", () => {
  const state = createTrackingState();
  const result = advanceTracking(state, [box(0, 0), box(400, 0)], 0);
  assert.notEqual(result.faces[0].trackId, result.faces[1].trackId);
});

test("stale tracks expire and are replaced", () => {
  const state = createTrackingState();
  const first = advanceTracking(state, [box(0, 0)], 0, { ttlMs: 100 });
  const firstId = first.faces[0].trackId;
  const later = advanceTracking(state, [box(0, 0)], 500, { ttlMs: 100 });
  assert.notEqual(later.faces[0].trackId, firstId);
  assert.equal(state.tracks.length, 1);
});

test("votes accumulate and count only the target student", () => {
  const state = createTrackingState();
  const { faces } = advanceTracking(state, [box(0, 0)], 0);
  const trackId = faces[0].trackId;
  assert.equal(recordTrackVote(state, trackId, "s1"), 1);
  assert.equal(recordTrackVote(state, trackId, "s1"), 2);
  assert.equal(recordTrackVote(state, trackId, "s2"), 1);
  assert.equal(trackVoteCount(state, trackId, "s1"), 2);
  assert.equal(trackVoteCount(state, trackId, "s2"), 1);
});

test("the vote window is bounded", () => {
  const state = createTrackingState();
  const { faces } = advanceTracking(state, [box(0, 0)], 0);
  const trackId = faces[0].trackId;
  for (let index = 0; index < 10; index += 1) {
    recordTrackVote(state, trackId, "s1", { window: 3 });
  }
  assert.equal(trackVoteCount(state, trackId, "s1", { window: 3 }), 3);
});

test("hasStableVotes rejects a track that flaps between students", () => {
  const state = createTrackingState();
  const { faces } = advanceTracking(state, [box(0, 0)], 0);
  const trackId = faces[0].trackId;
  recordTrackVote(state, trackId, "s1");
  recordTrackVote(state, trackId, "s2");
  recordTrackVote(state, trackId, "s1");
  assert.equal(hasStableVotes(state, trackId, "s1", 3), false);
  recordTrackVote(state, trackId, "s1");
  recordTrackVote(state, trackId, "s1");
  assert.equal(hasStableVotes(state, trackId, "s1", 3), true);
});

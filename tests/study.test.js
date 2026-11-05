import assert from "node:assert/strict";
import test from "node:test";
import { daypart } from "../src/daypart.js";
import { studyActivity, studyPhase } from "../src/study.js";

test("the day is split into four soft light periods", () => {
  assert.equal(daypart(new Date(2026, 10, 5, 8, 0)), "morning");
  assert.equal(daypart(new Date(2026, 10, 5, 13, 0)), "midday");
  assert.equal(daypart(new Date(2026, 10, 5, 18, 0)), "evening");
  assert.equal(daypart(new Date(2026, 10, 5, 22, 30)), "night");
});

test("each look has one quiet study activity", () => {
  assert.equal(studyActivity("pebbles"), "notebook");
  assert.equal(studyActivity("moss"), "laptop");
  assert.equal(studyActivity("brick"), "phone");
  assert.equal(studyActivity("sun"), "books");
});

test("a long sit without a tap becomes a short snooze, then studying again", () => {
  const sat = 0;
  assert.equal(studyPhase(sat, 0, 10_000, 90_000, 14_000), "study");
  assert.equal(studyPhase(sat, 0, 100_000, 90_000, 14_000), "snooze");
  assert.equal(studyPhase(sat, 0, 110_000, 90_000, 14_000), "study");
  assert.equal(studyPhase(sat, 95_000, 100_000, 90_000, 14_000), "study");
});

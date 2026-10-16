import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDigitOk, cleanTracking, formatTracking, isTrackingFormat, trackingProblem } from "./classify.ts";

test("cleans spaces and case", () => {
  assert.equal(cleanTracking(" rl 7827 3725 8ie "), "RL782737258IE");
});

test("fixes letters misread as digits in the middle only", () => {
  assert.equal(cleanTracking("RL 78O7 3725 8IE"), "RL780737258IE");
  assert.equal(cleanTracking("LL 1234 5678 9IE"), "LL123456789IE");
});

test("accepts every two-letter prefix", () => {
  for (const t of ["RL782737258IE", "LL123456789IE", "CN123456789IE", "LR123456789IE"]) {
    assert.equal(isTrackingFormat(t), true, t);
  }
  assert.equal(isTrackingFormat("RL12345678IE"), false);
  assert.equal(isTrackingFormat("R1123456789IE"), false);
});

test("check digit: real label passes, one wrong digit fails", () => {
  assert.equal(checkDigitOk("RL782737258IE"), true);
  assert.equal(checkDigitOk("RL782737268IE"), false);
  // 10 -> 0 and 11 -> 5 cases
  assert.equal(checkDigitOk("RR000000005IE"), true); // sum 0 -> 11 -> 5
});

test("problems are explained", () => {
  assert.equal(trackingProblem("RL782737258IE"), null);
  assert.match(trackingProblem("")!, /No tracking/);
  assert.match(trackingProblem("RL123IE")!, /2 letters, 9 digits/);
  assert.match(trackingProblem("RL782737268IE")!, /check-digit/);
});

test("formats like the label", () => {
  assert.equal(formatTracking("RL782737258IE"), "RL 7827 3725 8IE");
});

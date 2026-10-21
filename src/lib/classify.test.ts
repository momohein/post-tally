import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, cleanTracking, s10CheckOk } from "./classify.ts";

test("cleans spaces and case", () => {
  assert.equal(cleanTracking(" rr 123-456-789 ie "), "RR123456789IE");
});

test("classifies by S10 prefix", () => {
  assert.equal(classify("RR123456789IE"), "registered");
  assert.equal(classify("EE123456789IE"), "express");
  assert.equal(classify("CP123456789IE"), "parcel");
  assert.equal(classify("VA123456789IE"), "parcel");
  assert.equal(classify("LL 2766 4606 9IE"), "express"); // An Post Express Post label
});

test("returns null for unknown or malformed numbers", () => {
  assert.equal(classify("UX123456789IE"), null);
  assert.equal(classify("RR12345IE"), null);
  assert.equal(classify(""), null);
  assert.equal(classify(null), null);
});

test("S10 check digit", () => {
  // Real numbers from an An Post certificate of posting.
  for (const t of ["LL 2766 4606 9IE", "RL 0637 9041 5IE", "RL063790407IE", "RL063790398IE", "RL063790384IE", "RL063790866IE"]) {
    assert.equal(s10CheckOk(t), true, t);
  }
  assert.equal(s10CheckOk("RL063790416IE"), false); // last digit misread
  assert.equal(s10CheckOk("RL063790415"), false); // not S10
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAppUrl } from "../src/config.js";

test("normalizes app url for invite links", () => {
  assert.equal(normalizeAppUrl("https://fairpay.yk-projects.com/"), "https://fairpay.yk-projects.com");
  assert.equal(normalizeAppUrl("https://http://192.168.1.213:3000/"), "http://192.168.1.213:3000");
});

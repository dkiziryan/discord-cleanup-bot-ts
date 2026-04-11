import test from "node:test";
import assert from "node:assert/strict";

import { resolveScanChannelConcurrency } from "../../utils/scanConcurrency";

test("resolveScanChannelConcurrency defaults to three channels", () => {
  assert.equal(resolveScanChannelConcurrency(undefined), 3);
});

test("resolveScanChannelConcurrency allows five channels", () => {
  assert.equal(resolveScanChannelConcurrency("5"), 5);
});

test("resolveScanChannelConcurrency caps values above five", () => {
  assert.equal(resolveScanChannelConcurrency("10"), 5);
});

test("resolveScanChannelConcurrency ignores invalid values", () => {
  assert.equal(resolveScanChannelConcurrency("abc"), 3);
});

#!/usr/bin/env node
// scripts/test-extract-publish-proofs.js
//
// Standalone test for extractPublishProofs().
// Run with: node scripts/test-extract-publish-proofs.js
// No Hardhat, Firestore, or network required.

"use strict";

// ---- Copy of extractPublishProofs from worker-launch-events-to-chain.js ----
// Kept in sync manually. Uses the same status === "success" filter as the worker.

function extractPublishProofs(platformsArr) {
  if (!Array.isArray(platformsArr)) return [];
  return platformsArr
    .filter(
      (p) =>
        p &&
        p.status === "success" &&
        typeof p.published_id === "string" &&
        p.published_id.trim().length > 0
    )
    .map((p) => ({
      platform: p.platform,
      published_id: p.published_id.trim(),
    }));
}

// ---- Test harness ----

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- Test cases ----

console.log("Case A: YT/IG/FB success with published_id → all included");
{
  const platforms = [
    { platform: "youtube", status: "success", published_id: "dQw4w9WgXcQ" },
    { platform: "instagram", status: "success", published_id: "18043252123456789" },
    { platform: "facebook", status: "success", published_id: "987654321" },
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 3, "returns 3 proofs");
  assert(result[0].platform === "youtube", "first is youtube");
  assert(result[0].published_id === "dQw4w9WgXcQ", "youtube published_id correct");
  assert(result[1].platform === "instagram", "second is instagram");
  assert(result[2].platform === "facebook", "third is facebook");
}

console.log("\nCase B: TikTok success but published_id is null → excluded");
{
  const platforms = [
    { platform: "youtube", status: "success", published_id: "abc123" },
    { platform: "tiktok", status: "success", published_id: null },
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 1, "returns 1 proof (tiktok excluded)");
  assert(result[0].platform === "youtube", "only youtube included");
}

console.log("\nCase C: TikTok success but published_id is empty string → excluded");
{
  const platforms = [
    { platform: "tiktok", status: "success", published_id: "" },
    { platform: "youtube", status: "success", published_id: "xyz" },
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 1, "returns 1 proof (empty string excluded)");
  assert(result[0].platform === "youtube", "only youtube included");
}

console.log("\nCase D: LinkedIn FAILED with error_code=UNKNOWN_OUTCOME → excluded");
{
  const platforms = [
    { platform: "linkedin", status: "failed", published_id: null, error_code: "UNKNOWN_OUTCOME" },
    { platform: "youtube", status: "success", published_id: "vid123" },
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 1, "returns 1 proof (failed excluded)");
  assert(result[0].platform === "youtube", "only youtube included");
}

console.log("\nCase E: Empty platforms array → returns []");
{
  const result = extractPublishProofs([]);
  assert(result.length === 0, "returns empty array");
}

console.log("\nCase F: Non-array platforms → returns []");
{
  assert(extractPublishProofs(null).length === 0, "null → []");
  assert(extractPublishProofs(undefined).length === 0, "undefined → []");
  assert(extractPublishProofs("not_array").length === 0, "string → []");
  assert(extractPublishProofs(42).length === 0, "number → []");
}

console.log("\nCase G: Whitespace-only published_id → excluded");
{
  const platforms = [
    { platform: "tiktok", status: "success", published_id: "   " },
    { platform: "youtube", status: "success", published_id: " abc123 " },
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 1, "whitespace-only excluded");
  assert(result[0].published_id === "abc123", "published_id is trimmed");
}

console.log("\nCase H: published_id missing entirely → excluded");
{
  const platforms = [
    { platform: "tiktok", status: "success" },
    { platform: "youtube", status: "success", published_id: "vid" },
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 1, "missing field excluded");
  assert(result[0].platform === "youtube", "only youtube included");
}

console.log("\nCase I: Null entry in platforms array → skipped safely");
{
  const platforms = [
    null,
    { platform: "youtube", status: "success", published_id: "vid" },
    undefined,
  ];
  const result = extractPublishProofs(platforms);
  assert(result.length === 1, "null entries skipped");
  assert(result[0].platform === "youtube", "youtube included");
}

// ---- Summary ----
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed.");
}

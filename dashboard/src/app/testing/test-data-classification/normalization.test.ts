import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractPayloadSourceFile,
  normalizeClassificationView,
  normalizeMatchGroups
} from "./normalization.ts";

const regressionFixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/classification-regression.fixture.json", import.meta.url), "utf8")
) as unknown;

test("normalizeMatchGroups handles object matches with null", () => {
  const groups = normalizeMatchGroups({ T7654321: null });
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.primaryMatch, "T7654321");
  assert.deepEqual(groups[0]?.supportingMatches, []);
});

test("normalizeMatchGroups handles object matches with string", () => {
  const groups = normalizeMatchGroups({ T7654321: "PASSPORT" });
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.primaryMatch, "T7654321");
  assert.deepEqual(groups[0]?.supportingMatches, ["PASSPORT"]);
});

test("normalizeMatchGroups handles object matches with string array", () => {
  const groups = normalizeMatchGroups({
    T7654321: ["DOCUMENT No", "Date of issue", "Date of expiry"]
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.primaryMatch, "T7654321");
  assert.deepEqual(groups[0]?.supportingMatches, ["DOCUMENT No", "Date of issue", "Date of expiry"]);
});

test("normalizeMatchGroups handles array of single-entry objects with null values", () => {
  const groups = normalizeMatchGroups([
    { "Sample Health Hub": null },
    { "Example Gardens": null },
    { "Testville NSW": null },
    { "JORDAN EXAMPLE": null },
    { "CASEY SAMPLE": null }
  ]);

  assert.deepEqual(
    groups.map((group) => group.primaryMatch),
    [
      "Sample Health Hub",
      "Example Gardens",
      "Testville NSW",
      "JORDAN EXAMPLE",
      "CASEY SAMPLE"
    ]
  );
  assert.deepEqual(groups.map((group) => group.supportingMatches), [[], [], [], [], []]);
});

test("extractPayloadSourceFile prefers payload source file hierarchy", () => {
  const value = extractPayloadSourceFile({
    SourceFile: "exact-uploaded-name.png",
    DataClassification: { SourceFile: "nested-name.png" },
    Streams: { SourceFile: "stream-name.png" }
  });

  assert.equal(value, "exact-uploaded-name.png");
});

test("normalizeClassificationView aggregates summary across all classification results", () => {
  const normalized = normalizeClassificationView({
    result: regressionFixture,
    workerFileName: "wrong-derived-filename.png",
    fallbackSourceFileName: "fallback.txt"
  });

  assert.equal(normalized.sourceFileName, "classification-regression-sample.png");
  assert.equal(normalized.summary.totalClassificationResults, 22);
  assert.equal(normalized.summary.totalReportedMatchCount, 34);
  assert.equal(normalized.summary.uniqueClassificationNames, 9);
  assert.equal(normalized.summary.confidenceTierCount, 3);
  assert.equal(normalized.summary.renderedMatchGroups, 34);
});

test("regression: All Full Names uses real primary values and never synthetic item labels", () => {
  const normalized = normalizeClassificationView({ result: regressionFixture });

  const fullNames65 = normalized.results.find(
    (result) => result.classificationName === "All Full Names" && result.confidenceLevel === 65
  );

  assert.ok(fullNames65);
  assert.deepEqual(
    fullNames65.matchGroups.map((group) => group.primaryMatch),
    [
      "Sample Health Hub",
      "Example Gardens",
      "Testville NSW",
      "JORDAN EXAMPLE",
      "CASEY SAMPLE"
    ]
  );
  assert.ok(!fullNames65.matchGroups.some((group) => /^item\d+$/i.test(group.primaryMatch)));
});

test("regression: EU Passport Number separates primary and supporting matches", () => {
  const normalized = normalizeClassificationView({ result: regressionFixture });

  const eu65 = normalized.results.find(
    (result) => result.classificationName === "EU Passport Number" && result.confidenceLevel === 65
  );

  assert.ok(eu65);
  assert.equal(eu65.matchGroups.length, 1);
  assert.equal(eu65.matchGroups[0]?.primaryMatch, "T7654321");
  assert.deepEqual(eu65.matchGroups[0]?.supportingMatches, [
    "DOCUMENT No",
    "Date of issue",
    "Date of expiry"
  ]);
});

test("normalizeMatchGroups warns but degrades gracefully for unknown shapes", () => {
  const warnings: string[] = [];
  const groups = normalizeMatchGroups(
    [{ key: "value", extra: true }],
    { warn: (message) => warnings.push(message) }
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.primaryMatch, "Entry 1");
  assert.ok(warnings.length > 0);
});

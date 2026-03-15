import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { importRulePackageFromXml, validateRulePackage } from "./sit-rule-package.js";

const customRulePackPath = new URL("../Microsoft.SCCManaged.CustomRulePack_20260314_1011.xml", import.meta.url);
const microsoftFixturePath = new URL("./__fixtures__/microsoft-rule-package-sample.xml", import.meta.url);
const customFixturePath = new URL("./__fixtures__/custom-rule-package-sample.xml", import.meta.url);
const microsoftExpectedPath = new URL("./__fixtures__/microsoft-rule-package-expected.json", import.meta.url);
const customExpectedPath = new URL("./__fixtures__/custom-rule-package-expected.json", import.meta.url);
const hasLocalCustomRulePack = fs.existsSync(customRulePackPath);

function readJson(url) {
  return JSON.parse(fs.readFileSync(url, "utf8"));
}

function readUtf16(url) {
  return fs.readFileSync(url, "utf16le");
}

test("imports Microsoft rule package sample with resolved primary and supporting details", () => {
  const xml = fs.readFileSync(microsoftFixturePath, "utf8");
  const expected = readJson(microsoftExpectedPath);

  const imported = importRulePackageFromXml(xml);
  const sit = imported.importResult.sits[0];

  assert.equal(imported.importResult.package.name, expected.packageName);
  assert.equal(sit.name, expected.sitName);
  assert.equal(sit.primaryElement?.displayName, expected.primaryDisplayName);
  assert.equal(sit.primaryElement?.actual.regex, expected.primaryRegex);
  assert.equal(sit.supportingElements[0]?.displayName, expected.supportingDisplayName);
  assert.deepEqual(sit.supportingElements[0]?.actual.keywords, expected.supportingKeywords);
});

test("imports custom rule package sample with deterministic canonical ordering", () => {
  const xml = fs.readFileSync(customFixturePath, "utf8");
  const expected = readJson(customExpectedPath);

  const first = importRulePackageFromXml(xml);
  const second = importRulePackageFromXml(xml);
  const sit = first.importResult.sits[0];

  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.importResult, second.importResult);
  assert.equal(first.importResult.package.name, expected.packageName);
  assert.equal(sit.name, expected.sitName);
  assert.equal(sit.primaryElement?.actual.regex, expected.primaryRegex);
  assert.deepEqual(sit.supportingElements[0]?.actual.keywords, expected.supportingKeywords);
});

test(
  "imports Purview Get-DlpSensitiveInformationTypeRulePackage exports with root-level Rules",
  { skip: !hasLocalCustomRulePack },
  () => {
  const xml = readUtf16(customRulePackPath);

  const imported = importRulePackageFromXml(xml);
  const validation = validateRulePackage(imported.rulePackage);

  assert.ok(imported.rulePackage.entities.length > 0);
  assert.equal(validation.issues.some((issue) => issue.code === "missing_entities"), false);
  assert.equal(imported.rulePackage.entities[0].name.length > 0, true);
  assert.equal(imported.rulePackage.processors.regexes.length > 0, true);
  assert.equal(imported.rulePackage.processors.keywords.length > 0, true);
  assert.ok(imported.importResult.sits.length > 0);
  assert.ok(imported.importResult.sits[0].primaryElement);
  }
);

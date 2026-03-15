import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";

const RULE_PACKAGE_SCHEMA = "sico-sit-rule-package/v1";
const CANONICAL_RULE_PACKAGE_SCHEMA = "sico-canonical-rule-package/v1";
const IMPORT_RESULT_SCHEMA = "sico-sit-import-result/v1";
const DEFAULT_LANG = "en-us";
const DEFAULT_CONFIDENCE = 75;
const DEFAULT_PROXIMITY = 300;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIDENCE_LEVELS = [65, 75, 85];
const BUILTIN_FUNCTIONS = [
  { id: "Func_credit_card", description: "Microsoft built-in credit card detector", kind: "function" },
  { id: "Func_date", description: "Microsoft built-in date detector", kind: "function" },
  { id: "Func_ssn", description: "Microsoft built-in SSN detector", kind: "function" },
  { id: "Func_iban", description: "Microsoft built-in IBAN detector", kind: "function" }
];
const VALIDATOR_TYPES = [
  { id: "Checksum", description: "Checksum validator" },
  { id: "DateSimple", description: "Simple date validator" }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  processEntities: true
});

function randomGuid() {
  return crypto.randomUUID();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureArrayValue(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeTerm(value) {
  return ensureString(value).trim().replace(/\s+/g, " ");
}

function normalizeXmlString(value) {
  let xml = ensureString(value);
  if (xml.length === 0) {
    return "";
  }

  xml = xml.replace(/^\uFEFF/, "");
  if (xml.includes("\u0000")) {
    xml = xml.replace(/\u0000/g, "");
  }

  return xml.replace(/\r\n?/g, "\n").trim();
}

function toNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string" && value.trim().toLowerCase() === "unlimited") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function normalizeVersion(value) {
  if (value && typeof value === "object") {
    return {
      major: toPositiveInteger(value.major, 1),
      minor: Math.max(0, Number(value.minor ?? 0) || 0),
      build: Math.max(0, Number(value.build ?? 0) || 0),
      revision: Math.max(0, Number(value.revision ?? 0) || 0)
    };
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const [major = "1", minor = "0", build = "0", revision = "0"] = value.trim().split(".");
    return {
      major: toPositiveInteger(major, 1),
      minor: Math.max(0, Number(minor) || 0),
      build: Math.max(0, Number(build) || 0),
      revision: Math.max(0, Number(revision) || 0)
    };
  }

  return {
    major: 1,
    minor: 0,
    build: 0,
    revision: 0
  };
}

function versionToString(version) {
  return `${version.major}.${version.minor}.${version.build}.${version.revision}`;
}

function compareStrings(a, b) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function uniqueSortedStrings(values) {
  return [...new Set(values.map((value) => normalizeTerm(value)).filter(Boolean))].sort(compareStrings);
}

function normalizeMatchRef(value, index = 0) {
  return {
    refId: ensureString(value?.refId, "").trim(),
    refType: ensureString(value?.refType, "regex").trim() || "regex",
    minCount: Math.max(1, Number(value?.minCount ?? 1) || 1),
    uniqueResults: value?.uniqueResults === true,
    order: Math.max(0, Number(value?.order ?? index) || index)
  };
}

function normalizeSupportClause(value, index = 0) {
  if (value?.type === "any") {
    return {
      type: "any",
      minMatches: Math.max(1, Number(value?.minMatches ?? 1) || 1),
      maxMatches:
        value?.maxMatches === null || value?.maxMatches === undefined || value?.maxMatches === ""
          ? null
          : Math.max(1, Number(value.maxMatches) || 1),
      children: ensureArray(value?.children)
        .map((child, childIndex) => normalizeMatchRef(child, childIndex))
        .sort((a, b) => a.order - b.order || compareStrings(a.refId, b.refId)),
      order: Math.max(0, Number(value?.order ?? index) || index)
    };
  }

  return {
    type: "match",
    match: normalizeMatchRef(value?.match ?? value, index),
    order: Math.max(0, Number(value?.order ?? index) || index)
  };
}

function normalizePattern(value, index = 0) {
  const confidenceLevel = Number(value?.confidenceLevel ?? DEFAULT_CONFIDENCE) || DEFAULT_CONFIDENCE;
  return {
    id: ensureString(value?.id, "").trim() || `pattern-${index + 1}`,
    name: ensureString(value?.name, "").trim() || `Pattern ${index + 1}`,
    confidenceLevel: CONFIDENCE_LEVELS.includes(confidenceLevel) ? confidenceLevel : DEFAULT_CONFIDENCE,
    primary: {
      refId: ensureString(value?.primary?.refId, "").trim(),
      refType: ensureString(value?.primary?.refType, "regex").trim() || "regex"
    },
    supporting: ensureArray(value?.supporting)
      .map((item, clauseIndex) => normalizeSupportClause(item, clauseIndex))
      .sort((a, b) => a.order - b.order),
    order: Math.max(0, Number(value?.order ?? index) || index),
    advancedFlags: value?.advancedFlags && typeof value.advancedFlags === "object" ? value.advancedFlags : {}
  };
}

function normalizeEntity(value, index = 0) {
  return {
    id: ensureString(value?.id, "").trim() || randomGuid(),
    name: normalizeTerm(value?.name) || `Sensitive Info Type ${index + 1}`,
    description: ensureString(value?.description, "").trim(),
    patternsProximity: toPositiveInteger(value?.patternsProximity, DEFAULT_PROXIMITY),
    recommendedConfidence: Math.max(0, Math.min(100, Number(value?.recommendedConfidence ?? DEFAULT_CONFIDENCE) || DEFAULT_CONFIDENCE)),
    workload: ensureString(value?.workload, "").trim(),
    order: Math.max(0, Number(value?.order ?? index) || index),
    source: ensureString(value?.source, "sico").trim() || "sico",
    patterns: ensureArray(value?.patterns)
      .map((pattern, patternIndex) => normalizePattern(pattern, patternIndex))
      .sort((a, b) => a.order - b.order || compareStrings(a.name, b.name))
  };
}

function normalizeRegex(value) {
  return {
    id: ensureString(value?.id, "").trim(),
    pattern: ensureString(value?.pattern, "").trim(),
    validators: uniqueSortedStrings(ensureArray(value?.validators)),
    description: ensureString(value?.description, "").trim()
  };
}

function normalizeKeyword(value) {
  return {
    id: ensureString(value?.id, "").trim(),
    matchStyle: ensureString(value?.matchStyle, "word").trim() || "word",
    terms: uniqueSortedStrings(ensureArray(value?.terms)),
    description: ensureString(value?.description, "").trim()
  };
}

function normalizeValidator(value) {
  const parameters = ensureArray(value?.parameters)
    .map((parameter) => ({
      name: ensureString(parameter?.name, "").trim(),
      value: ensureString(parameter?.value, "").trim()
    }))
    .filter((parameter) => parameter.name.length > 0)
    .sort((a, b) => compareStrings(a.name, b.name));

  return {
    id: ensureString(value?.id, "").trim(),
    type: ensureString(value?.type, "Checksum").trim() || "Checksum",
    parameters,
    description: ensureString(value?.description, "").trim()
  };
}

function normalizeProcessorSet(value) {
  return {
    regexes: ensureArray(value?.regexes)
      .map(normalizeRegex)
      .filter((item) => item.id.length > 0)
      .sort((a, b) => compareStrings(a.id, b.id)),
    keywords: ensureArray(value?.keywords)
      .map(normalizeKeyword)
      .filter((item) => item.id.length > 0)
      .sort((a, b) => compareStrings(a.id, b.id)),
    validators: ensureArray(value?.validators)
      .map(normalizeValidator)
      .filter((item) => item.id.length > 0)
      .sort((a, b) => compareStrings(a.id, b.id)),
    functions: BUILTIN_FUNCTIONS,
    fingerprints: [],
    extendedKeywords: []
  };
}

export function createDefaultRulePackage() {
  return normalizeRulePackage({
    schemaVersion: RULE_PACKAGE_SCHEMA,
    id: randomGuid(),
    version: { major: 1, minor: 0, build: 0, revision: 0 },
    publisherId: randomGuid(),
    defaultLangCode: DEFAULT_LANG,
    details: {
      publisherName: "SICO",
      name: "New SIT Rule Package",
      description: "Purview-aligned SIT rule package draft created in SICO."
    },
    entities: [
      {
        id: randomGuid(),
        name: "New Sensitive Information Type",
        description: "Describe the detector purpose and expected evidence model.",
        patternsProximity: DEFAULT_PROXIMITY,
        recommendedConfidence: DEFAULT_CONFIDENCE,
        patterns: [
          {
            id: "pattern-1",
            name: "Pattern 1",
            confidenceLevel: DEFAULT_CONFIDENCE,
            primary: {
              refId: "Regex.PrimaryIdentifier",
              refType: "regex"
            },
            supporting: [
              {
                type: "match",
                match: {
                  refId: "Keyword.ContextTerms",
                  refType: "keyword",
                  minCount: 1,
                  uniqueResults: false
                }
              }
            ]
          }
        ]
      }
    ],
    processors: {
      regexes: [
        {
          id: "Regex.PrimaryIdentifier",
          pattern: "\\b[0-9]{6,12}\\b",
          validators: [],
          description: "Primary identifier pattern"
        }
      ],
      keywords: [
        {
          id: "Keyword.ContextTerms",
          matchStyle: "word",
          terms: ["account", "identifier", "reference"],
          description: "Supporting context keywords"
        }
      ],
      validators: []
    }
  });
}

export function normalizeRulePackage(value) {
  const normalized = {
    schemaVersion: RULE_PACKAGE_SCHEMA,
    id: ensureString(value?.id, "").trim() || randomGuid(),
    version: normalizeVersion(value?.version),
    publisherId: ensureString(value?.publisherId, "").trim() || randomGuid(),
    defaultLangCode: ensureString(value?.defaultLangCode, DEFAULT_LANG).trim() || DEFAULT_LANG,
    details: {
      publisherName: ensureString(value?.details?.publisherName, "SICO").trim() || "SICO",
      name: ensureString(value?.details?.name, "New SIT Rule Package").trim() || "New SIT Rule Package",
      description: ensureString(value?.details?.description, "").trim()
    },
    entities: ensureArray(value?.entities)
      .map((entity, index) => normalizeEntity(entity, index))
      .sort((a, b) => a.order - b.order || compareStrings(a.name, b.name)),
    processors: normalizeProcessorSet(value?.processors),
    affinities: [],
    rawUnknown: ensureArray(value?.rawUnknown),
    metadata: value?.metadata && typeof value.metadata === "object" ? clone(value.metadata) : {}
  };

  return normalized;
}

export function getSitBuilderCatalog() {
  return {
    schemaVersion: RULE_PACKAGE_SCHEMA,
    confidenceLevels: CONFIDENCE_LEVELS,
    builtinFunctions: clone(BUILTIN_FUNCTIONS),
    validatorTypes: clone(VALIDATOR_TYPES),
    defaultLangCode: DEFAULT_LANG,
    defaultProximity: DEFAULT_PROXIMITY
  };
}

export function validateRulePackage(value) {
  const rulePackage = normalizeRulePackage(value);
  const issues = [];
  const regexIds = new Set(rulePackage.processors.regexes.map((item) => item.id));
  const keywordIds = new Set(rulePackage.processors.keywords.map((item) => item.id));
  const validatorIds = new Set(rulePackage.processors.validators.map((item) => item.id));
  const functionIds = new Set(BUILTIN_FUNCTIONS.map((item) => item.id));
  const entityIds = new Set();

  const allProcessorRefs = new Set([...regexIds, ...keywordIds, ...functionIds]);

  function pushIssue(level, path, code, message) {
    issues.push({ level, path, code, message });
  }

  if (!GUID_RE.test(rulePackage.id)) {
    pushIssue("error", "rulePackage.id", "invalid_guid", "Rule package id must be a valid GUID.");
  }
  if (!GUID_RE.test(rulePackage.publisherId)) {
    pushIssue("error", "rulePackage.publisherId", "invalid_guid", "Publisher id must be a valid GUID.");
  }
  if (rulePackage.details.name.length === 0) {
    pushIssue("error", "rulePackage.details.name", "missing_name", "Package name is required.");
  }
  if (rulePackage.entities.length === 0) {
    pushIssue("error", "rulePackage.entities", "missing_entities", "At least one sensitive information type is required.");
  }

  for (const regex of rulePackage.processors.regexes) {
    if (regex.pattern.length === 0) {
      pushIssue("error", `processors.regexes.${regex.id}`, "missing_pattern", `Regex '${regex.id}' must include a pattern.`);
    }
    for (const validatorId of regex.validators) {
      if (!validatorIds.has(validatorId) && !functionIds.has(validatorId)) {
        pushIssue(
          "warning",
          `processors.regexes.${regex.id}.validators`,
          "unknown_validator",
          `Regex '${regex.id}' references unknown validator '${validatorId}'.`
        );
      }
    }
  }

  for (const keyword of rulePackage.processors.keywords) {
    if (keyword.terms.length === 0) {
      pushIssue("warning", `processors.keywords.${keyword.id}`, "empty_terms", `Keyword '${keyword.id}' has no terms.`);
    }
  }

  for (const entity of rulePackage.entities) {
    if (entityIds.has(entity.id)) {
      pushIssue("error", `entities.${entity.name}`, "duplicate_entity_id", `Entity id '${entity.id}' is duplicated.`);
    }
    entityIds.add(entity.id);

    if (!GUID_RE.test(entity.id)) {
      pushIssue("error", `entities.${entity.name}.id`, "invalid_guid", `Entity '${entity.name}' must have a valid GUID.`);
    }
    if (entity.name.length === 0) {
      pushIssue("error", `entities.${entity.id}.name`, "missing_name", "Entity name is required.");
    }
    if (entity.patterns.length === 0) {
      pushIssue("error", `entities.${entity.name}.patterns`, "missing_patterns", `Entity '${entity.name}' must contain at least one pattern.`);
    }

    const confidenceLevels = new Set();
    for (const pattern of entity.patterns) {
      if (confidenceLevels.has(pattern.confidenceLevel)) {
        pushIssue(
          "warning",
          `entities.${entity.name}.patterns.${pattern.name}`,
          "duplicate_confidence_level",
          `Entity '${entity.name}' has multiple patterns with confidence ${pattern.confidenceLevel}.`
        );
      }
      confidenceLevels.add(pattern.confidenceLevel);

      if (!pattern.primary.refId) {
        pushIssue(
          "error",
          `entities.${entity.name}.patterns.${pattern.name}.primary`,
          "missing_primary_ref",
          `Pattern '${pattern.name}' requires a primary processor reference.`
        );
      } else if (!allProcessorRefs.has(pattern.primary.refId)) {
        pushIssue(
          "error",
          `entities.${entity.name}.patterns.${pattern.name}.primary`,
          "unknown_primary_ref",
          `Pattern '${pattern.name}' references unknown processor '${pattern.primary.refId}'.`
        );
      }

      for (const clause of pattern.supporting) {
        if (clause.type === "match") {
          if (!allProcessorRefs.has(clause.match.refId)) {
            pushIssue(
              "warning",
              `entities.${entity.name}.patterns.${pattern.name}.supporting`,
              "unknown_support_ref",
              `Pattern '${pattern.name}' references unknown supporting processor '${clause.match.refId}'.`
            );
          }
          continue;
        }

        if (clause.children.length === 0) {
          pushIssue(
            "warning",
            `entities.${entity.name}.patterns.${pattern.name}.any`,
            "empty_any_group",
            `Pattern '${pattern.name}' contains an Any group without children.`
          );
        }

        for (const child of clause.children) {
          if (!allProcessorRefs.has(child.refId)) {
            pushIssue(
              "warning",
              `entities.${entity.name}.patterns.${pattern.name}.any`,
              "unknown_support_ref",
              `Pattern '${pattern.name}' references unknown Any-group processor '${child.refId}'.`
            );
          }
        }
      }
    }
  }

  issues.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level === "error" ? -1 : 1;
    }
    return compareStrings(a.path, b.path);
  });

  return {
    rulePackage,
    issues,
    isValid: !issues.some((issue) => issue.level === "error")
  };
}

function xmlEscape(value) {
  return ensureString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ` ${key}="${xmlEscape(String(value))}"`)
    .join("");
}

function renderTag(tagName, attributes = {}, content = "", indent = "  ") {
  const attrs = renderAttributes(attributes);
  if (content.length === 0) {
    return `${indent}<${tagName}${attrs}/>`;
  }
  return `${indent}<${tagName}${attrs}>${content}</${tagName}>`;
}

function renderMultilineTag(tagName, attributes = {}, lines = [], indent = "  ") {
  const attrs = renderAttributes(attributes);
  if (lines.length === 0) {
    return `${indent}<${tagName}${attrs}/>`;
  }
  return `${indent}<${tagName}${attrs}>\n${lines.join("\n")}\n${indent}</${tagName}>`;
}

export function exportRulePackageToXml(value) {
  const { rulePackage } = validateRulePackage(value);

  const localizedDetails = [
    renderTag("PublisherName", {}, xmlEscape(rulePackage.details.publisherName), "        "),
    renderTag("Name", {}, xmlEscape(rulePackage.details.name), "        "),
    renderTag("Description", {}, xmlEscape(rulePackage.details.description), "        ")
  ];

  const entityLines = rulePackage.entities.map((entity) => {
    const patternLines = entity.patterns.map((pattern) => {
      const clauseLines = [
        renderTag("IdMatch", { idRef: pattern.primary.refId }, "", "          "),
        ...pattern.supporting.map((clause) => {
          if (clause.type === "match") {
            return renderTag(
              "Match",
              {
                idRef: clause.match.refId,
                minCount: clause.match.minCount > 1 ? clause.match.minCount : undefined,
                uniqueResults: clause.match.uniqueResults ? "true" : undefined
              },
              "",
              "          "
            );
          }

          return renderMultilineTag(
            "Any",
            {
              minMatches: clause.minMatches,
              maxMatches: clause.maxMatches ?? undefined
            },
            clause.children.map((child) =>
              renderTag(
                "Match",
                {
                  idRef: child.refId,
                  minCount: child.minCount > 1 ? child.minCount : undefined,
                  uniqueResults: child.uniqueResults ? "true" : undefined
                },
                "",
                "            "
              )
            ),
            "          "
          );
        })
      ];

      return renderMultilineTag(
        "Pattern",
        {
          id: pattern.id,
          confidenceLevel: pattern.confidenceLevel,
          name: pattern.name
        },
        clauseLines,
        "        "
      );
    });

    const localizedEntityLines = [
      renderTag("Name", {}, xmlEscape(entity.name), "          "),
      renderTag("Description", {}, xmlEscape(entity.description), "          ")
    ];

    return renderMultilineTag(
      "Entity",
      {
        id: entity.id,
        patternsProximity: entity.patternsProximity,
        recommendedConfidence: entity.recommendedConfidence,
        workload: entity.workload || undefined
      },
      [
        renderMultilineTag("LocalizedStrings", { langcode: rulePackage.defaultLangCode }, localizedEntityLines, "        "),
        renderMultilineTag("Patterns", {}, patternLines, "        ")
      ],
      "      "
    );
  });

  const regexLines = rulePackage.processors.regexes.map((regex) =>
    renderTag(
      "Regex",
      {
        id: regex.id,
        validators: regex.validators.length > 0 ? regex.validators.join(",") : undefined,
        description: regex.description || undefined
      },
      xmlEscape(regex.pattern),
      "      "
    )
  );
  const keywordLines = rulePackage.processors.keywords.map((keyword) =>
    renderMultilineTag(
      "Keyword",
      {
        id: keyword.id,
        matchStyle: keyword.matchStyle,
        description: keyword.description || undefined
      },
      keyword.terms.map((term) => renderTag("Term", {}, xmlEscape(term), "        ")),
      "      "
    )
  );
  const validatorLines = rulePackage.processors.validators.map((validator) =>
    renderMultilineTag(
      "Validators",
      {
        id: validator.id,
        type: validator.type,
        description: validator.description || undefined
      },
      validator.parameters.map((parameter) =>
        renderTag("Param", { name: parameter.name, value: parameter.value }, "", "        ")
      ),
      "      "
    )
  );

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<RulePackage schemaVersion="${RULE_PACKAGE_SCHEMA}">`,
    `  <RulePack id="${xmlEscape(rulePackage.id)}">`,
    `    <Version>${xmlEscape(versionToString(rulePackage.version))}</Version>`,
    `    <Publisher id="${xmlEscape(rulePackage.publisherId)}"/>`,
    renderMultilineTag(
      "Details",
      { defaultLangCode: rulePackage.defaultLangCode },
      [renderMultilineTag("LocalizedDetails", { langcode: rulePackage.defaultLangCode }, localizedDetails, "      ")],
      "    "
    ),
    renderMultilineTag("Rules", {}, entityLines, "    "),
    renderMultilineTag("Regexes", {}, regexLines, "    "),
    renderMultilineTag("Keywords", {}, keywordLines, "    "),
    renderMultilineTag("ValidatorDefinitions", {}, validatorLines, "    "),
    "  </RulePack>",
    "</RulePackage>"
  ];

  return {
    rulePackage,
    xml: `${lines.join("\n")}\n`,
    digest: sha256(JSON.stringify(rulePackage))
  };
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function resolveLocalizedText(value) {
  if (Array.isArray(value)) {
    const preferred =
      value.find((item) => String(item?.default ?? "").toLowerCase() === "true") ??
      value.find((item) => ensureString(item?.langcode, "").toLowerCase().startsWith("en")) ??
      value[0];
    return resolveLocalizedText(preferred);
  }

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return ensureString(value["#text"], "");
  }

  return "";
}

function buildLocalizedResourceMap(localizedStringsNode) {
  const resources = new Map();

  for (const resourceNode of asArray(localizedStringsNode?.Resource)) {
    const idRef = ensureString(resourceNode?.idRef, "").trim();
    if (!idRef) {
      continue;
    }

    resources.set(idRef, {
      name: resolveLocalizedText(resourceNode?.Name).trim(),
      description: resolveLocalizedText(resourceNode?.Description).trim()
    });
  }

  return resources;
}

function createResourceLabel(resourceMap, idRef, fallback = "") {
  const resource = resourceMap.get(idRef);
  return normalizeTerm(resource?.name) || normalizeTerm(fallback) || idRef;
}

function extractKeywordGroups(keywordNode) {
  const groups = [];
  for (const groupNode of ensureArrayValue(keywordNode?.Group)) {
    const terms = uniqueSortedStrings(
      ensureArrayValue(groupNode?.Term).map((termNode) =>
        typeof termNode === "string" ? termNode : ensureString(termNode?.["#text"], "")
      )
    );
    groups.push({
      matchStyle: ensureString(groupNode?.matchStyle, keywordNode?.matchStyle || "word").trim() || "word",
      caseSensitive: normalizeBoolean(groupNode?.caseSensitive, false),
      terms
    });
  }

  if (groups.length > 0) {
    return groups;
  }

  const fallbackTerms = uniqueSortedStrings(
    ensureArrayValue(keywordNode?.Term).map((termNode) => (typeof termNode === "string" ? termNode : ensureString(termNode?.["#text"], "")))
  );

  return fallbackTerms.length > 0
    ? [
        {
          matchStyle: ensureString(keywordNode?.matchStyle, "word").trim() || "word",
          caseSensitive: false,
          terms: fallbackTerms
        }
      ]
    : [];
}

function buildValidatorDefinitionMap(rulePack, rulesNode) {
  const validatorsNode = ensureArrayValue(rulePack?.ValidatorDefinitions?.Validators ?? rulesNode?.ValidatorDefinitions?.Validators);
  return new Map(
    validatorsNode
      .map((validatorNode) => ({
        id: ensureString(validatorNode?.id, "").trim(),
        type: ensureString(validatorNode?.type, "Checksum").trim() || "Checksum",
        description: ensureString(validatorNode?.description, "").trim(),
        parameters: ensureArrayValue(validatorNode?.Param)
          .map((paramNode) => ({
            name: ensureString(paramNode?.name, "").trim(),
            value: ensureString(paramNode?.value, "").trim()
          }))
          .filter((parameter) => parameter.name.length > 0)
          .sort((a, b) => compareStrings(a.name, b.name))
      }))
      .filter((validator) => validator.id.length > 0)
      .map((validator) => [validator.id, validator])
  );
}

function buildDefinitionMap(rulePack, rulesNode, resourceMap, validatorDefinitions) {
  const definitions = new Map();
  const regexNodes = ensureArrayValue(rulePack?.Regexes?.Regex ?? rulesNode?.Regex);
  const keywordNodes = ensureArrayValue(rulePack?.Keywords?.Keyword ?? rulesNode?.Keyword);

  for (const regexNode of regexNodes) {
    const id = ensureString(regexNode?.id, "").trim();
    if (!id) {
      continue;
    }
    const validatorIds = ensureString(regexNode?.validators, "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .sort(compareStrings);
    definitions.set(id, {
      id,
      kind: "regex",
      displayName: createResourceLabel(resourceMap, id, id),
      description: ensureString(regexNode?.description, "").trim() || ensureString(resourceMap.get(id)?.description, "").trim(),
      actual: {
        regex: ensureString(regexNode?.["#text"], "").trim()
      },
      validators: validatorIds.map((validatorId) => {
        const definition = validatorDefinitions.get(validatorId);
        return {
          id: validatorId,
          valid: true,
          score: definition ? 1 : 0.5,
          reason: definition ? definition.type : "Unresolved validator reference",
          metadata: definition
            ? {
                type: definition.type,
                description: definition.description,
                parameters: definition.parameters
              }
            : {
                unresolved: true
              }
        };
      }),
      metadata: {
        sourceType: "inline"
      }
    });
  }

  for (const keywordNode of keywordNodes) {
    const id = ensureString(keywordNode?.id, "").trim();
    if (!id) {
      continue;
    }
    const groups = extractKeywordGroups(keywordNode);
    definitions.set(id, {
      id,
      kind: groups.length > 1 ? "keywordDictionary" : "keyword",
      displayName: createResourceLabel(resourceMap, id, id),
      description: ensureString(keywordNode?.description, "").trim() || ensureString(resourceMap.get(id)?.description, "").trim(),
      actual: {
        keywords: uniqueSortedStrings(groups.flatMap((group) => group.terms)),
        keywordGroups: groups
      },
      validators: [],
      metadata: {
        matchStyles: uniqueSortedStrings(groups.map((group) => group.matchStyle))
      }
    });
  }

  return definitions;
}

function createFallbackDefinition(idRef, resourceMap) {
  const displayName = createResourceLabel(resourceMap, idRef, idRef);
  const isFunction =
    BUILTIN_FUNCTIONS.some((item) => item.id === idRef) || /^Func[_\s]/i.test(idRef) || /^func_/i.test(idRef);

  return {
    id: idRef,
    kind: isFunction ? "function" : "reference",
    displayName,
    description: ensureString(resourceMap.get(idRef)?.description, "").trim(),
    actual: isFunction
      ? {
          functionReference: idRef
        }
      : {},
    validators: [],
    metadata: {
      unresolved: true
    }
  };
}

function resolveElementReference(reference, definitions, resourceMap, extraMetadata = {}) {
  const idRef = ensureString(reference?.refId, "").trim();
  const base = definitions.get(idRef) ?? createFallbackDefinition(idRef, resourceMap);
  return {
    id: base.id,
    type: base.kind,
    displayName: base.displayName,
    description: base.description,
    actual: base.actual,
    validators: base.validators,
    validation: {
      valid: base.kind !== "reference",
      score: base.kind === "reference" ? 0.3 : 1,
      reason: base.kind === "reference" ? "Referenced element could not be fully resolved." : "Resolved successfully.",
      metadata: {
        refId: idRef,
        refType: ensureString(reference?.refType, base.kind),
        ...extraMetadata
      }
    },
    metadata: {
      ...base.metadata,
      ...extraMetadata
    }
  };
}

function parseSupportingClauses(patternNode) {
  const clauses = [];

  for (const matchNode of ensureArrayValue(patternNode?.Match)) {
    clauses.push({
      type: "match",
      minMatches: Math.max(1, Number(matchNode?.minCount ?? 1) || 1),
      maxMatches: Math.max(1, Number(matchNode?.maxCount ?? matchNode?.minCount ?? 1) || 1),
      logic: "match",
      matches: [
        {
          refId: ensureString(matchNode?.idRef, "").trim(),
          refType: "reference",
          minCount: Math.max(1, Number(matchNode?.minCount ?? 1) || 1),
          uniqueResults: normalizeBoolean(matchNode?.uniqueResults, false),
          proximity: toNullablePositiveInteger(matchNode?.proximity)
        }
      ]
    });
  }

  for (const anyNode of ensureArrayValue(patternNode?.Any)) {
    clauses.push({
      type: "any",
      minMatches: Math.max(0, Number(anyNode?.minMatches ?? 1) || 0),
      maxMatches: toNullablePositiveInteger(anyNode?.maxMatches),
      logic: "any",
      matches: ensureArrayValue(anyNode?.Match).map((childNode) => ({
        refId: ensureString(childNode?.idRef, "").trim(),
        refType: "reference",
        minCount: Math.max(1, Number(childNode?.minCount ?? 1) || 1),
        uniqueResults: normalizeBoolean(childNode?.uniqueResults, false),
        proximity: toNullablePositiveInteger(childNode?.proximity)
      }))
    });
  }

  return clauses;
}

function buildCanonicalImportResult(rulePackage, entities, definitions, resourceMap, issues, sourceName) {
  const sits = entities
    .map((entity) => {
      const patterns = entity.patterns
        .map((pattern, patternIndex) => {
          const supportingMatches = pattern.supporting.flatMap((clause) => {
            if (Array.isArray(clause.matches)) {
              return clause.matches;
            }
            if (clause.type === "match") {
              return [clause.match];
            }
            if (clause.type === "any") {
              return ensureArrayValue(clause.children);
            }
            return [];
          });
          const primaryElement = resolveElementReference(pattern.primary, definitions, resourceMap, {
            proximity: toNullablePositiveInteger(pattern?.metadata?.proximity),
            confidenceLevel: pattern.confidenceLevel
          });
          const supportingElements = supportingMatches.map((match, matchIndex) =>
              resolveElementReference(match, definitions, resourceMap, {
                clauseType: pattern.supporting.find((clause) =>
                  clause.type === "match" ? clause.match?.refId === match.refId : ensureArrayValue(clause.children).some((child) => child.refId === match.refId)
                )?.type,
                clauseIndex: pattern.supporting.findIndex((clause) =>
                  clause.type === "match" ? clause.match?.refId === match.refId : ensureArrayValue(clause.children).some((child) => child.refId === match.refId)
                ),
                matchIndex,
                minMatches:
                  pattern.supporting.find((clause) =>
                    clause.type === "match" ? clause.match?.refId === match.refId : ensureArrayValue(clause.children).some((child) => child.refId === match.refId)
                  )?.minMatches ?? null,
                maxMatches:
                  pattern.supporting.find((clause) =>
                    clause.type === "match" ? clause.match?.refId === match.refId : ensureArrayValue(clause.children).some((child) => child.refId === match.refId)
                  )?.maxMatches ?? null,
                logic:
                  pattern.supporting.find((clause) =>
                    clause.type === "match" ? clause.match?.refId === match.refId : ensureArrayValue(clause.children).some((child) => child.refId === match.refId)
                  )?.logic ?? null,
                proximity: match.proximity
              })
          );

          return {
            id: pattern.id,
            name: pattern.name,
            confidenceLevel: pattern.confidenceLevel,
            proximity: toNullablePositiveInteger(pattern?.metadata?.proximity),
            primaryElement,
            supportingElements,
            operator: pattern.supporting.some((clause) => clause.type === "any") ? "any" : "match",
            minMatches:
              pattern.supporting.find((clause) => clause.type === "any")?.minMatches ??
              (supportingElements.length > 0 ? 1 : null),
            maxMatches:
              pattern.supporting.find((clause) => clause.type === "any")?.maxMatches ??
              (supportingElements.length > 0 ? supportingElements.length : null),
            evidence: pattern.metadata ?? {},
            validationIssues: issues.filter((issue) => issue.path.includes(pattern.id))
          };
        })
        .sort((a, b) => a.confidenceLevel - b.confidenceLevel || compareStrings(a.name, b.name));

      const primaryPattern = patterns[0] ?? null;
      return {
        schemaVersion: CANONICAL_RULE_PACKAGE_SCHEMA,
        id: entity.id,
        name: entity.name,
        publisher: rulePackage.details.publisherName,
        packageName: rulePackage.details.name,
        confidence: entity.recommendedConfidence,
        recommendedConfidence: entity.recommendedConfidence,
        minConfidence: patterns[0]?.confidenceLevel ?? entity.recommendedConfidence,
        primaryElement: primaryPattern?.primaryElement ?? null,
        supportingElements: primaryPattern?.supportingElements ?? [],
        operator: primaryPattern?.operator ?? null,
        minMatches: primaryPattern?.minMatches ?? null,
        maxMatches: primaryPattern?.maxMatches ?? null,
        proximity: entity.patternsProximity,
        confidenceLevel: primaryPattern?.confidenceLevel ?? entity.recommendedConfidence,
        evidenceMetadata: {
          workload: entity.workload,
          source: entity.source
        },
        validationIssues: issues.filter((issue) => issue.path.includes(entity.id) || issue.path.includes(entity.name)),
        sourceReferences: uniqueSortedStrings([entity.id, ...patterns.flatMap((pattern) => [pattern.primaryElement?.id ?? ""])]),
        patterns
      };
    })
    .sort((a, b) => compareStrings(a.name, b.name));

  return {
    schemaVersion: IMPORT_RESULT_SCHEMA,
    source: sourceName,
    package: {
      schemaVersion: CANONICAL_RULE_PACKAGE_SCHEMA,
      id: rulePackage.id,
      publisherId: rulePackage.publisherId,
      publisherName: rulePackage.details.publisherName,
      name: rulePackage.details.name,
      description: rulePackage.details.description,
      defaultLangCode: rulePackage.defaultLangCode,
      version: clone(rulePackage.version),
      packageType:
        rulePackage.details.name === "Microsoft Rule Package"
          ? "builtIn"
          : rulePackage.details.name === "Microsoft.SCCManaged.CustomRulePack"
            ? "custom"
            : "other"
    },
    stats: {
      sitCount: sits.length,
      regexCount: rulePackage.processors.regexes.length,
      keywordCount: rulePackage.processors.keywords.length,
      validatorCount: rulePackage.processors.validators.length
    },
    sits,
    issues
  };
}

export function importRulePackageFromXml(xml) {
  const trimmedXml = normalizeXmlString(xml);
  if (trimmedXml.length === 0) {
    throw new Error("XML content is required.");
  }

  const parsed = parser.parse(trimmedXml);
  const root = parsed?.RulePackage;
  const rulePack = root?.RulePack;
  if (!root || !rulePack) {
    throw new Error("XML does not contain a RulePackage/RulePack root.");
  }

  const detailsNode = rulePack.Details ?? {};
  const localizedDetailsCandidates = ensureArrayValue(detailsNode.LocalizedDetails);
  const localizedDetailsNode =
    localizedDetailsCandidates.find((item) => String(item?.langcode ?? "").toLowerCase().startsWith("en")) ??
    localizedDetailsCandidates[0] ??
    {};
  const rulesNode = rulePack.Rules ?? root.Rules ?? {};
  const resourceMap = buildLocalizedResourceMap(rulesNode.LocalizedStrings);
  const validatorDefinitions = buildValidatorDefinitionMap(rulePack, rulesNode);
  const definitions = buildDefinitionMap(rulePack, rulesNode, resourceMap, validatorDefinitions);

  const entities = ensureArrayValue(rulesNode.Entity).map((entityNode, entityIndex) => {
    const entityId = ensureString(entityNode.id, "").trim() || randomGuid();
    const localizedResource = resourceMap.get(entityId);
    const localizedStringsNode =
      ensureArrayValue(entityNode.LocalizedStrings).find((item) =>
        String(item?.langcode ?? "").toLowerCase().startsWith("en")
      ) ??
      ensureArrayValue(entityNode.LocalizedStrings)[0] ??
      {};
    const patternsNode = ensureArrayValue(entityNode.Patterns?.Pattern ?? entityNode.Pattern);
    return {
      id: entityId,
      name:
        normalizeTerm(resolveLocalizedText(localizedStringsNode.Name)) ||
        normalizeTerm(localizedResource?.name) ||
        `Imported SIT ${entityIndex + 1}`,
      description:
        resolveLocalizedText(localizedStringsNode.Description).trim() || ensureString(localizedResource?.description, "").trim(),
      patternsProximity: toPositiveInteger(entityNode.patternsProximity, DEFAULT_PROXIMITY),
      recommendedConfidence: Math.max(
        0,
        Math.min(100, Number(entityNode.recommendedConfidence ?? DEFAULT_CONFIDENCE) || DEFAULT_CONFIDENCE)
      ),
      workload: ensureString(entityNode.workload, "").trim(),
      patterns: patternsNode.map((patternNode, patternIndex) => {
        const supporting = parseSupportingClauses(patternNode).map((clause) =>
          clause.type === "match"
            ? {
                type: "match",
                match: {
                  refId: clause.matches[0]?.refId ?? "",
                  refType: "reference",
                  minCount: clause.matches[0]?.minCount ?? 1,
                  uniqueResults: clause.matches[0]?.uniqueResults ?? false
                }
              }
            : {
                type: "any",
                minMatches: clause.minMatches,
                maxMatches: clause.maxMatches,
                children: clause.matches.map((childNode) => ({
                  refId: childNode.refId,
                  refType: "reference",
                  minCount: childNode.minCount,
                  uniqueResults: childNode.uniqueResults
                }))
              }
        );

        const idMatchNode = ensureArrayValue(patternNode.IdMatch)[0] ?? patternNode.IdMatch ?? {};
        return {
          id: ensureString(patternNode.id, "").trim() || `pattern-${patternIndex + 1}`,
          name: ensureString(patternNode.name, "").trim() || `Pattern ${patternIndex + 1}`,
          confidenceLevel: Number(patternNode.confidenceLevel ?? DEFAULT_CONFIDENCE) || DEFAULT_CONFIDENCE,
          primary: {
            refId: ensureString(idMatchNode.idRef, "").trim(),
            refType: "reference"
          },
          supporting,
          metadata: {
            proximity: patternNode?.proximity,
            recommendedConfidence: patternNode?.recommendedConfidence,
            rawAttributes: Object.fromEntries(
              Object.entries(patternNode ?? {})
                .filter(([key]) => !["IdMatch", "Match", "Any", "#text"].includes(key))
                .sort(([left], [right]) => compareStrings(left, right))
            )
          }
        };
      })
    };
  });

  const rulePackage = normalizeRulePackage({
    schemaVersion: ensureString(root.schemaVersion, RULE_PACKAGE_SCHEMA),
    id: ensureString(rulePack.id, "").trim(),
    version: ensureString(rulePack.Version, "1.0.0.0"),
    publisherId: ensureString(rulePack.Publisher?.id, "").trim(),
    defaultLangCode: ensureString(detailsNode.defaultLangCode, DEFAULT_LANG),
    details: {
      publisherName: ensureString(localizedDetailsNode.PublisherName, "SICO").trim(),
      name: ensureString(localizedDetailsNode.Name, "Imported SIT Rule Package").trim(),
      description: ensureString(localizedDetailsNode.Description, "").trim()
    },
    entities,
    processors: {
      regexes: [...definitions.values()]
        .filter((definition) => definition.kind === "regex")
        .map((definition) => ({
          id: definition.id,
          pattern: ensureString(definition.actual?.regex, "").trim(),
          validators: definition.validators.map((validator) => validator.id),
          description: definition.description
        })),
      keywords: [...definitions.values()]
        .filter((definition) => definition.kind === "keyword" || definition.kind === "keywordDictionary")
        .map((definition) => ({
          id: definition.id,
          matchStyle: ensureString(definition.actual?.keywordGroups?.[0]?.matchStyle, "word"),
          terms: ensureArray(definition.actual?.keywords),
          description: definition.description
        })),
      validators: [...validatorDefinitions.values()]
    }
  });

  const validation = validateRulePackage(rulePackage);
  const importResult = buildCanonicalImportResult(
    validation.rulePackage,
    entities,
    definitions,
    resourceMap,
    validation.issues,
    "xml"
  );

  return {
    rulePackage: validation.rulePackage,
    importResult,
    digest: sha256(JSON.stringify(validation.rulePackage))
  };
}

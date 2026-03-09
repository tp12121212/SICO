import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  JsonObject,
  NormalizedSitPattern,
  SitLibraryQuery,
  SitLibraryResult,
  SitPatternRecord,
  SitPatternsFile
} from "../types/sit";
import {
  normalizeString,
  normalizeStringArray,
  stableSortByStrings,
  toJsonArray,
  toJsonObject
} from "../utils/normalize";

const SIT_PATTERNS_PATH = path.join(process.cwd(), "src/data/sit/patterns.json");
const SCHEMA_VERSION = "sit-library/v1";

let cachedDataset: SitLibraryResult | null = null;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function isMicrosoftLearnSitReference(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const candidate = value.trim().toLowerCase();
  return candidate.includes("learn.microsoft.com") && candidate.includes("/purview/sit-defn-");
}

function isMicrosoftBuiltIn(record: SitPatternRecord): boolean {
  const source = normalizeString(record.source).toLowerCase();
  const author = normalizeString(record.author).toLowerCase();
  if (source.includes("microsoft") || author.includes("microsoft")) {
    return true;
  }

  const references = toJsonArray(record.references);
  for (const reference of references) {
    if (typeof reference === "string" && isMicrosoftLearnSitReference(reference)) {
      return true;
    }
    if (reference && typeof reference === "object" && !Array.isArray(reference)) {
      const maybeUrl = (reference as Record<string, unknown>).url;
      if (isMicrosoftLearnSitReference(maybeUrl)) {
        return true;
      }
    }
  }

  return false;
}

function normalizeSitPattern(record: SitPatternRecord): NormalizedSitPattern {
  const schema = normalizeString(record.schema) || "testpattern/v1";
  const name = normalizeString(record.name) || "Unnamed Pattern";
  const slug = normalizeString(record.slug) || name.toLowerCase().replace(/\s+/g, "-");
  const version = normalizeString(record.version) || "1.0.0";
  const type = normalizeString(record.type) || "unknown";
  const engine = normalizeString(record.engine) || "unknown";
  const description = normalizeString(record.description);

  const knownKeys = new Set([
    "schema",
    "name",
    "slug",
    "version",
    "type",
    "engine",
    "description",
    "operation",
    "pattern",
    "confidence",
    "confidence_justification",
    "jurisdictions",
    "regulations",
    "data_categories",
    "corroborative_evidence",
    "test_cases",
    "false_positives",
    "exports",
    "scope",
    "purview",
    "risk_rating",
    "risk_description",
    "sensitivity_labels",
    "references",
    "created",
    "updated",
    "author",
    "source",
    "license"
  ]);

  const extra: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.has(key) && value !== undefined) {
      extra[key] = value as never;
    }
  }

  const builtIn = isMicrosoftBuiltIn(record);

  return {
    schema,
    name,
    slug,
    version,
    type,
    engine,
    description,
    operation: normalizeString(record.operation) || undefined,
    pattern: normalizeString(record.pattern) || undefined,
    confidence: normalizeString(record.confidence) || undefined,
    confidence_justification: normalizeString(record.confidence_justification) || undefined,
    jurisdictions: normalizeStringArray(record.jurisdictions),
    regulations: normalizeStringArray(record.regulations),
    data_categories: normalizeStringArray(record.data_categories),
    corroborative_evidence: toJsonObject(record.corroborative_evidence),
    test_cases: toJsonObject(record.test_cases),
    false_positives: toJsonArray(record.false_positives),
    exports: normalizeStringArray(record.exports),
    scope: normalizeString(record.scope) || undefined,
    purview: toJsonObject(record.purview),
    risk_rating: typeof record.risk_rating === "number" ? record.risk_rating : undefined,
    risk_description: normalizeString(record.risk_description) || undefined,
    sensitivity_labels: toJsonObject(record.sensitivity_labels),
    references: toJsonArray(record.references),
    created: normalizeString(record.created) || undefined,
    updated: normalizeString(record.updated) || undefined,
    author: builtIn ? "Microsoft" : normalizeString(record.author) || undefined,
    source: builtIn ? "Microsoft" : normalizeString(record.source) || undefined,
    provenance_type: builtIn ? "Built-in" : "Custom",
    license: normalizeString(record.license) || undefined,
    extra
  };
}

async function loadDataset(): Promise<SitLibraryResult> {
  if (IS_PRODUCTION && cachedDataset) {
    return cachedDataset;
  }

  const raw = await readFile(SIT_PATTERNS_PATH, "utf-8");
  const parsed = JSON.parse(raw) as SitPatternsFile;
  const patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];

  const normalized = stableSortByStrings(patterns.map((item) => normalizeSitPattern(item)), [
    (item) => item.name,
    (item) => item.slug,
    (item) => item.version
  ]);

  const availableTypes = [...new Set(normalized.map((item) => item.type).filter((item) => item.length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );
  const availableEngines = [...new Set(normalized.map((item) => item.engine).filter((item) => item.length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );
  const availableAuthors = [...new Set(normalized.map((item) => item.author ?? "").filter((item) => item.length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );

  const dataset: SitLibraryResult = {
    schemaVersion: SCHEMA_VERSION,
    sourceVersion: normalizeString(parsed.version) || "unknown",
    generated: normalizeString(parsed.generated) || undefined,
    items: normalized,
    availableTypes,
    availableEngines,
    availableAuthors
  };

  if (IS_PRODUCTION) {
    cachedDataset = dataset;
  }

  return dataset;
}

function applyQuery(items: NormalizedSitPattern[], query: SitLibraryQuery): NormalizedSitPattern[] {
  let filtered = [...items];
  const search = normalizeString(query.search).toLowerCase();
  const type = normalizeString(query.type);
  const engine = normalizeString(query.engine);
  const author = normalizeString(query.author);
  const sort = query.sort ?? "name_asc";

  if (search) {
    filtered = filtered.filter((item) =>
      [item.name, item.slug, item.description, item.type, item.engine, item.author ?? "", item.source ?? ""].some((field) =>
        field.toLowerCase().includes(search)
      )
    );
  }

  if (type) {
    filtered = filtered.filter((item) => item.type === type);
  }

  if (engine) {
    filtered = filtered.filter((item) => item.engine === engine);
  }

  if (author) {
    filtered = filtered.filter((item) => (item.author ?? "") === author);
  }

  switch (sort) {
    case "name_desc":
      filtered.sort((a, b) => b.name.localeCompare(a.name) || b.slug.localeCompare(a.slug));
      break;
    case "risk_desc":
      filtered.sort((a, b) => {
        const aRisk = typeof a.risk_rating === "number" ? a.risk_rating : -1;
        const bRisk = typeof b.risk_rating === "number" ? b.risk_rating : -1;
        if (aRisk !== bRisk) {
          return bRisk - aRisk;
        }
        return a.name.localeCompare(b.name);
      });
      break;
    case "updated_desc":
      filtered.sort((a, b) => {
        const aUpdated = a.updated ?? "";
        const bUpdated = b.updated ?? "";
        if (aUpdated !== bUpdated) {
          return bUpdated.localeCompare(aUpdated);
        }
        return a.name.localeCompare(b.name);
      });
      break;
    case "name_asc":
    default:
      filtered.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
      break;
  }

  return filtered;
}

export async function getSitLibrary(query: SitLibraryQuery = {}): Promise<SitLibraryResult> {
  const dataset = await loadDataset();
  return {
    ...dataset,
    items: applyQuery(dataset.items, query)
  };
}

export async function getSitBySlug(slug: string): Promise<NormalizedSitPattern | null> {
  const dataset = await loadDataset();
  const normalizedSlug = normalizeString(slug);
  return dataset.items.find((item) => item.slug === normalizedSlug) ?? null;
}

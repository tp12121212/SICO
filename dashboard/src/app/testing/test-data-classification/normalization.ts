export type ClassificationMatchShape = "object" | "array" | "string" | "null" | "unknown";

export type NormalizedMatchGroup = {
  primaryMatch: string;
  supportingMatches: string[];
  rawShape: ClassificationMatchShape;
  countContribution: number;
};

export type NormalizedClassificationResult = {
  key: string;
  classificationName: string;
  classifierType: string;
  confidenceLevel: number | null;
  count: number;
  streamName: string;
  sourceFile: string | null;
  identity: string | null;
  matchGroups: NormalizedMatchGroup[];
  rawMatches: unknown;
};

export type NormalizedClassificationSummary = {
  totalClassificationResults: number;
  totalReportedMatchCount: number;
  uniqueClassificationNames: number;
  confidenceTierCount: number;
  renderedMatchGroups: number;
};

export type NormalizedClassificationView = {
  sourceFileName: string | null;
  results: NormalizedClassificationResult[];
  summary: NormalizedClassificationSummary;
};

export type NormalizeOptions = {
  warn?: (message: string) => void;
};

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toDisplayString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value) || isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function normalizeSupportingValue(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toDisplayString(item))
      .filter((item) => item.length > 0);
  }

  const single = toDisplayString(value);
  return single.length > 0 ? [single] : [];
}

function normalizeObjectEntry(primaryMatch: string, value: unknown): NormalizedMatchGroup {
  const supportingMatches = normalizeSupportingValue(value);

  return {
    primaryMatch,
    supportingMatches,
    rawShape: value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "string" ? "string" : "object",
    countContribution: 1
  };
}

function normalizeObjectMatches(matches: LooseRecord): NormalizedMatchGroup[] {
  return Object.entries(matches).map(([primaryMatch, value]) => normalizeObjectEntry(primaryMatch, value));
}

function isSingleEntryObjectArray(matches: unknown[]): matches is LooseRecord[] {
  return matches.every((item) => isRecord(item) && Object.keys(item).length === 1);
}

function normalizeArrayMatches(matches: unknown[], warn: (message: string) => void): NormalizedMatchGroup[] {
  if (matches.length === 0) {
    return [];
  }

  if (isSingleEntryObjectArray(matches)) {
    return matches.map((entry) => {
      const primaryMatch = Object.keys(entry)[0] ?? "";
      return normalizeObjectEntry(primaryMatch, entry[primaryMatch]);
    });
  }

  const primitiveArray = matches.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
  if (primitiveArray) {
    return matches.map((item) => ({
      primaryMatch: toDisplayString(item),
      supportingMatches: [],
      rawShape: "string",
      countContribution: 1
    }));
  }

  warn("Unrecognized array-shaped Matches payload; rendering fallback groups.");
  return matches.map((item, index) => ({
    primaryMatch: `Entry ${index + 1}`,
    supportingMatches: [toDisplayString(item)],
    rawShape: Array.isArray(item) ? "array" : isRecord(item) ? "object" : item === null ? "null" : "unknown",
    countContribution: 1
  }));
}

export function normalizeMatchGroups(matches: unknown, options?: NormalizeOptions): NormalizedMatchGroup[] {
  const warn = options?.warn ?? (() => undefined);

  if (matches === null || matches === undefined) {
    return [];
  }

  if (isRecord(matches)) {
    return normalizeObjectMatches(matches);
  }

  if (Array.isArray(matches)) {
    return normalizeArrayMatches(matches, warn);
  }

  if (typeof matches === "string" || typeof matches === "number" || typeof matches === "boolean") {
    return [{
      primaryMatch: toDisplayString(matches),
      supportingMatches: [],
      rawShape: "string",
      countContribution: 1
    }];
  }

  warn("Unrecognized Matches payload type; rendering a single fallback group.");
  return [{
    primaryMatch: "Unrecognized match payload",
    supportingMatches: [toDisplayString(matches)],
    rawShape: "unknown",
    countContribution: 1
  }];
}

function extractClassificationResults(raw: unknown): LooseRecord[] {
  if (!isRecord(raw)) {
    return [];
  }

  const direct = raw.ClassificationResults;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is LooseRecord => isRecord(item));
  }

  const dataClassification = raw.DataClassification;
  if (isRecord(dataClassification)) {
    const result = dataClassification.Result;
    if (isRecord(result) && Array.isArray(result.ClassificationResults)) {
      return result.ClassificationResults.filter((item): item is LooseRecord => isRecord(item));
    }
  }

  const result = raw.Result;
  if (isRecord(result) && Array.isArray(result.ClassificationResults)) {
    return result.ClassificationResults.filter((item): item is LooseRecord => isRecord(item));
  }

  return [];
}

export function extractPayloadSourceFile(raw: unknown): string | null {
  if (!isRecord(raw)) {
    return null;
  }

  const topLevelSource = asNonEmptyString(raw.SourceFile);
  if (topLevelSource) {
    return topLevelSource;
  }

  const dataClassification = raw.DataClassification;
  if (isRecord(dataClassification)) {
    const nestedSource = asNonEmptyString(dataClassification.SourceFile);
    if (nestedSource) {
      return nestedSource;
    }
  }

  const streams = raw.Streams;
  if (isRecord(streams)) {
    const streamSource = asNonEmptyString(streams.SourceFile);
    if (streamSource) {
      return streamSource;
    }
  }

  return null;
}

export function normalizeClassificationView(input: {
  result: unknown;
  workerFileName?: string | null;
  fallbackSourceFileName?: string | null;
  options?: NormalizeOptions;
}): NormalizedClassificationView {
  const warn = input.options?.warn ?? ((message: string) => console.warn(`[test-data-classification] ${message}`));
  const classificationResults = extractClassificationResults(input.result);

  const sourceFileName =
    extractPayloadSourceFile(input.result) ??
    (typeof input.workerFileName === "string" && input.workerFileName.trim().length > 0 ? input.workerFileName : null) ??
    (typeof input.fallbackSourceFileName === "string" && input.fallbackSourceFileName.trim().length > 0 ? input.fallbackSourceFileName : null);

  const normalizedResults = classificationResults.map((entry, index): NormalizedClassificationResult => {
    const classificationName = asNonEmptyString(entry.ClassificationName) ?? `Classification ${index + 1}`;
    const classifierType = asNonEmptyString(entry.ClassifierType) ?? "Unknown";
    const confidenceLevel = asNumber(entry.ConfidenceLevel);
    const streamName = asNonEmptyString(entry.StreamName) ?? "";
    const sourceFile = asNonEmptyString(entry.SourceFile) ?? sourceFileName;
    const identity = asNonEmptyString(entry.Identity);
    const count = asNumber(entry.Count) ?? 0;
    const rawMatches = entry.Matches;
    const matchGroups = normalizeMatchGroups(rawMatches, { warn });

    const keyParts = [
      String(index),
      classificationName,
      identity ?? "",
      confidenceLevel !== null ? String(confidenceLevel) : ""
    ];

    return {
      key: keyParts.join("::"),
      classificationName,
      classifierType,
      confidenceLevel,
      count,
      streamName,
      sourceFile,
      identity,
      matchGroups,
      rawMatches
    };
  });

  const uniqueClassificationNames = new Set(normalizedResults.map((entry) => entry.classificationName));
  const confidenceTiers = new Set(normalizedResults
    .map((entry) => entry.confidenceLevel)
    .filter((value): value is number => value !== null));

  const summary: NormalizedClassificationSummary = {
    totalClassificationResults: normalizedResults.length,
    totalReportedMatchCount: normalizedResults.reduce((sum, entry) => sum + entry.count, 0),
    uniqueClassificationNames: uniqueClassificationNames.size,
    confidenceTierCount: confidenceTiers.size,
    renderedMatchGroups: normalizedResults.reduce((sum, entry) => sum + entry.matchGroups.length, 0)
  };

  return {
    sourceFileName,
    results: normalizedResults,
    summary
  };
}

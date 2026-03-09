import type { JsonObject, JsonValue } from "../types/sit";

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      deduped.add(trimmed);
    }
  }

  return [...deduped].sort((a, b) => a.localeCompare(b));
}

export function stableSortByStrings<T>(
  items: readonly T[],
  keySelectors: Array<(item: T) => string>
): T[] {
  return [...items].sort((a, b) => {
    for (const selector of keySelectors) {
      const aKey = selector(a);
      const bKey = selector(b);
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) {
        return cmp;
      }
    }
    return 0;
  });
}

export function toJsonObject(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return deepSortObject(value as JsonObject);
}

export function toJsonArray(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeJsonValue(entry));
}

export function normalizeJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }
  if (typeof value === "object") {
    return deepSortObject(value as JsonObject);
  }
  return String(value);
}

export function deepSortObject(obj: JsonObject): JsonObject {
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  const sorted: JsonObject = {};
  for (const [key, value] of entries) {
    sorted[key] = normalizeJsonValue(value);
  }
  return sorted;
}

import "server-only";

import { DLP_RULES_SEED } from "../seed/dlp-seed";
import type { DlpLibraryQuery, DlpLibraryResult, DlpRuleRecord } from "../types/dlp";
import { normalizeString } from "../utils/normalize";

const SCHEMA_VERSION = "dlp-library/v1";

function sortRules(items: DlpRuleRecord[], sort: DlpLibraryQuery["sort"]): DlpRuleRecord[] {
  const sorted = [...items];
  switch (sort) {
    case "name_desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name) || b.slug.localeCompare(a.slug));
      break;
    case "updated_desc":
      sorted.sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name));
      break;
    case "name_asc":
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
      break;
  }
  return sorted;
}

export async function getDlpLibrary(query: DlpLibraryQuery = {}): Promise<DlpLibraryResult> {
  const search = normalizeString(query.search).toLowerCase();
  const severity = normalizeString(query.severity);
  const policyMode = normalizeString(query.policy_mode);

  let items = sortRules(DLP_RULES_SEED, query.sort ?? "name_asc");

  if (search) {
    items = items.filter((item) =>
      [item.name, item.slug, item.description, item.rule_type, item.scope].some((value) =>
        value.toLowerCase().includes(search)
      )
    );
  }
  if (severity) {
    items = items.filter((item) => item.severity === severity);
  }
  if (policyMode) {
    items = items.filter((item) => item.policy_mode === policyMode);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    items,
    availableSeverities: [...new Set(DLP_RULES_SEED.map((item) => item.severity))].sort((a, b) => a.localeCompare(b)),
    availablePolicyModes: [...new Set(DLP_RULES_SEED.map((item) => item.policy_mode))].sort((a, b) => a.localeCompare(b))
  };
}

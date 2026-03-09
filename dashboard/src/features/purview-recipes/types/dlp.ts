import type { JsonObject, JsonValue } from "./sit";

export type DlpRuleRecord = {
  schema: string;
  name: string;
  slug: string;
  version: string;
  description: string;
  rule_type: string;
  scope: string;
  conditions: JsonObject;
  exceptions: JsonObject;
  actions: JsonObject;
  policy_mode: "test" | "audit" | "enforce";
  severity: "low" | "medium" | "high" | "critical";
  jurisdictions: string[];
  regulations: string[];
  related_sits: string[];
  labels: string[];
  author: string;
  source: string;
  created: string;
  updated: string;
  metadata?: JsonObject;
  notes?: string;
  [key: string]: JsonValue | undefined;
};

export type DlpLibraryQuery = {
  search?: string;
  severity?: string;
  policy_mode?: string;
  sort?: "name_asc" | "name_desc" | "updated_desc";
};

export type DlpLibraryResult = {
  schemaVersion: string;
  items: DlpRuleRecord[];
  availableSeverities: string[];
  availablePolicyModes: string[];
};

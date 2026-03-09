export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type SitPatternRecord = {
  schema?: string;
  name?: string;
  slug?: string;
  version?: string;
  type?: string;
  engine?: string;
  description?: string;
  operation?: string;
  pattern?: string;
  confidence?: string;
  confidence_justification?: string;
  jurisdictions?: string[];
  regulations?: string[];
  data_categories?: string[];
  corroborative_evidence?: JsonObject;
  test_cases?: JsonObject;
  false_positives?: JsonValue[];
  exports?: string[];
  scope?: string;
  purview?: JsonObject;
  risk_rating?: number;
  risk_description?: string;
  sensitivity_labels?: JsonObject;
  references?: JsonValue[];
  created?: string;
  updated?: string;
  author?: string;
  source?: string;
  license?: string;
  [key: string]: JsonValue | undefined;
};

export type SitPatternsFile = {
  version?: string;
  generated?: string;
  patterns?: SitPatternRecord[];
};

export type NormalizedSitPattern = {
  schema: string;
  name: string;
  slug: string;
  version: string;
  type: string;
  engine: string;
  description: string;
  operation?: string;
  pattern?: string;
  confidence?: string;
  confidence_justification?: string;
  jurisdictions: string[];
  regulations: string[];
  data_categories: string[];
  corroborative_evidence?: JsonObject;
  test_cases?: JsonObject;
  false_positives: JsonValue[];
  exports: string[];
  scope?: string;
  purview?: JsonObject;
  risk_rating?: number;
  risk_description?: string;
  sensitivity_labels?: JsonObject;
  references: JsonValue[];
  created?: string;
  updated?: string;
  author?: string;
  source?: string;
  license?: string;
  extra: JsonObject;
};

export type SitLibraryQuery = {
  search?: string;
  type?: string;
  engine?: string;
  sort?: "name_asc" | "name_desc" | "risk_desc" | "updated_desc";
};

export type SitLibraryResult = {
  schemaVersion: string;
  sourceVersion: string;
  generated?: string;
  items: NormalizedSitPattern[];
  availableTypes: string[];
  availableEngines: string[];
};

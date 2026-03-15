export type ValidationIssue = {
  level: "error" | "warning";
  path: string;
  code: string;
  message: string;
};

export type ResolvedValidator = {
  id: string;
  valid: boolean;
  score: number;
  reason: string;
  metadata: Record<string, unknown>;
};

export type ResolvedDetectionElement = {
  id: string;
  type: string;
  displayName: string;
  description: string;
  actual: {
    regex?: string;
    keywords?: string[];
    keywordGroups?: Array<{
      matchStyle: string;
      caseSensitive: boolean;
      terms: string[];
    }>;
    functionReference?: string;
  };
  validators: ResolvedValidator[];
  validation: {
    valid: boolean;
    score: number;
    reason: string;
    metadata: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
};

export type CanonicalPatternDetail = {
  id: string;
  name: string;
  confidenceLevel: number;
  proximity: number | null;
  primaryElement: ResolvedDetectionElement;
  supportingElements: ResolvedDetectionElement[];
  operator: string | null;
  minMatches: number | null;
  maxMatches: number | null;
  evidence: Record<string, unknown>;
  validationIssues: ValidationIssue[];
};

export type SitDetail = {
  schemaVersion: string;
  id: string;
  name: string;
  publisher: string;
  packageName: string;
  confidence: number;
  recommendedConfidence: number;
  minConfidence: number;
  primaryElement: ResolvedDetectionElement | null;
  supportingElements: ResolvedDetectionElement[];
  operator: string | null;
  minMatches: number | null;
  maxMatches: number | null;
  proximity: number | null;
  confidenceLevel: number | null;
  evidenceMetadata: Record<string, unknown>;
  validationIssues: ValidationIssue[];
  sourceReferences: string[];
  patterns: CanonicalPatternDetail[];
};

export type SitImportResult = {
  schemaVersion: string;
  source: string;
  package: {
    schemaVersion: string;
    id: string;
    publisherId: string;
    publisherName: string;
    name: string;
    description: string;
    defaultLangCode: string;
    version: {
      major: number;
      minor: number;
      build: number;
      revision: number;
    };
    packageType: string;
  };
  stats: {
    sitCount: number;
    regexCount: number;
    keywordCount: number;
    validatorCount: number;
  };
  sits: SitDetail[];
  issues: ValidationIssue[];
};

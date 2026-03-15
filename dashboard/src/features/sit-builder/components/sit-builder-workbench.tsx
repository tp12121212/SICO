"use client";

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type PublicClientApplication as PublicClientApplicationType
} from "@azure/msal-browser";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { readXmlFile } from "@/features/sit-builder/lib/xml";
import type { ResolvedDetectionElement, SitDetail, SitImportResult, ValidationIssue } from "@/features/sit-builder/types";
import LiveExecutionTerminal from "@/features/testing/components/live-execution-terminal";
import { buildApiUrl } from "@/features/testing/lib/api-url";
import {
  getMsalUnsupportedReason,
  shouldFallbackToRedirect,
  shouldUseRedirectAuthFlow
} from "@/features/testing/lib/msal-support";

type RulePackageVersion = {
  major: number;
  minor: number;
  build: number;
  revision: number;
};

type MatchRef = {
  refId: string;
  refType: string;
  minCount?: number;
  uniqueResults?: boolean;
};

type SupportClause =
  | {
      type: "match";
      match: MatchRef;
    }
  | {
      type: "any";
      minMatches: number;
      maxMatches: number | null;
      children: MatchRef[];
    };

type Pattern = {
  id: string;
  name: string;
  confidenceLevel: number;
  primary: {
    refId: string;
    refType: string;
  };
  supporting: SupportClause[];
};

type Entity = {
  id: string;
  name: string;
  description: string;
  patternsProximity: number;
  recommendedConfidence: number;
  workload?: string;
  patterns: Pattern[];
};

type RegexProcessor = {
  id: string;
  pattern: string;
  validators: string[];
  description?: string;
};

type KeywordProcessor = {
  id: string;
  matchStyle: string;
  terms: string[];
  description?: string;
};

type ValidatorDefinition = {
  id: string;
  type: string;
  description?: string;
  parameters: Array<{
    name: string;
    value: string;
  }>;
};

type RulePackage = {
  schemaVersion: string;
  id: string;
  version: RulePackageVersion;
  publisherId: string;
  defaultLangCode: string;
  details: {
    publisherName: string;
    name: string;
    description: string;
  };
  entities: Entity[];
  processors: {
    regexes: RegexProcessor[];
    keywords: KeywordProcessor[];
    validators: ValidatorDefinition[];
    functions?: Array<{
      id: string;
      description: string;
      kind: string;
    }>;
  };
};

type Catalog = {
  confidenceLevels: number[];
  builtinFunctions: Array<{
    id: string;
    description: string;
    kind: string;
  }>;
  validatorTypes: Array<{
    id: string;
    description: string;
  }>;
};

type TemplateResponse = {
  rulePackage: RulePackage;
  issues: ValidationIssue[];
  xml: string;
  catalog: Catalog;
  importResult?: SitImportResult;
};

type WorkerPublishResult = {
  status?: string;
  packageId?: string;
  packageName?: string;
  entityCount?: number;
  details?: string;
  mode?: string;
  xml?: string;
  error?: string;
};

const aadClientId = process.env.NEXT_PUBLIC_AAD_CLIENT_ID ?? "63eefc68-2d4b-45c0-a619-65b45c5fada9";
const aadAuthority = process.env.NEXT_PUBLIC_AAD_AUTHORITY ?? "https://login.microsoftonline.com/organizations";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const apiScope = process.env.NEXT_PUBLIC_API_SCOPE ?? `api://${aadClientId}/Capsule.Submit`;
const maxUploadMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10);

const fallbackCatalog: Catalog = {
  confidenceLevels: [65, 75, 85],
  builtinFunctions: [
    { id: "Func_credit_card", description: "Microsoft built-in credit card detector", kind: "function" },
    { id: "Func_date", description: "Microsoft built-in date detector", kind: "function" },
    { id: "Func_ssn", description: "Microsoft built-in SSN detector", kind: "function" },
    { id: "Func_iban", description: "Microsoft built-in IBAN detector", kind: "function" }
  ],
  validatorTypes: [
    { id: "Checksum", description: "Checksum validator" },
    { id: "DateSimple", description: "Simple date validator" }
  ]
};

const fallbackRulePackage: RulePackage = {
  schemaVersion: "sico-sit-rule-package/v1",
  id: "00000000-0000-4000-8000-000000000001",
  version: { major: 1, minor: 0, build: 0, revision: 0 },
  publisherId: "00000000-0000-4000-8000-000000000002",
  defaultLangCode: "en-us",
  details: {
    publisherName: "SICO",
    name: "New SIT Rule Package",
    description: "Purview-aligned SIT rule package draft created in SICO."
  },
  entities: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "New Sensitive Information Type",
      description: "Describe the detector purpose and expected evidence model.",
      patternsProximity: 300,
      recommendedConfidence: 75,
      patterns: [
        {
          id: "pattern-1",
          name: "Pattern 1",
          confidenceLevel: 75,
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
    validators: [],
    functions: fallbackCatalog.builtinFunctions
  }
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRedirectStartPage(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.location.href;
}

async function getAccessToken(
  msalClient: PublicClientApplicationType,
  account: AccountInfo,
  useRedirectFlow: boolean
): Promise<string> {
  try {
    const result = await msalClient.acquireTokenSilent({
      account,
      scopes: ["openid", "profile", apiScope]
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      if (useRedirectFlow) {
        await msalClient.acquireTokenRedirect({
          scopes: ["openid", "profile", apiScope],
          redirectStartPage: getRedirectStartPage()
        });
        throw new Error("Redirecting to Microsoft sign-in...");
      }
      const result = await msalClient.acquireTokenPopup({ scopes: ["openid", "profile", apiScope] });
      return result.accessToken;
    }
    throw error;
  }
}

function createCapsule(input: { userId: string; tenant: string; rulePackage: RulePackage; xml: string }) {
  const now = new Date();
  const capsuleId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `capsule-${Date.now()}`;

  return {
    schemaVersion: "1.0",
    capsuleId,
    tenant: input.tenant,
    userId: input.userId,
    action: "SitRulePackagePublish",
    params: {
      rulePackage: input.rulePackage,
      xml: input.xml
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    signature: `dummy-signature:${capsuleId}`
  };
}

function createEntity(): Entity {
  const nextId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `entity-${Date.now()}`;
  return {
    id: nextId,
    name: "New Sensitive Information Type",
    description: "",
    patternsProximity: 300,
    recommendedConfidence: 75,
    patterns: [
      {
        id: "pattern-1",
        name: "Pattern 1",
        confidenceLevel: 75,
        primary: {
          refId: "",
          refType: "regex"
        },
        supporting: []
      }
    ]
  };
}

function createRegexProcessor(): RegexProcessor {
  return {
    id: `Regex.${Date.now()}`,
    pattern: "",
    validators: [],
    description: ""
  };
}

function createKeywordProcessor(): KeywordProcessor {
  return {
    id: `Keyword.${Date.now()}`,
    matchStyle: "word",
    terms: [],
    description: ""
  };
}

function createValidatorDefinition(): ValidatorDefinition {
  return {
    id: `Validator.${Date.now()}`,
    type: "Checksum",
    description: "",
    parameters: []
  };
}

function allProcessorOptions(rulePackage: RulePackage, catalog: Catalog) {
  return [
    ...rulePackage.processors.regexes.map((item) => ({ value: item.id, label: `${item.id} (regex)` })),
    ...rulePackage.processors.keywords.map((item) => ({ value: item.id, label: `${item.id} (keyword)` })),
    ...catalog.builtinFunctions.map((item) => ({ value: item.id, label: `${item.id} (function)` }))
  ].sort((a, b) => a.label.localeCompare(b.label));
}

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createTenantLoadCapsule(input: { userId: string; tenant: string; packageName: string }) {
  const now = new Date();
  const capsuleId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `capsule-${Date.now()}`;

  return {
    schemaVersion: "1.0",
    capsuleId,
    tenant: input.tenant,
    userId: input.userId,
    action: "SitRulePackageLoadFromTenant",
    params: {
      packageName: input.packageName
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    signature: `dummy-signature:${capsuleId}`
  };
}

function issueTone(level: ValidationIssue["level"]) {
  return level === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900";
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function ElementDetail({ element }: { element: ResolvedDetectionElement }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/60 dark:border-dark-3 dark:bg-dark/80 dark:shadow-none">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-900 dark:bg-sky-500/20 dark:text-sky-100">
          {element.type}
        </span>
        <h5 className="text-sm font-semibold text-slate-950 dark:text-white">{element.displayName}</h5>
      </div>
      {element.description ? <p className="mt-2 text-sm text-slate-700 dark:text-dark-7">{element.description}</p> : null}
      {element.actual.regex ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Regex</p>
          <pre className="mt-1 overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">{element.actual.regex}</pre>
        </div>
      ) : null}
      {element.actual.keywords && element.actual.keywords.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Keywords</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {element.actual.keywords.map((keyword) => (
              <span
                key={`${element.id}-${keyword}`}
                className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs text-slate-800 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-7"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {element.actual.keywordGroups && element.actual.keywordGroups.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Dictionary / Groups</p>
          {element.actual.keywordGroups.map((group, index) => (
            <div key={`${element.id}-group-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-dark-3 dark:bg-dark-2">
              <div className="flex flex-wrap gap-3 text-slate-700 dark:text-dark-7">
                <span>matchStyle: {group.matchStyle}</span>
                <span>caseSensitive: {group.caseSensitive ? "true" : "false"}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.terms.map((term) => (
                  <span
                    key={`${element.id}-group-${index}-${term}`}
                    className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-dark-3 dark:bg-dark dark:text-dark-7"
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {element.actual.functionReference ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Function</p>
          <p className="mt-1 text-sm text-slate-800 dark:text-dark-7">{element.actual.functionReference}</p>
        </div>
      ) : null}
      {element.validators.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Validators</p>
          {element.validators.map((validator) => (
            <div key={`${element.id}-${validator.id}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-dark-3 dark:bg-dark-2">
              <div className="font-semibold text-slate-900 dark:text-white">
                {validator.id} • score {validator.score}
              </div>
              <div className="mt-1 text-slate-700 dark:text-dark-7">{validator.reason}</div>
              {Object.keys(validator.metadata ?? {}).length > 0 ? (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white px-2 py-1 text-[11px] text-slate-700 dark:bg-dark dark:text-dark-7">
                  {JSON.stringify(validator.metadata, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-dark-6 sm:grid-cols-2">
        {Object.entries(element.validation.metadata ?? {}).map(([key, value]) => (
          <div key={`${element.id}-${key}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 dark:border-dark-3 dark:bg-dark-2">
            <span className="font-semibold text-slate-900 dark:text-white">{key}:</span> {formatEvidenceValue(value)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SitAccordionItem({
  sit,
  expanded,
  onToggle
}: {
  sit: SitDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-200/40 dark:border-dark-3 dark:bg-dark-2 dark:shadow-none">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-dark"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100">
              {sit.packageName}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-700 dark:bg-dark dark:text-dark-7">
              confidence {sit.recommendedConfidence}
            </span>
          </div>
          <h4 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{sit.name}</h4>
          <p className="mt-1 text-sm text-slate-600 dark:text-dark-6">
            Primary: {sit.primaryElement?.displayName ?? "n/a"} • Supporting: {sit.supportingElements.length}
          </p>
        </div>
        <span className="text-sm font-semibold text-primary">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {expanded ? (
        <div className="border-t border-slate-200 px-5 py-4 dark:border-dark-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">ID</p>
              <p className="mt-1 break-all text-slate-900 dark:text-white">{sit.id}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Publisher</p>
              <p className="mt-1 text-slate-900 dark:text-white">{sit.publisher}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Proximity / Logic</p>
              <p className="mt-1 text-slate-900 dark:text-white">
                {sit.proximity ?? "n/a"} / {sit.operator ?? "n/a"}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Thresholds</p>
              <p className="mt-1 text-slate-900 dark:text-white">
                min {sit.minMatches ?? "n/a"} • max {sit.maxMatches ?? "n/a"}
              </p>
            </div>
          </div>

          {sit.primaryElement ? (
            <div className="mt-4">
              <h5 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Primary Element</h5>
              <div className="mt-2">
                <ElementDetail element={sit.primaryElement} />
              </div>
            </div>
          ) : null}

          {sit.supportingElements.length > 0 ? (
            <div className="mt-4">
              <h5 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Supporting Elements</h5>
              <div className="mt-2 grid gap-3 xl:grid-cols-2">
                {sit.supportingElements.map((element, index) => (
                  <ElementDetail key={`${sit.id}-support-${element.id}-${index}`} element={element} />
                ))}
              </div>
            </div>
          ) : null}

          {sit.patterns.length > 0 ? (
            <div className="mt-4 space-y-3">
              <h5 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Patterns</h5>
              {sit.patterns.map((pattern) => (
                <div key={`${sit.id}-${pattern.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-dark-3 dark:bg-dark">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{pattern.name}</span>
                    <span className="text-xs text-slate-600 dark:text-dark-6">confidence {pattern.confidenceLevel}</span>
                    <span className="text-xs text-slate-600 dark:text-dark-6">proximity {pattern.proximity ?? "n/a"}</span>
                    <span className="text-xs text-slate-600 dark:text-dark-6">
                      min {pattern.minMatches ?? "n/a"} • max {pattern.maxMatches ?? "n/a"}
                    </span>
                  </div>
                  {Object.keys(pattern.evidence ?? {}).length > 0 ? (
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white px-3 py-2 text-xs text-slate-700 dark:bg-dark-2 dark:text-dark-7">
                      {JSON.stringify(pattern.evidence, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {sit.validationIssues.length > 0 ? (
            <div className="mt-4 space-y-2">
              <h5 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Validation Issues</h5>
              {sit.validationIssues.map((issue) => (
                <div key={`${sit.id}-${issue.path}-${issue.code}`} className={`rounded-xl border px-3 py-2 text-sm ${issueTone(issue.level)}`}>
                  <div className="font-semibold">{issue.code}</div>
                  <div>{issue.message}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-lg shadow-slate-200/60 dark:border-dark-3 dark:bg-dark-2 dark:shadow-none">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-dark-6">{description}</p>
      </div>
      {children}
    </section>
  );
}

function InputLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">{children}</label>;
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark-3 dark:bg-dark dark:text-white"
    />
  );
}

function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  readOnly = false
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark-3 dark:bg-dark dark:text-white"
    />
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  type = "button"
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}) {
  const className =
    variant === "primary"
      ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
      : "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:text-slate-400 dark:border-dark-3 dark:bg-dark dark:text-white";

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}

export default function SitBuilderWorkbench() {
  const [rulePackage, setRulePackage] = useState<RulePackage>(fallbackRulePackage);
  const [catalog, setCatalog] = useState<Catalog>(fallbackCatalog);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [importResult, setImportResult] = useState<SitImportResult | null>(null);
  const [xmlPreview, setXmlPreview] = useState("");
  const [xmlImportText, setXmlImportText] = useState("");
  const [status, setStatus] = useState("Loading SIT Builder template...");
  const [publishStatus, setPublishStatus] = useState("");
  const [tenantPackageName, setTenantPackageName] = useState("Microsoft Rule Package");
  const [dragActive, setDragActive] = useState(false);
  const [expandedSitIds, setExpandedSitIds] = useState<Record<string, boolean>>({});
  const [parallaxOffset, setParallaxOffset] = useState(0);
  const [msalReady, setMsalReady] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [preferRedirectAuth, setPreferRedirectAuth] = useState(false);
  const [activeCapsuleId, setActiveCapsuleId] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<WorkerPublishResult | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "validate" | "export" | "import" | "publish" | "tenantLoad">("");
  const msalRef = useRef<PublicClientApplicationType | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(buildApiUrl(apiBaseUrl, "/api/sit/template"));
        if (!response.ok) {
          throw new Error(`Template request failed: ${response.status}`);
        }
        const payload = (await response.json()) as TemplateResponse;
        if (cancelled) {
          return;
        }
        setRulePackage(payload.rulePackage);
        setIssues(payload.issues);
        setXmlPreview(payload.xml);
        setCatalog(payload.catalog);
        setImportResult(payload.importResult ?? null);
        setStatus("SIT Builder ready.");
      } catch (error) {
        if (!cancelled) {
          setStatus(`Using local fallback template: ${formatError(error)}`);
          setRulePackage(fallbackRulePackage);
          setCatalog(fallbackCatalog);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      setParallaxOffset(0);
      return undefined;
    }

    const handleScroll = () => {
      setParallaxOffset(Math.min(window.scrollY * 0.08, 48));
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const unsupportedReason = getMsalUnsupportedReason();
        if (unsupportedReason) {
          if (!cancelled) {
            setStatus((previous) => `${previous} Publish auth unavailable: ${unsupportedReason}`);
          }
          return;
        }

        const preferRedirect = shouldUseRedirectAuthFlow();
        setPreferRedirectAuth(preferRedirect);
        const client = new PublicClientApplication({
          auth: {
            clientId: aadClientId,
            authority: aadAuthority,
            redirectUri: window.location.origin,
            navigateToLoginRequestUrl: true
          },
          cache: {
            cacheLocation: preferRedirect ? "localStorage" : "sessionStorage"
          }
        });

        msalRef.current = client;
        await client.initialize();
        const redirectResult = await client.handleRedirectPromise();
        const accounts = redirectResult?.account ? [redirectResult.account] : client.getAllAccounts();
        if (cancelled) {
          return;
        }
        if (accounts.length > 0) {
          setAccount(accounts[0]);
        }
        setMsalReady(true);
      } catch (error) {
        if (!cancelled) {
          setPublishStatus(`Publish auth unavailable: ${formatError(error)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      msalRef.current = null;
    };
  }, []);

  const processorOptions = allProcessorOptions(rulePackage, catalog);

  function updateRulePackage(nextValue: RulePackage) {
    setRulePackage(nextValue);
    setPublishStatus("");
  }

  function applyImportPayload(payload: {
    rulePackage: RulePackage;
    issues: ValidationIssue[];
    xml: string;
    importResult?: SitImportResult;
  }) {
    setRulePackage(payload.rulePackage);
    setIssues(payload.issues);
    setXmlPreview(payload.xml);
    setImportResult(payload.importResult ?? null);
    setExpandedSitIds({});
  }

  async function importXmlDocument(xml: string, sourceLabel: string) {
    setBusyAction("import");
    setStatus(`Importing ${sourceLabel} rule package...`);
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/sit/import/xml"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `XML import failed: ${response.status}`);
      }
      setXmlImportText(xml);
      applyImportPayload(payload as { rulePackage: RulePackage; issues: ValidationIssue[]; xml: string; importResult?: SitImportResult });
      setStatus(`${sourceLabel} imported into the canonical SIT model.`);
    } catch (error) {
      setStatus(`XML import failed: ${formatError(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function importSelectedFile(file: File) {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".xml")) {
      setStatus("Only .xml rule package files are supported.");
      return;
    }

    if (file.size > maxUploadMb * 1024 * 1024) {
      setStatus(`File is too large. Limit is ${maxUploadMb} MB.`);
      return;
    }

    try {
      const xml = await readXmlFile(file);
      if (!xml) {
        throw new Error("Decoded file content is empty.");
      }
      await importXmlDocument(xml, "uploaded");
    } catch (error) {
      setStatus(`File import failed: ${formatError(error)}`);
    }
  }

  async function refreshValidation() {
    setBusyAction("validate");
    setStatus("Validating rule package...");
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/sit/validate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rulePackage })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Validation failed: ${response.status}`);
      }
      setRulePackage(payload.rulePackage as RulePackage);
      setIssues(payload.issues as ValidationIssue[]);
      setStatus(payload.isValid ? "Validation complete with no blocking issues." : "Validation returned issues.");
    } catch (error) {
      setStatus(`Validation failed: ${formatError(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function refreshXml() {
    setBusyAction("export");
    setStatus("Generating deterministic XML preview...");
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/sit/export/xml"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rulePackage })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `XML export failed: ${response.status}`);
      }
      setRulePackage(payload.rulePackage as RulePackage);
      setIssues(payload.issues as ValidationIssue[]);
      setXmlPreview(payload.xml as string);
      setStatus("XML preview refreshed.");
    } catch (error) {
      setStatus(`XML export failed: ${formatError(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function importXml() {
    await importXmlDocument(xmlImportText, "pasted XML");
  }

  async function signIn() {
    const msalClient = msalRef.current;
    if (!msalReady || !msalClient) {
      setPublishStatus("Microsoft sign-in is not ready.");
      return;
    }

    try {
      if (preferRedirectAuth) {
        await msalClient.loginRedirect({
          scopes: ["openid", "profile", apiScope],
          redirectStartPage: getRedirectStartPage()
        });
        return;
      }

      const result = await msalClient.loginPopup({ scopes: ["openid", "profile", apiScope] });
      setAccount(result.account);
      setPublishStatus(`Signed in as ${result.account?.username ?? "current user"}.`);
    } catch (error) {
      if (shouldFallbackToRedirect(error)) {
        await msalClient.loginRedirect({
          scopes: ["openid", "profile", apiScope],
          redirectStartPage: getRedirectStartPage()
        });
        return;
      }
      setPublishStatus(`Sign-in failed: ${formatError(error)}`);
    }
  }

  async function publishRulePackage() {
    const msalClient = msalRef.current;
    if (!account || !msalClient) {
      setPublishStatus("Sign in before publishing.");
      return;
    }

    setBusyAction("publish");
    setPublishStatus("Preparing publish capsule...");
    try {
      const exportResponse = await fetch(buildApiUrl(apiBaseUrl, "/api/sit/export/xml"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rulePackage })
      });
      const exportPayload = await exportResponse.json();
      if (!exportResponse.ok) {
        throw new Error(exportPayload.error ?? `XML export failed: ${exportResponse.status}`);
      }

      const token = await getAccessToken(msalClient, account, preferRedirectAuth);
      const capsule = createCapsule({
        userId: account.username,
        tenant: account.tenantId ?? "common",
        rulePackage: exportPayload.rulePackage as RulePackage,
        xml: exportPayload.xml as string
      });

      setActiveCapsuleId(capsule.capsuleId);
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/capsule"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(capsule)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Publish failed: ${response.status}`);
      }

      setRulePackage(exportPayload.rulePackage as RulePackage);
      setIssues(exportPayload.issues as ValidationIssue[]);
      setXmlPreview(exportPayload.xml as string);
      setPublishResult(payload.workerResult as WorkerPublishResult);
      setPublishStatus("Publish capsule submitted successfully.");
    } catch (error) {
      setPublishStatus(`Publish failed: ${formatError(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function loadRulePackageFromTenant() {
    const msalClient = msalRef.current;
    if (!account || !msalClient) {
      setPublishStatus("Sign in before loading a tenant rule package.");
      return;
    }

    setBusyAction("tenantLoad");
    setPublishStatus(`Loading '${tenantPackageName}' from tenant...`);
    try {
      const token = await getAccessToken(msalClient, account, preferRedirectAuth);
      const capsule = createTenantLoadCapsule({
        userId: account.username,
        tenant: account.tenantId ?? "common",
        packageName: tenantPackageName
      });
      setActiveCapsuleId(capsule.capsuleId);
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/capsule"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(capsule)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Tenant load failed: ${response.status}`);
      }

      const workerPayload = payload.workerResult as WorkerPublishResult;
      if (workerPayload.status === "capability_error") {
        throw new Error(workerPayload.error ?? "Tenant load capability is unavailable.");
      }
      if (!workerPayload.xml) {
        throw new Error(workerPayload.error ?? "Tenant load returned no XML payload.");
      }

      await importXmlDocument(workerPayload.xml, "tenant");
      setPublishStatus(`Loaded '${tenantPackageName}' from tenant and normalized it for review.`);
    } catch (error) {
      setPublishStatus(`Tenant load failed: ${formatError(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  function toggleSitExpanded(sitId: string) {
    setExpandedSitIds((previous) => ({
      ...previous,
      [sitId]: !previous[sitId]
    }));
  }

  function setAllSitPanels(expanded: boolean) {
    if (!importResult) {
      return;
    }
    setExpandedSitIds(Object.fromEntries(importResult.sits.map((sit) => [sit.id, expanded])));
  }

  return (
    <div className="relative space-y-6 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem]"
        style={{ transform: `translateY(${parallaxOffset}px)` }}
      >
        <div className="absolute left-[-8rem] top-8 h-56 w-56 rounded-full bg-cyan-200/50 blur-3xl dark:bg-cyan-500/10" />
        <div className="absolute right-[-6rem] top-20 h-64 w-64 rounded-full bg-amber-200/45 blur-3xl dark:bg-amber-500/10" />
        <div className="absolute inset-x-0 top-10 mx-auto h-72 max-w-5xl rounded-[3rem] bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 opacity-10 blur-3xl dark:from-slate-200 dark:via-slate-500 dark:to-slate-200" />
      </div>
      <Breadcrumb pageName="SIT Builder" />

      <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-200/50 backdrop-blur dark:border-dark-3 dark:bg-dark-2/95 dark:shadow-none">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Build / Import / Tenant</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">Sensitive Information Type Builder</h1>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-700 dark:text-dark-6">
          Review, normalize, and publish Purview-aligned rule packs in the existing SICO builder. XML paste, drag-and-drop
          upload, browse upload, and delegated tenant load all land in the same normalization pipeline.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionButton onClick={refreshValidation} disabled={busyAction !== ""}>
            {busyAction === "validate" ? "Validating..." : "Validate"}
          </ActionButton>
          <ActionButton onClick={refreshXml} disabled={busyAction !== ""} variant="secondary">
            {busyAction === "export" ? "Refreshing XML..." : "Refresh XML"}
          </ActionButton>
          <ActionButton
            onClick={() => downloadText(`${rulePackage.details.name || "sit-rule-package"}.xml`, xmlPreview)}
            disabled={xmlPreview.length === 0}
            variant="secondary"
          >
            Export XML
          </ActionButton>
        </div>
        <p className="mt-4 text-sm text-slate-700 dark:text-dark-6">{status}</p>
      </section>

      <Card
        title="Import Sources"
        description="Use paste, XML upload, or delegated tenant load. The builder editor below is updated from the same canonical import result."
      >
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
          <div className="space-y-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const file = event.dataTransfer.files?.[0];
                if (file) {
                  void importSelectedFile(file);
                }
              }}
              className={`rounded-[1.75rem] border border-dashed p-5 transition ${
                dragActive ? "border-primary bg-primary/5" : "border-slate-300 bg-slate-50 dark:border-dark-3 dark:bg-dark"
              }`}
            >
              <p className="text-sm font-semibold text-slate-950 dark:text-white">Drag and drop XML</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-dark-6">
                Supports Microsoft built-in packages and custom packages without using a separate parse path.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <ActionButton variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busyAction !== ""}>
                  Browse XML
                </ActionButton>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void importSelectedFile(file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
                <span className="self-center text-xs text-slate-500 dark:text-dark-6">Max {maxUploadMb} MB</span>
              </div>
            </div>

            <div className="space-y-2">
              <InputLabel>Paste XML</InputLabel>
              <TextArea
                value={xmlImportText}
                onChange={setXmlImportText}
                rows={12}
                placeholder="Paste a rule package XML document here. UTF-8 and UTF-16 exports are normalized on import."
              />
              <ActionButton onClick={importXml} disabled={busyAction !== "" || xmlImportText.trim().length === 0}>
                {busyAction === "import" ? "Importing..." : "Import XML"}
              </ActionButton>
            </div>
          </div>

          <div className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5 dark:border-dark-3 dark:bg-dark">
            <div className="space-y-2">
              <InputLabel>Load Rule Package From Tenant</InputLabel>
              <Input value={tenantPackageName} onChange={setTenantPackageName} placeholder="Microsoft Rule Package" />
              <p className="text-xs leading-5 text-slate-600 dark:text-dark-6">
                Delegated user auth starts in the dashboard, the backend stays headless, and the worker feature-detects
                `Connect-IPPSSession -AccessToken` before calling `Get-DlpSensitiveInformationTypeRulePackage`.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ActionButton onClick={account ? loadRulePackageFromTenant : signIn} disabled={busyAction !== "" || !msalReady}>
                {busyAction === "tenantLoad" ? "Loading..." : account ? "Load From Tenant" : "Sign In to Load"}
              </ActionButton>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-dark-3 dark:bg-dark-2">
              <div className="font-semibold text-slate-950 dark:text-white">{account ? account.username : "Not signed in"}</div>
              <div className="mt-1 text-slate-600 dark:text-dark-6">
                {publishStatus || "Tenant load returns a clean capability error when token-based IPPS connection is unavailable."}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {importResult ? (
        <Card
          title="Imported Sensitive Information Types"
          description="Inspect resolved primary and supporting elements for each SIT. Panels are collapsed by default to keep the view compact."
        >
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Package</p>
              <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{importResult.package.name}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Publisher</p>
              <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{importResult.package.publisherName}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">SIT Count</p>
              <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{importResult.stats.sitCount}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-dark">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-dark-6">Detectors</p>
              <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                {importResult.stats.regexCount} regex • {importResult.stats.keywordCount} keyword
              </p>
            </div>
          </div>

          {importResult.issues.length > 0 ? (
            <div className="mt-4 space-y-2">
              {importResult.issues.map((issue) => (
                <div key={`${issue.path}-${issue.code}`} className={`rounded-xl border px-3 py-2 text-sm ${issueTone(issue.level)}`}>
                  <div className="font-semibold">{issue.code}</div>
                  <div>{issue.message}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <ActionButton variant="secondary" onClick={() => setAllSitPanels(true)} disabled={importResult.sits.length === 0}>
              Expand All
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => setAllSitPanels(false)} disabled={importResult.sits.length === 0}>
              Collapse All
            </ActionButton>
          </div>

          <div className="mt-4 space-y-3">
            {importResult.sits.map((sit) => (
              <SitAccordionItem
                key={sit.id}
                sit={sit}
                expanded={expandedSitIds[sit.id] === true}
                onToggle={() => toggleSitExpanded(sit.id)}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title="Rule Package Overview"
        description="Define package metadata, localization defaults, schema versioning, and publishing identity."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <InputLabel>Package Name</InputLabel>
            <Input
              value={rulePackage.details.name}
              onChange={(value) =>
                updateRulePackage({
                  ...rulePackage,
                  details: { ...rulePackage.details, name: value }
                })
              }
            />
          </div>
          <div className="space-y-2">
            <InputLabel>Publisher Name</InputLabel>
            <Input
              value={rulePackage.details.publisherName}
              onChange={(value) =>
                updateRulePackage({
                  ...rulePackage,
                  details: { ...rulePackage.details, publisherName: value }
                })
              }
            />
          </div>
          <div className="space-y-2">
            <InputLabel>Rule Package ID</InputLabel>
            <Input value={rulePackage.id} onChange={(value) => updateRulePackage({ ...rulePackage, id: value })} />
          </div>
          <div className="space-y-2">
            <InputLabel>Publisher ID</InputLabel>
            <Input
              value={rulePackage.publisherId}
              onChange={(value) => updateRulePackage({ ...rulePackage, publisherId: value })}
            />
          </div>
          <div className="space-y-2">
            <InputLabel>Default Language</InputLabel>
            <Input
              value={rulePackage.defaultLangCode}
              onChange={(value) => updateRulePackage({ ...rulePackage, defaultLangCode: value })}
            />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(["major", "minor", "build", "revision"] as const).map((part) => (
              <div key={part} className="space-y-2">
                <InputLabel>{part}</InputLabel>
                <Input
                  type="number"
                  value={rulePackage.version[part]}
                  onChange={(value) =>
                    updateRulePackage({
                      ...rulePackage,
                      version: {
                        ...rulePackage.version,
                        [part]: Number(value) || 0
                      }
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div className="space-y-2 md:col-span-2">
            <InputLabel>Description</InputLabel>
            <TextArea
              value={rulePackage.details.description}
              onChange={(value) =>
                updateRulePackage({
                  ...rulePackage,
                  details: { ...rulePackage.details, description: value }
                })
              }
            />
          </div>
        </div>
      </Card>

      <Card
        title="Entities / Patterns"
        description="Model sensitive information types, confidence tiers, primary evidence, and supporting evidence groups."
      >
        <div className="space-y-4">
          {rulePackage.entities.map((entity, entityIndex) => (
            <article key={entity.id} className="rounded-xl border border-stroke p-4 dark:border-dark-3">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-dark dark:text-white">{entity.name || `Entity ${entityIndex + 1}`}</h3>
                <ActionButton
                  variant="secondary"
                  onClick={() =>
                    updateRulePackage({
                      ...rulePackage,
                      entities: rulePackage.entities.filter((_, index) => index !== entityIndex)
                    })
                  }
                >
                  Remove Entity
                </ActionButton>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <InputLabel>Entity Name</InputLabel>
                  <Input
                    value={entity.name}
                    onChange={(value) => {
                      const nextEntities = [...rulePackage.entities];
                      nextEntities[entityIndex] = { ...entity, name: value };
                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <InputLabel>Entity ID</InputLabel>
                  <Input
                    value={entity.id}
                    onChange={(value) => {
                      const nextEntities = [...rulePackage.entities];
                      nextEntities[entityIndex] = { ...entity, id: value };
                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                    }}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <InputLabel>Description</InputLabel>
                  <TextArea
                    value={entity.description}
                    onChange={(value) => {
                      const nextEntities = [...rulePackage.entities];
                      nextEntities[entityIndex] = { ...entity, description: value };
                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <InputLabel>Patterns Proximity</InputLabel>
                  <Input
                    type="number"
                    value={entity.patternsProximity}
                    onChange={(value) => {
                      const nextEntities = [...rulePackage.entities];
                      nextEntities[entityIndex] = { ...entity, patternsProximity: Number(value) || 0 };
                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <InputLabel>Recommended Confidence</InputLabel>
                  <Input
                    type="number"
                    value={entity.recommendedConfidence}
                    onChange={(value) => {
                      const nextEntities = [...rulePackage.entities];
                      nextEntities[entityIndex] = { ...entity, recommendedConfidence: Number(value) || 0 };
                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {entity.patterns.map((pattern, patternIndex) => (
                  <div key={pattern.id} className="rounded-lg border border-stroke p-4 dark:border-dark-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <InputLabel>Pattern Name</InputLabel>
                        <Input
                          value={pattern.name}
                          onChange={(value) => {
                            const nextEntities = [...rulePackage.entities];
                            const nextPatterns = [...entity.patterns];
                            nextPatterns[patternIndex] = { ...pattern, name: value };
                            nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                            updateRulePackage({ ...rulePackage, entities: nextEntities });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <InputLabel>Confidence Level</InputLabel>
                        <select
                          value={pattern.confidenceLevel}
                          onChange={(event) => {
                            const nextEntities = [...rulePackage.entities];
                            const nextPatterns = [...entity.patterns];
                            nextPatterns[patternIndex] = { ...pattern, confidenceLevel: Number(event.target.value) };
                            nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                            updateRulePackage({ ...rulePackage, entities: nextEntities });
                          }}
                          className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none dark:border-dark-3 dark:text-white"
                        >
                          {catalog.confidenceLevels.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <InputLabel>Primary Processor</InputLabel>
                        <select
                          value={pattern.primary.refId}
                          onChange={(event) => {
                            const nextEntities = [...rulePackage.entities];
                            const nextPatterns = [...entity.patterns];
                            nextPatterns[patternIndex] = {
                              ...pattern,
                              primary: { ...pattern.primary, refId: event.target.value }
                            };
                            nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                            updateRulePackage({ ...rulePackage, entities: nextEntities });
                          }}
                          className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none dark:border-dark-3 dark:text-white"
                        >
                          <option value="">Select primary processor</option>
                          {processorOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end justify-end">
                        <ActionButton
                          variant="secondary"
                          onClick={() => {
                            const nextEntities = [...rulePackage.entities];
                            nextEntities[entityIndex] = {
                              ...entity,
                              patterns: entity.patterns.filter((_, index) => index !== patternIndex)
                            };
                            updateRulePackage({ ...rulePackage, entities: nextEntities });
                          }}
                        >
                          Remove Pattern
                        </ActionButton>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-dark dark:text-white">Supporting Evidence</p>
                        <div className="flex gap-2">
                          <ActionButton
                            variant="secondary"
                            onClick={() => {
                              const nextEntities = [...rulePackage.entities];
                              const nextPatterns = [...entity.patterns];
                              nextPatterns[patternIndex] = {
                                ...pattern,
                                supporting: [
                                  ...pattern.supporting,
                                  {
                                    type: "match",
                                    match: {
                                      refId: "",
                                      refType: "keyword",
                                      minCount: 1,
                                      uniqueResults: false
                                    }
                                  }
                                ]
                              };
                              nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                              updateRulePackage({ ...rulePackage, entities: nextEntities });
                            }}
                          >
                            Add Match
                          </ActionButton>
                          <ActionButton
                            variant="secondary"
                            onClick={() => {
                              const nextEntities = [...rulePackage.entities];
                              const nextPatterns = [...entity.patterns];
                              nextPatterns[patternIndex] = {
                                ...pattern,
                                supporting: [
                                  ...pattern.supporting,
                                  {
                                    type: "any",
                                    minMatches: 1,
                                    maxMatches: null,
                                    children: [{ refId: "", refType: "keyword", minCount: 1, uniqueResults: false }]
                                  }
                                ]
                              };
                              nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                              updateRulePackage({ ...rulePackage, entities: nextEntities });
                            }}
                          >
                            Add Any Group
                          </ActionButton>
                        </div>
                      </div>

                      {pattern.supporting.map((clause, clauseIndex) => (
                        <div key={`${pattern.id}-${clauseIndex}`} className="rounded-lg border border-dashed border-stroke p-3 dark:border-dark-3">
                          {clause.type === "match" ? (
                            <div className="grid gap-3 md:grid-cols-4">
                              <div className="space-y-2 md:col-span-2">
                                <InputLabel>Supporting Processor</InputLabel>
                                <select
                                  value={clause.match.refId}
                                  onChange={(event) => {
                                    const nextEntities = [...rulePackage.entities];
                                    const nextPatterns = [...entity.patterns];
                                    const nextSupporting = [...pattern.supporting];
                                    nextSupporting[clauseIndex] = {
                                      type: "match",
                                      match: { ...clause.match, refId: event.target.value }
                                    };
                                    nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                    nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                    updateRulePackage({ ...rulePackage, entities: nextEntities });
                                  }}
                                  className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none dark:border-dark-3 dark:text-white"
                                >
                                  <option value="">Select supporting processor</option>
                                  {processorOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <InputLabel>Min Count</InputLabel>
                                <Input
                                  type="number"
                                  value={clause.match.minCount ?? 1}
                                  onChange={(value) => {
                                    const nextEntities = [...rulePackage.entities];
                                    const nextPatterns = [...entity.patterns];
                                    const nextSupporting = [...pattern.supporting];
                                    nextSupporting[clauseIndex] = {
                                      type: "match",
                                      match: { ...clause.match, minCount: Number(value) || 1 }
                                    };
                                    nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                    nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                    updateRulePackage({ ...rulePackage, entities: nextEntities });
                                  }}
                                />
                              </div>
                              <div className="flex items-end justify-between gap-2">
                                <label className="flex items-center gap-2 text-sm text-dark dark:text-white">
                                  <input
                                    type="checkbox"
                                    checked={clause.match.uniqueResults === true}
                                    onChange={(event) => {
                                      const nextEntities = [...rulePackage.entities];
                                      const nextPatterns = [...entity.patterns];
                                      const nextSupporting = [...pattern.supporting];
                                      nextSupporting[clauseIndex] = {
                                        type: "match",
                                        match: { ...clause.match, uniqueResults: event.target.checked }
                                      };
                                      nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                      nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                                    }}
                                  />
                                  Unique results
                                </label>
                                <ActionButton
                                  variant="secondary"
                                  onClick={() => {
                                    const nextEntities = [...rulePackage.entities];
                                    const nextPatterns = [...entity.patterns];
                                    nextPatterns[patternIndex] = {
                                      ...pattern,
                                      supporting: pattern.supporting.filter((_, index) => index !== clauseIndex)
                                    };
                                    nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                    updateRulePackage({ ...rulePackage, entities: nextEntities });
                                  }}
                                >
                                  Remove
                                </ActionButton>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-2">
                                  <InputLabel>Min Matches</InputLabel>
                                  <Input
                                    type="number"
                                    value={clause.minMatches}
                                    onChange={(value) => {
                                      const nextEntities = [...rulePackage.entities];
                                      const nextPatterns = [...entity.patterns];
                                      const nextSupporting = [...pattern.supporting];
                                      nextSupporting[clauseIndex] = {
                                        ...clause,
                                        minMatches: Number(value) || 1
                                      };
                                      nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                      nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <InputLabel>Max Matches</InputLabel>
                                  <Input
                                    type="number"
                                    value={clause.maxMatches ?? ""}
                                    onChange={(value) => {
                                      const nextEntities = [...rulePackage.entities];
                                      const nextPatterns = [...entity.patterns];
                                      const nextSupporting = [...pattern.supporting];
                                      nextSupporting[clauseIndex] = {
                                        ...clause,
                                        maxMatches: value.trim().length === 0 ? null : Number(value) || null
                                      };
                                      nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                      nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                                    }}
                                  />
                                </div>
                                <div className="flex items-end justify-end">
                                  <ActionButton
                                    variant="secondary"
                                    onClick={() => {
                                      const nextEntities = [...rulePackage.entities];
                                      const nextPatterns = [...entity.patterns];
                                      nextPatterns[patternIndex] = {
                                        ...pattern,
                                        supporting: pattern.supporting.filter((_, index) => index !== clauseIndex)
                                      };
                                      nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                      updateRulePackage({ ...rulePackage, entities: nextEntities });
                                    }}
                                  >
                                    Remove Group
                                  </ActionButton>
                                </div>
                              </div>
                              {clause.children.map((child, childIndex) => (
                                <div key={`${pattern.id}-${clauseIndex}-${childIndex}`} className="grid gap-3 md:grid-cols-4">
                                  <div className="space-y-2 md:col-span-2">
                                    <InputLabel>Child Processor</InputLabel>
                                    <select
                                      value={child.refId}
                                      onChange={(event) => {
                                        const nextEntities = [...rulePackage.entities];
                                        const nextPatterns = [...entity.patterns];
                                        const nextSupporting = [...pattern.supporting];
                                        const nextChildren = [...clause.children];
                                        nextChildren[childIndex] = { ...child, refId: event.target.value };
                                        nextSupporting[clauseIndex] = { ...clause, children: nextChildren };
                                        nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                        nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                        updateRulePackage({ ...rulePackage, entities: nextEntities });
                                      }}
                                      className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none dark:border-dark-3 dark:text-white"
                                    >
                                      <option value="">Select child processor</option>
                                      {processorOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <InputLabel>Min Count</InputLabel>
                                    <Input
                                      type="number"
                                      value={child.minCount ?? 1}
                                      onChange={(value) => {
                                        const nextEntities = [...rulePackage.entities];
                                        const nextPatterns = [...entity.patterns];
                                        const nextSupporting = [...pattern.supporting];
                                        const nextChildren = [...clause.children];
                                        nextChildren[childIndex] = { ...child, minCount: Number(value) || 1 };
                                        nextSupporting[clauseIndex] = { ...clause, children: nextChildren };
                                        nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                        nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                        updateRulePackage({ ...rulePackage, entities: nextEntities });
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-end justify-end">
                                    <ActionButton
                                      variant="secondary"
                                      onClick={() => {
                                        const nextEntities = [...rulePackage.entities];
                                        const nextPatterns = [...entity.patterns];
                                        const nextSupporting = [...pattern.supporting];
                                        const nextChildren = clause.children.filter((_, index) => index !== childIndex);
                                        nextSupporting[clauseIndex] = { ...clause, children: nextChildren };
                                        nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                        nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                        updateRulePackage({ ...rulePackage, entities: nextEntities });
                                      }}
                                    >
                                      Remove Child
                                    </ActionButton>
                                  </div>
                                </div>
                              ))}
                              <ActionButton
                                variant="secondary"
                                onClick={() => {
                                  const nextEntities = [...rulePackage.entities];
                                  const nextPatterns = [...entity.patterns];
                                  const nextSupporting = [...pattern.supporting];
                                  nextSupporting[clauseIndex] = {
                                    ...clause,
                                    children: [
                                      ...clause.children,
                                      { refId: "", refType: "keyword", minCount: 1, uniqueResults: false }
                                    ]
                                  };
                                  nextPatterns[patternIndex] = { ...pattern, supporting: nextSupporting };
                                  nextEntities[entityIndex] = { ...entity, patterns: nextPatterns };
                                  updateRulePackage({ ...rulePackage, entities: nextEntities });
                                }}
                              >
                                Add Child Match
                              </ActionButton>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <ActionButton
                  variant="secondary"
                  onClick={() => {
                    const nextEntities = [...rulePackage.entities];
                    nextEntities[entityIndex] = {
                      ...entity,
                      patterns: [
                        ...entity.patterns,
                        {
                          id: `pattern-${entity.patterns.length + 1}`,
                          name: `Pattern ${entity.patterns.length + 1}`,
                          confidenceLevel: 75,
                          primary: { refId: "", refType: "regex" },
                          supporting: []
                        }
                      ]
                    };
                    updateRulePackage({ ...rulePackage, entities: nextEntities });
                  }}
                >
                  Add Pattern
                </ActionButton>
              </div>
            </article>
          ))}

          <ActionButton
            variant="secondary"
            onClick={() => updateRulePackage({ ...rulePackage, entities: [...rulePackage.entities, createEntity()] })}
          >
            Add Entity
          </ActionButton>
        </div>
      </Card>

      <Card
        title="Processors / Validators"
        description="Manage reusable regexes, keywords, validators, and the built-in function catalog used by rule patterns."
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-dark dark:text-white">Regex Processors</h3>
              <ActionButton
                variant="secondary"
                onClick={() =>
                  updateRulePackage({
                    ...rulePackage,
                    processors: {
                      ...rulePackage.processors,
                      regexes: [...rulePackage.processors.regexes, createRegexProcessor()]
                    }
                  })
                }
              >
                Add Regex
              </ActionButton>
            </div>
            {rulePackage.processors.regexes.map((regex, index) => (
              <div key={regex.id} className="rounded-lg border border-stroke p-4 dark:border-dark-3">
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <InputLabel>Regex ID</InputLabel>
                    <Input
                      value={regex.id}
                      onChange={(value) => {
                        const nextRegexes = [...rulePackage.processors.regexes];
                        nextRegexes[index] = { ...regex, id: value };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, regexes: nextRegexes } });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel>Pattern</InputLabel>
                    <TextArea
                      value={regex.pattern}
                      rows={3}
                      onChange={(value) => {
                        const nextRegexes = [...rulePackage.processors.regexes];
                        nextRegexes[index] = { ...regex, pattern: value };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, regexes: nextRegexes } });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel>Validator IDs (comma separated)</InputLabel>
                    <Input
                      value={regex.validators.join(", ")}
                      onChange={(value) => {
                        const nextRegexes = [...rulePackage.processors.regexes];
                        nextRegexes[index] = {
                          ...regex,
                          validators: value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean)
                        };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, regexes: nextRegexes } });
                      }}
                    />
                  </div>
                  <div className="flex justify-end">
                    <ActionButton
                      variant="secondary"
                      onClick={() =>
                        updateRulePackage({
                          ...rulePackage,
                          processors: {
                            ...rulePackage.processors,
                            regexes: rulePackage.processors.regexes.filter((_, itemIndex) => itemIndex !== index)
                          }
                        })
                      }
                    >
                      Remove Regex
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-dark dark:text-white">Keyword Processors</h3>
              <ActionButton
                variant="secondary"
                onClick={() =>
                  updateRulePackage({
                    ...rulePackage,
                    processors: {
                      ...rulePackage.processors,
                      keywords: [...rulePackage.processors.keywords, createKeywordProcessor()]
                    }
                  })
                }
              >
                Add Keyword
              </ActionButton>
            </div>
            {rulePackage.processors.keywords.map((keyword, index) => (
              <div key={keyword.id} className="rounded-lg border border-stroke p-4 dark:border-dark-3">
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <InputLabel>Keyword ID</InputLabel>
                    <Input
                      value={keyword.id}
                      onChange={(value) => {
                        const nextKeywords = [...rulePackage.processors.keywords];
                        nextKeywords[index] = { ...keyword, id: value };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, keywords: nextKeywords } });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel>Match Style</InputLabel>
                    <Input
                      value={keyword.matchStyle}
                      onChange={(value) => {
                        const nextKeywords = [...rulePackage.processors.keywords];
                        nextKeywords[index] = { ...keyword, matchStyle: value };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, keywords: nextKeywords } });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel>Terms (one per line)</InputLabel>
                    <TextArea
                      value={keyword.terms.join("\n")}
                      rows={4}
                      onChange={(value) => {
                        const nextKeywords = [...rulePackage.processors.keywords];
                        nextKeywords[index] = {
                          ...keyword,
                          terms: value
                            .split(/\r?\n/)
                            .map((item) => item.trim())
                            .filter(Boolean)
                        };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, keywords: nextKeywords } });
                      }}
                    />
                  </div>
                  <div className="flex justify-end">
                    <ActionButton
                      variant="secondary"
                      onClick={() =>
                        updateRulePackage({
                          ...rulePackage,
                          processors: {
                            ...rulePackage.processors,
                            keywords: rulePackage.processors.keywords.filter((_, itemIndex) => itemIndex !== index)
                          }
                        })
                      }
                    >
                      Remove Keyword
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-dark dark:text-white">Validator Definitions</h3>
              <ActionButton
                variant="secondary"
                onClick={() =>
                  updateRulePackage({
                    ...rulePackage,
                    processors: {
                      ...rulePackage.processors,
                      validators: [...rulePackage.processors.validators, createValidatorDefinition()]
                    }
                  })
                }
              >
                Add Validator
              </ActionButton>
            </div>
            {rulePackage.processors.validators.map((validator, index) => (
              <div key={validator.id} className="rounded-lg border border-stroke p-4 dark:border-dark-3">
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <InputLabel>Validator ID</InputLabel>
                    <Input
                      value={validator.id}
                      onChange={(value) => {
                        const nextValidators = [...rulePackage.processors.validators];
                        nextValidators[index] = { ...validator, id: value };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, validators: nextValidators } });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel>Validator Type</InputLabel>
                    <select
                      value={validator.type}
                      onChange={(event) => {
                        const nextValidators = [...rulePackage.processors.validators];
                        nextValidators[index] = { ...validator, type: event.target.value };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, validators: nextValidators } });
                      }}
                      className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none dark:border-dark-3 dark:text-white"
                    >
                      {catalog.validatorTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <InputLabel>Parameters (name=value per line)</InputLabel>
                    <TextArea
                      value={validator.parameters.map((parameter) => `${parameter.name}=${parameter.value}`).join("\n")}
                      rows={4}
                      onChange={(value) => {
                        const nextValidators = [...rulePackage.processors.validators];
                        nextValidators[index] = {
                          ...validator,
                          parameters: value
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .map((line) => {
                              const [name, ...rest] = line.split("=");
                              return {
                                name: name.trim(),
                                value: rest.join("=").trim()
                              };
                            })
                            .filter((parameter) => parameter.name.length > 0)
                        };
                        updateRulePackage({ ...rulePackage, processors: { ...rulePackage.processors, validators: nextValidators } });
                      }}
                    />
                  </div>
                  <div className="flex justify-end">
                    <ActionButton
                      variant="secondary"
                      onClick={() =>
                        updateRulePackage({
                          ...rulePackage,
                          processors: {
                            ...rulePackage.processors,
                            validators: rulePackage.processors.validators.filter((_, itemIndex) => itemIndex !== index)
                          }
                        })
                      }
                    >
                      Remove Validator
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-stroke p-4 dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">Built-in Functions</h3>
              <ul className="mt-3 space-y-2 text-sm text-dark-5 dark:text-dark-6">
                {catalog.builtinFunctions.map((item) => (
                  <li key={item.id} className="rounded-md bg-gray-2 px-3 py-2 dark:bg-dark">
                    <span className="font-semibold text-dark dark:text-white">{item.id}</span>
                    <span className="ml-2">{item.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="XML Preview"
        description="Round-trip the canonical rule package into deterministic XML and import XML back into the editor state."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <InputLabel>Generated XML</InputLabel>
            <TextArea value={xmlPreview} onChange={() => undefined} rows={20} readOnly />
          </div>
          <div className="space-y-3">
            <InputLabel>Import XML</InputLabel>
            <TextArea
              value={xmlImportText}
              onChange={setXmlImportText}
              rows={20}
              placeholder="Paste a rule package XML document here to import it into the builder."
            />
            <ActionButton onClick={importXml} disabled={busyAction !== "" || xmlImportText.trim().length === 0}>
              {busyAction === "import" ? "Importing..." : "Import XML"}
            </ActionButton>
          </div>
        </div>
      </Card>

      <Card
        title="Validation"
        description="Review deterministic validation results before export or publish. Errors block a clean publish; warnings call out fidelity risks."
      >
        <div className="space-y-3">
          {issues.length === 0 ? (
            <p className="text-sm text-dark-5 dark:text-dark-6">No validation issues are currently reported.</p>
          ) : (
            issues.map((issue, index) => (
              <div
                key={`${issue.path}-${issue.code}-${index}`}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  issue.level === "error"
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                }`}
              >
                <div className="font-semibold uppercase tracking-wide">{issue.level}</div>
                <div className="mt-1">{issue.message}</div>
                <div className="mt-1 text-xs opacity-80">
                  {issue.path} | {issue.code}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card
        title="Publish / Deploy"
        description="Submit the current rule package through the existing SICO capsule flow for worker-backed publish simulation without affecting the existing testing workflows."
      >
        <div className="flex flex-wrap gap-3">
          <ActionButton onClick={signIn} disabled={!msalReady}>
            {account ? `Signed in: ${account.username}` : "Sign In for Publish"}
          </ActionButton>
          <ActionButton onClick={publishRulePackage} disabled={busyAction !== "" || !account}>
            {busyAction === "publish" ? "Publishing..." : "Publish Rule Package"}
          </ActionButton>
        </div>
        <p className="mt-4 text-sm text-dark-5 dark:text-dark-6">
          {publishStatus || "Publish uses the existing capsule API and a new SIT publish worker function, isolated from text extraction and data classification."}
        </p>
        {publishResult ? (
          <div className="mt-4 rounded-lg border border-stroke bg-gray-2 p-4 text-sm dark:border-dark-3 dark:bg-dark">
            <div className="font-semibold text-dark dark:text-white">{publishResult.status ?? "published"}</div>
            <div className="mt-1 text-dark-5 dark:text-dark-6">
              {publishResult.packageName} | {publishResult.packageId} | entities: {publishResult.entityCount ?? 0}
            </div>
            <div className="mt-1 text-dark-5 dark:text-dark-6">{publishResult.details}</div>
          </div>
        ) : null}
        <div className="mt-4">
          <LiveExecutionTerminal capsuleId={activeCapsuleId} apiBaseUrl={apiBaseUrl} />
        </div>
      </Card>
    </div>
  );
}

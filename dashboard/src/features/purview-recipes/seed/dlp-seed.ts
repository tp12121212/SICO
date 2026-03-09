import type { DlpRuleRecord } from "../types/dlp";

export const DLP_RULES_SEED: DlpRuleRecord[] = [
  {
    schema: "dlp-rule/v1",
    name: "Block External Sharing of High-Risk Passport Content",
    slug: "block-external-passport-high-risk",
    version: "1.0.0",
    description:
      "Blocks external sharing when high confidence passport-related SITs are detected and attachment scope includes external recipients.",
    rule_type: "content-match",
    scope: "exchange-online",
    conditions: {
      operator: "all",
      items: [
        { field: "sit.slug", op: "in", value: ["ae-passport-number", "au-passport-number"] },
        { field: "confidence", op: "gte", value: "high" },
        { field: "recipient.scope", op: "eq", value: "external" }
      ]
    },
    exceptions: {
      operator: "any",
      items: [{ field: "recipient.domain", op: "in", value: ["trusted-partner.example"] }]
    },
    actions: {
      block: true,
      notify_user: true,
      incident: { create: true, severity: "high" },
      apply_label: "PROTECTED"
    },
    policy_mode: "enforce",
    severity: "high",
    jurisdictions: ["au", "ae"],
    regulations: ["qgiscf", "privacy-act-1988-au"],
    related_sits: ["ae-passport-number", "au-passport-number"],
    labels: ["PROTECTED", "PII"],
    author: "sico-team",
    source: "seed",
    created: "2026-03-01",
    updated: "2026-03-07",
    metadata: {
      future_storage_hint: "candidate-for-policy-table",
      review_state: "draft"
    },
    notes: "Scaffold rule for early library browsing."
  },
  {
    schema: "dlp-rule/v1",
    name: "Audit Government Law-Enforcement Target Packages",
    slug: "audit-law-enforcement-target-packages",
    version: "1.0.0",
    description:
      "Audits use and movement of law-enforcement target package content to support incident triage and controlled handling.",
    rule_type: "content-match",
    scope: "sharepoint-online",
    conditions: {
      operator: "all",
      items: [
        { field: "sit.slug", op: "eq", value: "active-investigation-target-package" },
        { field: "confidence", op: "in", value: ["high", "medium"] }
      ]
    },
    exceptions: {
      operator: "any",
      items: [{ field: "site.tag", op: "eq", value: "law-enforcement-secure-zone" }]
    },
    actions: {
      block: false,
      notify_user: false,
      incident: { create: true, severity: "critical" },
      apply_label: "PROTECTED Law-Enforcement"
    },
    policy_mode: "audit",
    severity: "critical",
    jurisdictions: ["au"],
    regulations: ["ppra-2000-qld", "qgiscf"],
    related_sits: ["active-investigation-target-package"],
    labels: ["PROTECTED Law-Enforcement"],
    author: "sico-team",
    source: "seed",
    created: "2026-03-02",
    updated: "2026-03-07",
    metadata: {
      future_storage_hint: "candidate-for-policy-table",
      review_state: "draft"
    }
  }
];

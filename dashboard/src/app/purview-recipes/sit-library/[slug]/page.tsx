import Link from "next/link";
import { notFound } from "next/navigation";

import { FieldPillList } from "@/features/purview-recipes/components/field-pill-list";
import { JsonView } from "@/features/purview-recipes/components/json-view";
import { ReferencesList } from "@/features/purview-recipes/components/references-list";
import { SensitivityLabelsList } from "@/features/purview-recipes/components/sensitivity-labels-list";
import { getSitBySlug } from "@/features/purview-recipes/repositories/sit-repository";
import type { JsonObject, JsonValue } from "@/features/purview-recipes/types/sit";

function collectPurviewFunctions(purview: JsonObject | undefined): string[] {
  if (!purview) {
    return [];
  }

  const functions = new Set<string>();

  const patternValue = purview.pattern;
  if (patternValue && typeof patternValue === "object" && !Array.isArray(patternValue)) {
    const fn = (patternValue as Record<string, JsonValue>).function;
    if (typeof fn === "string" && fn.trim().length > 0) {
      functions.add(fn.trim());
    }
  }

  const tiersValue = purview.pattern_tiers;
  if (Array.isArray(tiersValue)) {
    for (const tier of tiersValue) {
      if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
        continue;
      }
      const idMatch = (tier as Record<string, JsonValue>).id_match;
      if (typeof idMatch === "string" && idMatch.trim().startsWith("Func_")) {
        functions.add(idMatch.trim());
      }
    }
  }

  return [...functions].sort((a, b) => a.localeCompare(b));
}

function resolveChecksum(purview: JsonObject | undefined): "Yes" | "No" | "N/A" {
  if (!purview) {
    return "N/A";
  }

  if (typeof purview.checksum === "boolean") {
    return purview.checksum ? "Yes" : "No";
  }

  const tiersValue = purview.pattern_tiers;
  if (Array.isArray(tiersValue)) {
    for (const tier of tiersValue) {
      if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
        continue;
      }
      const checksum = (tier as Record<string, JsonValue>).checksum;
      if (typeof checksum === "boolean") {
        return checksum ? "Yes" : "No";
      }
    }
  }

  return "N/A";
}

function buildCorroborativeEvidenceView(item: {
  provenance_type: "Built-in" | "Custom";
  purview?: JsonObject;
  corroborative_evidence?: JsonObject;
}): JsonObject | undefined {
  if (item.provenance_type !== "Built-in" || !item.purview) {
    return item.corroborative_evidence;
  }

  const keywordEntries: string[] = [];
  const keywordIds: string[] = [];
  const keywordsValue = item.purview.keywords;
  if (Array.isArray(keywordsValue)) {
    for (const keywordEntry of keywordsValue) {
      if (!keywordEntry || typeof keywordEntry !== "object" || Array.isArray(keywordEntry)) {
        continue;
      }
      const entry = keywordEntry as Record<string, JsonValue>;
      const id = entry.id;
      if (typeof id === "string" && id.trim().length > 0) {
        keywordIds.push(id.trim());
      }
      const groups = entry.groups;
      if (!Array.isArray(groups)) {
        continue;
      }
      for (const group of groups) {
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          continue;
        }
        const terms = (group as Record<string, JsonValue>).terms;
        if (!Array.isArray(terms)) {
          continue;
        }
        for (const term of terms) {
          if (typeof term === "string" && term.trim().length > 0) {
            keywordEntries.push(term.trim());
          }
        }
      }
    }
  }

  if (keywordEntries.length === 0) {
    return item.corroborative_evidence;
  }

  const proximity = item.purview.patterns_proximity;
  const uniqueKeywords = [...new Set(keywordEntries)].sort((a, b) => a.localeCompare(b));
  const uniqueKeywordIds = [...new Set(keywordIds)].sort((a, b) => a.localeCompare(b));
  const output: JsonObject = {
    keywords: uniqueKeywords,
    keyword_ids: uniqueKeywordIds
  };
  if (typeof proximity === "number") {
    output.proximity = proximity;
  }
  return output;
}

export default async function SitLibraryDetailPage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const resolved = await Promise.resolve(params);
  const item = await getSitBySlug(resolved.slug);

  if (!item) {
    notFound();
  }

  const functions = collectPurviewFunctions(item.purview);
  const checksum = resolveChecksum(item.purview);
  const isFunctionBased = functions.length > 0;
  const corroborativeEvidenceView = buildCorroborativeEvidenceView(item);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/purview-recipes/sit-library" className="text-xs text-primary hover:underline">
          Back to SIT Library
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">{item.name}</h1>
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          {item.slug} | v{item.version} | {item.type} | {item.engine}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Overview</h2>
          <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">{item.description || "No description."}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Confidence</p>
              <p className="text-sm text-slate-900 dark:text-slate-100">{item.confidence ?? "n/a"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Risk Rating</p>
              <p className="text-sm text-slate-900 dark:text-slate-100">{item.risk_rating ?? "n/a"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Scope</p>
              <p className="text-sm text-slate-900 dark:text-slate-100">{item.scope ?? "n/a"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Exports</p>
              <FieldPillList values={item.exports} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">Jurisdictions</p>
              <FieldPillList values={item.jurisdictions} tone="jurisdiction" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Regulations</p>
              <FieldPillList values={item.regulations} tone="regulation" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">Data Categories</p>
              <FieldPillList values={item.data_categories} tone="dataCategory" />
            </div>
          </div>
        </section>

        <aside className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Provenance</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate-700 dark:text-slate-300">Author</dt>
              <dd className="text-slate-900 dark:text-slate-100">{item.author ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-700 dark:text-slate-300">Source</dt>
              <dd className="text-slate-900 dark:text-slate-100">{item.source ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-700 dark:text-slate-300">Type</dt>
              <dd className="text-slate-900 dark:text-slate-100">{item.provenance_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-700 dark:text-slate-300">Created</dt>
              <dd className="text-slate-900 dark:text-slate-100">{item.created ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-700 dark:text-slate-300">Updated</dt>
              <dd className="text-slate-900 dark:text-slate-100">{item.updated ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-700 dark:text-slate-300">License</dt>
              <dd className="text-slate-900 dark:text-slate-100">{item.license ?? "n/a"}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Technical Detail</h2>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700" open>
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">Operation</summary>
          <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">{item.operation ?? "Not provided"}</p>
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700" open>
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">Pattern / Regex</summary>
          <div className="mt-2 space-y-2 text-xs text-slate-800 dark:text-slate-200">
            <p>
              <span className="font-semibold">Regex:</span>{" "}
              {isFunctionBased ? "N/A (function-based Microsoft built-in SIT)" : item.pattern || "Not provided"}
            </p>
            <p>
              <span className="font-semibold">Function:</span> {functions.length > 0 ? functions.join(", ") : "No"}
            </p>
            <p>
              <span className="font-semibold">Checksum:</span> {checksum}
            </p>
          </div>
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">Corroborative Evidence</summary>
          <JsonView value={corroborativeEvidenceView} />
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">Test Cases</summary>
          <JsonView value={item.test_cases} />
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">False Positives</summary>
          <JsonView value={item.false_positives} />
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">Purview Object</summary>
          <JsonView value={item.purview} />
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">References</summary>
          <ReferencesList references={item.references} />
        </details>

        <details className="mt-3 rounded-md border border-slate-300 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100">Sensitivity Labels</summary>
          <SensitivityLabelsList labels={item.sensitivity_labels} />
        </details>
      </section>
    </div>
  );
}

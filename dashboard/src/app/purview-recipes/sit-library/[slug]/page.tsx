import Link from "next/link";
import { notFound } from "next/navigation";

import { FieldPillList } from "@/features/purview-recipes/components/field-pill-list";
import { JsonView } from "@/features/purview-recipes/components/json-view";
import { getSitBySlug } from "@/features/purview-recipes/repositories/sit-repository";

export default async function SitLibraryDetailPage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const resolved = await Promise.resolve(params);
  const item = await getSitBySlug(resolved.slug);

  if (!item) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/purview-recipes/sit-library" className="text-xs text-primary hover:underline">
          Back to SIT Library
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-dark dark:text-white">{item.name}</h1>
        <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
          {item.slug} | v{item.version} | {item.type} | {item.engine}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-2 lg:col-span-2">
          <h2 className="text-base font-semibold text-dark dark:text-white">Overview</h2>
          <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">{item.description || "No description."}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Confidence</p>
              <p className="text-sm text-dark dark:text-white">{item.confidence ?? "n/a"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Risk Rating</p>
              <p className="text-sm text-dark dark:text-white">{item.risk_rating ?? "n/a"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Scope</p>
              <p className="text-sm text-dark dark:text-white">{item.scope ?? "n/a"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Exports</p>
              <FieldPillList values={item.exports} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Jurisdictions</p>
              <FieldPillList values={item.jurisdictions} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Regulations</p>
              <FieldPillList values={item.regulations} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">Data Categories</p>
              <FieldPillList values={item.data_categories} />
            </div>
          </div>
        </section>

        <aside className="rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-2">
          <h2 className="text-base font-semibold text-dark dark:text-white">Provenance</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-dark-5 dark:text-dark-6">Author</dt>
              <dd className="text-dark dark:text-white">{item.author ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-dark-5 dark:text-dark-6">Source</dt>
              <dd className="text-dark dark:text-white">{item.source ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-dark-5 dark:text-dark-6">Created</dt>
              <dd className="text-dark dark:text-white">{item.created ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-dark-5 dark:text-dark-6">Updated</dt>
              <dd className="text-dark dark:text-white">{item.updated ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs text-dark-5 dark:text-dark-6">License</dt>
              <dd className="text-dark dark:text-white">{item.license ?? "n/a"}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-2">
        <h2 className="text-base font-semibold text-dark dark:text-white">Technical Detail</h2>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3" open>
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">Operation</summary>
          <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">{item.operation ?? "Not provided"}</p>
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3" open>
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">Pattern / Regex</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-dark-5 dark:text-dark-6">{item.pattern ?? "Not provided"}</pre>
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3">
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">Corroborative Evidence</summary>
          <JsonView value={item.corroborative_evidence} />
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3">
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">Test Cases</summary>
          <JsonView value={item.test_cases} />
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3">
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">False Positives</summary>
          <JsonView value={item.false_positives} />
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3">
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">Purview Object</summary>
          <JsonView value={item.purview} />
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3">
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">References</summary>
          <JsonView value={item.references} />
        </details>

        <details className="mt-3 rounded-md border border-stroke p-3 dark:border-dark-3">
          <summary className="cursor-pointer text-sm font-medium text-dark dark:text-white">Sensitivity Labels</summary>
          <JsonView value={item.sensitivity_labels} />
        </details>
      </section>
    </div>
  );
}

import Link from "next/link";

import { FieldPillList } from "@/features/purview-recipes/components/field-pill-list";
import { QueryToolbar } from "@/features/purview-recipes/components/query-toolbar";
import { getSitLibrary } from "@/features/purview-recipes/repositories/sit-repository";

type SearchValue = string | string[] | undefined;

function single(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SitLibraryPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, SearchValue>> | Record<string, SearchValue>;
}) {
  const params = await Promise.resolve(searchParams ?? {});
  const query = {
    search: single(params.search),
    type: single(params.type),
    engine: single(params.engine),
    sort: single(params.sort) as "name_asc" | "name_desc" | "risk_desc" | "updated_desc" | undefined
  };

  const library = await getSitLibrary(query);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">SIT Library</h1>
        <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
          Browse normalized sensitive information type recipes. Source schema: {library.schemaVersion}.
        </p>
      </div>

      <QueryToolbar
        action="/purview-recipes/sit-library"
        search={query.search}
        sort={query.sort}
        sortOptions={[
          { value: "name_asc", label: "Name (A-Z)" },
          { value: "name_desc", label: "Name (Z-A)" },
          { value: "risk_desc", label: "Risk Rating (High-Low)" },
          { value: "updated_desc", label: "Updated (Newest)" }
        ]}
        filters={[
          {
            name: "type",
            selected: query.type,
            options: [{ value: "", label: "All Types" }, ...library.availableTypes.map((value) => ({ value, label: value }))]
          },
          {
            name: "engine",
            selected: query.engine,
            options: [{ value: "", label: "All Engines" }, ...library.availableEngines.map((value) => ({ value, label: value }))]
          }
        ]}
      />

      <div className="rounded-xl border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-2">
        <div className="mb-3 text-xs text-dark-5 dark:text-dark-6">
          Items: {library.items.length} | Source version: {library.sourceVersion}
        </div>

        <div className="space-y-3">
          {library.items.map((item) => (
            <article key={`${item.slug}-${item.version}`} className="rounded-lg border border-stroke p-4 dark:border-dark-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    <Link className="hover:underline" href={`/purview-recipes/sit-library/${item.slug}`}>
                      {item.name}
                    </Link>
                  </h2>
                  <p className="text-xs text-dark-5 dark:text-dark-6">
                    {item.slug} | v{item.version} | {item.type} | {item.engine}
                  </p>
                </div>
                <div className="text-right text-xs text-dark-5 dark:text-dark-6">
                  <div>Risk: {item.risk_rating ?? "n/a"}</div>
                  <div>Confidence: {item.confidence ?? "n/a"}</div>
                </div>
              </div>

              <p className="mt-3 text-sm text-dark-5 dark:text-dark-6">{item.description || "No description provided."}</p>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
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
            </article>
          ))}

          {library.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stroke p-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No SIT patterns found for the current filter.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import { JsonView } from "@/features/purview-recipes/components/json-view";
import { QueryToolbar } from "@/features/purview-recipes/components/query-toolbar";
import { getDlpLibrary } from "@/features/purview-recipes/repositories/dlp-repository";

type SearchValue = string | string[] | undefined;

function single(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DlpLibraryPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, SearchValue>> | Record<string, SearchValue>;
}) {
  const params = await Promise.resolve(searchParams ?? {});
  const query = {
    search: single(params.search),
    severity: single(params.severity),
    policy_mode: single(params.policy_mode),
    sort: single(params.sort) as "name_asc" | "name_desc" | "updated_desc" | undefined
  };

  const library = await getDlpLibrary(query);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">DLP Library</h1>
        <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
          Provisional DLP rule scaffold aligned to SIT recipe modeling for future shared persistence.
        </p>
      </div>

      <QueryToolbar
        action="/purview-recipes/dlp-library"
        search={query.search}
        sort={query.sort}
        sortOptions={[
          { value: "name_asc", label: "Name (A-Z)" },
          { value: "name_desc", label: "Name (Z-A)" },
          { value: "updated_desc", label: "Updated (Newest)" }
        ]}
        filters={[
          {
            name: "severity",
            selected: query.severity,
            options: [{ value: "", label: "All Severities" }, ...library.availableSeverities.map((value) => ({ value, label: value }))]
          },
          {
            name: "policy_mode",
            selected: query.policy_mode,
            options: [{ value: "", label: "All Modes" }, ...library.availablePolicyModes.map((value) => ({ value, label: value }))]
          }
        ]}
      />

      <div className="space-y-3">
        {library.items.map((item) => (
          <details key={item.slug} className="rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-2">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">{item.name}</h2>
                  <p className="text-xs text-dark-5 dark:text-dark-6">
                    {item.slug} | v{item.version} | {item.rule_type} | {item.scope}
                  </p>
                </div>
                <div className="text-right text-xs text-dark-5 dark:text-dark-6">
                  <div>Severity: {item.severity}</div>
                  <div>Mode: {item.policy_mode}</div>
                </div>
              </div>
              <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">{item.description}</p>
            </summary>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold text-dark dark:text-white">Conditions</h3>
                <JsonView value={item.conditions} />
              </section>
              <section>
                <h3 className="text-sm font-semibold text-dark dark:text-white">Exceptions</h3>
                <JsonView value={item.exceptions} />
              </section>
              <section>
                <h3 className="text-sm font-semibold text-dark dark:text-white">Actions</h3>
                <JsonView value={item.actions} />
              </section>
              <section>
                <h3 className="text-sm font-semibold text-dark dark:text-white">Metadata</h3>
                <JsonView value={item.metadata} />
              </section>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

import { SitLibraryBrowser } from "@/features/purview-recipes/components/sit-library-browser";
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
    author: single(params.author),
    sort: single(params.sort) as "name_asc" | "name_desc" | "risk_desc" | "updated_desc" | undefined
  };

  const library = await getSitLibrary();

  return (
    <SitLibraryBrowser
      schemaVersion={library.schemaVersion}
      sourceVersion={library.sourceVersion}
      items={library.items}
      availableTypes={library.availableTypes}
      availableEngines={library.availableEngines}
      availableAuthors={library.availableAuthors}
      initialQuery={query}
    />
  );
}

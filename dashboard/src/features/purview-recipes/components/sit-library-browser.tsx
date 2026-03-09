"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { NormalizedSitPattern, SitLibraryQuery } from "../types/sit";
import { FieldPillList } from "./field-pill-list";

type SitLibraryBrowserProps = {
  schemaVersion: string;
  sourceVersion: string;
  items: NormalizedSitPattern[];
  availableTypes: string[];
  availableEngines: string[];
  availableAuthors: string[];
  initialQuery?: SitLibraryQuery;
};

function applyQuery(items: NormalizedSitPattern[], query: SitLibraryQuery): NormalizedSitPattern[] {
  const search = (query.search ?? "").trim().toLowerCase();
  const type = (query.type ?? "").trim();
  const engine = (query.engine ?? "").trim();
  const author = (query.author ?? "").trim();
  const sort = query.sort ?? "name_asc";

  let filtered = items.filter((item) => {
    if (!search) {
      return true;
    }
    return [item.name, item.slug, item.description, item.type, item.engine, item.author ?? "", item.source ?? ""].some((field) =>
      field.toLowerCase().includes(search)
    );
  });

  if (type) {
    filtered = filtered.filter((item) => item.type === type);
  }
  if (engine) {
    filtered = filtered.filter((item) => item.engine === engine);
  }
  if (author) {
    filtered = filtered.filter((item) => (item.author ?? "") === author);
  }

  const sorted = [...filtered];
  switch (sort) {
    case "name_desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name) || b.slug.localeCompare(a.slug));
      break;
    case "risk_desc":
      sorted.sort((a, b) => {
        const aRisk = typeof a.risk_rating === "number" ? a.risk_rating : -1;
        const bRisk = typeof b.risk_rating === "number" ? b.risk_rating : -1;
        if (aRisk !== bRisk) {
          return bRisk - aRisk;
        }
        return a.name.localeCompare(b.name);
      });
      break;
    case "updated_desc":
      sorted.sort((a, b) => {
        const aUpdated = a.updated ?? "";
        const bUpdated = b.updated ?? "";
        if (aUpdated !== bUpdated) {
          return bUpdated.localeCompare(aUpdated);
        }
        return a.name.localeCompare(b.name);
      });
      break;
    case "name_asc":
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
      break;
  }

  return sorted;
}

export function SitLibraryBrowser({
  schemaVersion,
  sourceVersion,
  items,
  availableTypes,
  availableEngines,
  availableAuthors,
  initialQuery
}: SitLibraryBrowserProps) {
  const [search, setSearch] = useState(initialQuery?.search ?? "");
  const [type, setType] = useState(initialQuery?.type ?? "");
  const [engine, setEngine] = useState(initialQuery?.engine ?? "");
  const [author, setAuthor] = useState(initialQuery?.author ?? "");
  const [sort, setSort] = useState<SitLibraryQuery["sort"]>(initialQuery?.sort ?? "name_asc");

  const filteredItems = useMemo(
    () => applyQuery(items, { search, type, engine, author, sort }),
    [items, search, type, engine, author, sort]
  );

  const quickMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return [];
    }

    return items
      .filter((item) => item.name.toLowerCase().includes(needle) || item.slug.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [items, search]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">SIT Library</h1>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          Browse normalized sensitive information type recipes. Source schema: {schemaVersion}.
        </p>
      </div>

      <section className="mb-4 grid gap-3 rounded-lg border border-slate-300 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <input
              type="search"
              name="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, slug, description..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
          </div>

          <select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">All Types</option>
            {availableTypes.map((value) => (
              <option key={`type-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            name="engine"
            value={engine}
            onChange={(event) => setEngine(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">All Engines</option>
            {availableEngines.map((value) => (
              <option key={`engine-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            name="author"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">All Authors</option>
            {availableAuthors.map((value) => (
              <option key={`author-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            name="sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SitLibraryQuery["sort"])}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
            <option value="risk_desc">Risk Rating (High-Low)</option>
            <option value="updated_desc">Updated (Newest)</option>
          </select>
        </div>

        {quickMatches.length > 0 ? (
          <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Quick Matches</p>
            <div className="flex flex-wrap gap-2">
              {quickMatches.map((item) => (
                <Link
                  key={`quick-${item.slug}`}
                  className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                  href={`/purview-recipes/sit-library/${item.slug}`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 text-xs text-slate-700 dark:text-slate-300">
          Items: {filteredItems.length} | Source version: {sourceVersion}
        </div>

        <div className="space-y-3">
          {filteredItems.map((item) => (
            <article
              key={`${item.slug}-${item.version}`}
              className="rounded-lg border border-slate-300 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    <Link className="hover:underline" href={`/purview-recipes/sit-library/${item.slug}`}>
                      {item.name}
                    </Link>
                  </h2>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    {item.slug} | v{item.version} | {item.type} | {item.engine}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-700 dark:text-slate-300">
                  <div>Risk: {item.risk_rating ?? "n/a"}</div>
                  <div>Confidence: {item.confidence ?? "n/a"}</div>
                </div>
              </div>

              <p className="mt-3 text-sm text-slate-800 dark:text-slate-200">{item.description || "No description provided."}</p>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
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
            </article>
          ))}

          {filteredItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
              No SIT patterns found for the current filter.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

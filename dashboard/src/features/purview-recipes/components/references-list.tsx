import type { JsonValue } from "../types/sit";

type ReferenceItem = {
  title: string;
  url: string;
};

type ReferencesListProps = {
  references: JsonValue[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toReferenceItems(references: JsonValue[]): ReferenceItem[] {
  const result: ReferenceItem[] = [];

  for (const item of references) {
    if (typeof item === "string" && item.trim().length > 0) {
      const url = item.trim();
      result.push({ title: url, url });
      continue;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const titleValue = "title" in item ? item.title : undefined;
    const urlValue = "url" in item ? item.url : undefined;
    if (!isNonEmptyString(urlValue)) {
      continue;
    }

    const title = isNonEmptyString(titleValue) ? titleValue.trim() : urlValue.trim();
    result.push({ title, url: urlValue.trim() });
  }

  return result.sort((a, b) => a.title.localeCompare(b.title) || a.url.localeCompare(b.url));
}

export function ReferencesList({ references }: ReferencesListProps) {
  const items = toReferenceItems(references);
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No references provided.</p>;
  }

  return (
    <ul className="mt-3 space-y-3">
      {items.map((item) => (
        <li key={`${item.title}-${item.url}`} className="rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
          <a
            className="mt-1 inline-block text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

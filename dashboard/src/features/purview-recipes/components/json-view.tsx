import type { JsonValue } from "../types/sit";
import { normalizeJsonValue } from "../utils/normalize";

type JsonViewProps = {
  value: JsonValue | undefined;
  emptyLabel?: string;
};

export function JsonView({ value, emptyLabel = "Not provided" }: JsonViewProps) {
  if (value === undefined) {
    return <p className="text-xs text-slate-600 dark:text-slate-300">{emptyLabel}</p>;
  }

  const normalized = normalizeJsonValue(value);
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
      {JSON.stringify(normalized, null, 2)}
    </pre>
  );
}

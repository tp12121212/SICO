import type { JsonValue } from "../types/sit";
import { normalizeJsonValue } from "../utils/normalize";

type JsonViewProps = {
  value: JsonValue | undefined;
  emptyLabel?: string;
};

export function JsonView({ value, emptyLabel = "Not provided" }: JsonViewProps) {
  if (value === undefined) {
    return <p className="text-xs text-dark-5 dark:text-dark-6">{emptyLabel}</p>;
  }

  const normalized = normalizeJsonValue(value);
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-gray-2 p-3 text-xs text-dark-5 dark:bg-dark dark:text-dark-6">
      {JSON.stringify(normalized, null, 2)}
    </pre>
  );
}

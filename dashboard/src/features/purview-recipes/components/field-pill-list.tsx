type FieldPillListProps = {
  values: string[];
  emptyLabel?: string;
  tone?: "default" | "jurisdiction" | "regulation" | "dataCategory";
};

const toneClassMap: Record<NonNullable<FieldPillListProps["tone"]>, string> = {
  default: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200",
  jurisdiction: "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-100",
  regulation: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-100",
  dataCategory: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100"
};

export function FieldPillList({ values, emptyLabel = "Not specified", tone = "default" }: FieldPillListProps) {
  if (values.length === 0) {
    return <span className="text-xs text-slate-600 dark:text-slate-300">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${toneClassMap[tone]}`}>
          {value}
        </span>
      ))}
    </div>
  );
}

type FieldPillListProps = {
  values: string[];
  emptyLabel?: string;
};

export function FieldPillList({ values, emptyLabel = "Not specified" }: FieldPillListProps) {
  if (values.length === 0) {
    return <span className="text-xs text-dark-5 dark:text-dark-6">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full border border-stroke px-2 py-0.5 text-xs text-dark-5 dark:border-dark-3 dark:text-dark-6"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

type Option = {
  value: string;
  label: string;
};

type QueryToolbarProps = {
  action: string;
  search?: string;
  sort?: string;
  sortOptions: Option[];
  filters?: Array<{
    name: string;
    selected?: string;
    options: Option[];
  }>;
};

export function QueryToolbar({ action, search, sort, sortOptions, filters = [] }: QueryToolbarProps) {
  return (
    <form action={action} method="get" className="mb-4 grid gap-3 rounded-lg border border-stroke p-4 dark:border-dark-3">
      <div className="grid gap-3 md:grid-cols-3">
        <input
          type="search"
          name="search"
          defaultValue={search ?? ""}
          placeholder="Search name, slug, description..."
          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm dark:border-dark-3 dark:bg-dark"
        />

        {filters.map((filter) => (
          <select
            key={filter.name}
            name={filter.name}
            defaultValue={filter.selected ?? ""}
            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm dark:border-dark-3 dark:bg-dark"
          >
            {filter.options.map((option) => (
              <option key={`${filter.name}-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ))}

        <select
          name="sort"
          defaultValue={sort ?? sortOptions[0]?.value ?? "name_asc"}
          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm dark:border-dark-3 dark:bg-dark"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">
          Apply
        </button>
        <a href={action} className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium dark:border-dark-3">
          Reset
        </a>
      </div>
    </form>
  );
}

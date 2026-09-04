import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

/**
 * Minimal click-to-sort behavior shared by every admin/staff data table.
 * Pass the row array plus a map of column key -> value extractor; get
 * back the sorted array and a toggleSort/sortState pair to drive
 * SortableTh headers below. Numbers sort numerically, everything else
 * sorts as a locale-aware, numeric-substring-aware string compare (so
 * "2nd Year" sorts before "10th Year" the way a person would expect).
 * Nulls/blanks always sort last regardless of direction, and ties fall
 * back to original row order (stable) rather than swapping arbitrarily.
 *
 * Compose with usePaginatedList (PaginatedList.tsx) by feeding this
 * hook's `sorted` output in as that hook's `items` argument — sort runs
 * before search/pagination.
 */
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string | null;
  direction: SortDirection;
}

/** Just the {sortState, toggleSort} pair, with no array to sort client-side — for a table whose sort must run on the server (see useServerSort below), where useSort's own state management would otherwise be duplicated. */
export function useSortState(initial: SortState = { key: null, direction: "asc" }) {
  const [sortState, setSortState] = useState<SortState>(initial);

  function toggleSort(key: string) {
    setSortState(prev => (prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
  }

  return { sortState, toggleSort };
}

export function useSort<T>(
  rows: T[],
  extractors: Record<string, (row: T) => string | number | null | undefined>,
  initial: SortState = { key: null, direction: "asc" },
) {
  const { sortState, toggleSort } = useSortState(initial);

  const sorted = useMemo(() => {
    const extract = sortState.key ? extractors[sortState.key] : undefined;
    if (!extract) return rows;
    const withKeys = rows.map((row, i) => ({ row, i, value: extract(row) }));
    withKeys.sort((a, b) => {
      if (a.value == null && b.value == null) return a.i - b.i;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      let cmp = typeof a.value === "number" && typeof b.value === "number"
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
      if (cmp === 0) cmp = a.i - b.i;
      return sortState.direction === "asc" ? cmp : -cmp;
    });
    return withKeys.map(w => w.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortState.key, sortState.direction]);

  return { sorted, sortState, toggleSort };
}

/**
 * Drop-in replacement for a plain `<th>` — pass the same className the
 * header cell already had. Renders the label with a small chevron
 * (up/down when this column is the active sort, a faint neutral
 * up-down glyph otherwise) per the "minimalist, small arrow beside the
 * header" ask, rather than a separate sort control/toolbar.
 */
export function SortableTh({
  label, sortKey, sortState, onSort, className,
}: {
  label: string;
  sortKey: string;
  sortState: SortState;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sortState.key === sortKey;
  return (
    <th className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-current">
        <span>{label}</span>
        {active ? (
          sortState.direction === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
        ) : (
          <ChevronsUpDown size={11} className="opacity-30" />
        )}
      </button>
    </th>
  );
}

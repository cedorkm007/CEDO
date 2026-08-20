import { useMemo, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

/**
 * Shared pagination + text-filter behavior for any list view in the app.
 * Usage:
 *   const { paged, search, setSearch, page, setPage, totalPages, pageSize } =
 *     usePaginatedList(items, { searchKeys: ["name", "email"] });
 *   ...render paged instead of items...
 *   <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
 */

export const DEFAULT_PAGE_SIZE = 50;

export function usePaginatedList<T>(
  items: T[],
  options?: {
    /** Object keys to text-match against `search` (case-insensitive substring). */
    searchKeys?: (keyof T)[];
    /** Optional extra predicate, applied in addition to the text search (e.g. a dropdown filter). */
    filterFn?: (item: T) => boolean;
    pageSize?: number;
  }
) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const [search, setSearchRaw] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let result = items;
    if (options?.filterFn) result = result.filter(options.filterFn);
    const term = search.trim().toLowerCase();
    if (term && options?.searchKeys?.length) {
      result = result.filter(item =>
        options.searchKeys!.some(key => {
          const value = item[key];
          return value != null && String(value).toLowerCase().includes(term);
        })
      );
    }
    return result;
  }, [items, search, options?.filterFn, options?.searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  function setSearch(value: string) {
    setSearchRaw(value);
    setPage(1); // reset to page 1 whenever the filter changes
  }

  return {
    paged,
    filteredCount: filtered.length,
    totalCount: items.length,
    search,
    setSearch,
    page: safePage,
    setPage,
    totalPages,
    pageSize,
  };
}

export function ListSearchBox({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="max-w-xs"
    />
  );
}

export function ListPagination({
  page,
  totalPages,
  onPageChange,
  filteredCount,
  pageSize,
  itemLabel = "results",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  filteredCount: number;
  pageSize: number;
  /** What each row actually represents, for when "results" is ambiguous —
   * e.g. "attempt records" on a log where one scholar can have several
   * rows, so it's clear the count/pagination is per-row, not per-scholar.
   * Optional and defaults to the prior generic wording; every existing
   * caller is unaffected unless it opts in. */
  itemLabel?: string;
}) {
  if (filteredCount === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, filteredCount);
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm text-muted-foreground">
      <span>
        Showing {start}–{end} of {filteredCount} {itemLabel}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

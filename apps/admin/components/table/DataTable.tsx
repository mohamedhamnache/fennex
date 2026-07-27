import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DataTableColumn<T> {
  /** Unique column id. Used as the React key and, when `render` is omitted,
   * as the property read off each row. */
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Numeric/ID columns — applies `font-mono tabular-nums`. */
  mono?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable row key. Defaults to the row's index — pass this whenever rows
   * can reorder (pagination, sorting) so React doesn't misattribute state. */
  rowKey?: (row: T, index: number) => string | number;
  loading?: boolean;
  /** Custom empty state, shown when `!loading && rows.length === 0`.
   * Defaults to a generic "No results." message — pass something specific
   * (e.g. "No organizations match these filters.") wherever the caller can. */
  empty?: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  /** Right-aligned slot above the table — search, filters, export. */
  toolbar?: ReactNode;
  className?: string;
  /** Makes rows clickable (cursor pointer, Enter/Space activation) — e.g.
   * opening a details drawer. Omit for tables where rows aren't actionable. */
  onRowClick?: (row: T) => void;
}

const ALIGN_CLASS: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const SKELETON_ROWS = 6;

/**
 * Dense, dark-first data table for the admin console. Presentation only —
 * callers own fetching, filtering, and page state; this just renders
 * `rows`/`loading`/pagination props. Mirrors the `card-base` styling used by
 * `StatCard`/`ChartCard` so tables sit visually consistent with the rest of
 * the console.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  page,
  pageSize,
  total,
  onPageChange,
  toolbar,
  className,
  onRowClick,
}: DataTableProps<T>) {
  const hasPagination =
    typeof page === "number" &&
    typeof pageSize === "number" &&
    typeof total === "number" &&
    !!onPageChange;
  const pageCount = hasPagination ? Math.max(1, Math.ceil(total! / pageSize!)) : 1;
  const isEmpty = !loading && rows.length === 0;

  return (
    <div
      className={cn(
        "card-base card-shadow flex flex-col gap-3 border border-border bg-card p-4",
        className,
      )}
    >
      {toolbar && <div className="flex items-center justify-end gap-2">{toolbar}</div>}

      {/* Horizontal overflow is contained here, inside the card — the page
       * itself never scrolls sideways for a wide table. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3 py-2.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground",
                    ALIGN_CLASS[col.align ?? "left"],
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-border last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2.5">
                      <div className="skeleton h-4 w-full max-w-[10rem]" />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && isEmpty && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-12">
                  {empty ?? (
                    <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                      <Inbox className="h-5 w-5" aria-hidden="true" />
                      <span className="text-sm">No results.</span>
                    </div>
                  )}
                </td>
              </tr>
            )}

            {!loading &&
              !isEmpty &&
              rows.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : i}
                  tabIndex={0}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-border outline-none transition-colors duration-150 last:border-0 hover:bg-accent/40 focus-visible:bg-accent/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2.5 text-foreground",
                        ALIGN_CLASS[col.align ?? "left"],
                        col.mono && "font-mono tabular-nums",
                      )}
                    >
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {hasPagination && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {total === 0
              ? "0 results"
              : `${(page! - 1) * pageSize! + 1}-${Math.min(page! * pageSize!, total!)} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPageChange!(page! - 1)}
              disabled={page! <= 1}
              aria-label="Previous page"
              className="inline-flex h-9 min-h-[40px] w-9 min-w-[40px] cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-[4.5rem] text-center font-mono text-xs tabular-nums text-muted-foreground">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => onPageChange!(page! + 1)}
              disabled={page! >= pageCount}
              aria-label="Next page"
              className="inline-flex h-9 min-h-[40px] w-9 min-w-[40px] cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

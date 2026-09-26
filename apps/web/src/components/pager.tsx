import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const PAGE_SIZES = [20, 50, 100] as const;

/** Previous / next, where we are, and how many per page. Hidden when everything fits. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  label = "items",
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= PAGE_SIZES[0] && page === 1) return null;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} of {total} {label}
      </span>
      <div className="flex items-center gap-1">
        <label className="mr-2 flex items-center gap-1">
          Per page
          <select
            className="h-7 rounded-md border bg-background px-1.5 text-foreground"
            value={pageSize}
            onChange={(e) => {
              onPageSize(Number(e.target.value));
              onPage(1);
            }}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="px-1.5 tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

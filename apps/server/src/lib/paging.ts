import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** ?page=1&pageSize=20 (at most 100). */
export const pagingQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type Paging = z.infer<typeof pagingQuery>;

export const offsetOf = (p: Paging) => (p.page - 1) * p.pageSize;

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export const pageOf = <T>(items: T[], total: number, p: Paging): Page<T> => ({ items, total, page: p.page, pageSize: p.pageSize });

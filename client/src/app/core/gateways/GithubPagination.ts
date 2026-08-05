// Direct port of web/src/api/client.ts's paginate/paginateArray helpers.

/** Follows GitHub's page-numbered list responses until every item has been collected. */
export async function Paginate<TItem>(
  fetchPage: (page: number) => Promise<{ totalCount: number; items: TItem[] }>,
): Promise<TItem[]> {
  const all: TItem[] = [];
  let page = 1;
  while (true) {
    const { totalCount, items } = await fetchPage(page);
    all.push(...items);
    if (items.length === 0 || all.length >= totalCount) break;
    page += 1;
  }
  return all;
}

/** Follows GitHub's bare-array list endpoints (Link-header pagination) by page size. */
export async function PaginateArray<TItem>(fetchPage: (page: number) => Promise<TItem[]>): Promise<TItem[]> {
  const all: TItem[] = [];
  let page = 1;
  while (true) {
    const items = await fetchPage(page);
    all.push(...items);
    if (items.length < 100) break;
    page += 1;
  }
  return all;
}

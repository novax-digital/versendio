/** Sheets from page count: duplex prints two pages per physical sheet. */
export function sheetsFromPages(pageCount: number, isDuplex: boolean): number {
  if (pageCount <= 0) return 0;
  return isDuplex ? Math.ceil(pageCount / 2) : pageCount;
}

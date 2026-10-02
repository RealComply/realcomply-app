// An in-memory stand-in for the parts of the Supabase query builder the cron
// jobs use: filters, then awaited (many rows), maybeSingle (one) or insert.
// Tests only. Rows are plain objects in `tables`, so a test can read what a
// job wrote straight back out of them.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: null };

export function fakeSupabase<T>(tables: Record<string, Row[]>): T {
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const query = {
      select: () => query,
      order: () => query,
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return query;
      },
      is: (col: string, value: unknown) => {
        filters.push((r) => (r[col] ?? null) === value);
        return query;
      },
      in: (col: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[col]));
        return query;
      },
      maybeSingle: (): Promise<Result> => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      insert: (row: Row): Promise<{ error: null }> => {
        (tables[table] ??= []).push(row);
        return Promise.resolve({ error: null });
      },
      then: <U>(resolve: (r: Result) => U, reject?: (e: unknown) => U) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return query;
  }
  return { from } as unknown as T;
}

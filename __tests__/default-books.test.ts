import { defaultBookId } from "@/lib/utils/default-books";

// In-memory stand-in for the books table: enforces the primary key the way
// Postgres does and yields between the "any books?" read and the insert so
// concurrent callers interleave like separate browser tabs.
function fakeClient(rows: Array<Record<string, unknown>>) {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const calls = { selects: 0, upserts: 0 };
  const client = {
    from: () => ({
      select: () => ({
        eq: (_col: string, userId: string) => ({
          limit: async () => {
            calls.selects++;
            await tick();
            return { data: rows.filter((r) => r.user_id === userId).map((r) => ({ id: r.id })), error: null };
          },
        }),
      }),
      upsert: async (row: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }) => {
        calls.upserts++;
        await tick();
        if (rows.some((r) => r.id === row.id)) {
          if (opts.ignoreDuplicates) return { error: null };
          return { error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(row);
        return { error: null };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `http://127.0.0.1:54321/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  };
  return { client: client as never, calls };
}

// Each isolated module instance has its own in-flight map: a separate tab.
function freshModule(): typeof import("@/lib/utils/default-books") {
  let mod!: typeof import("@/lib/utils/default-books");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- isolateModules needs a synchronous require
    mod = require("@/lib/utils/default-books") as typeof import("@/lib/utils/default-books");
  });
  return mod;
}

const USER = "6f1d2c4e-0000-4000-8000-000000000001";

describe("default book provisioning", () => {
  test("default book id is a stable, valid, per-user UUID", async () => {
    const a = await defaultBookId(USER);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await defaultBookId(USER)).toBe(a);
    expect(await defaultBookId("6f1d2c4e-0000-4000-8000-000000000002")).not.toBe(a);
  });

  test("concurrent calls in one page share a single run and insert one book", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const { client, calls } = fakeClient(rows);
    const { setupDefaultBooks } = freshModule();
    await Promise.all(Array.from({ length: 8 }, () => setupDefaultBooks(USER, client)));
    expect(rows).toHaveLength(1);
    expect(calls.selects).toBe(1);
    expect(calls.upserts).toBe(1);
  });

  test("concurrent runs from separate tabs still leave exactly one book", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const { client, calls } = fakeClient(rows);
    const tabs = Array.from({ length: 5 }, freshModule);
    await Promise.all(tabs.map((tab) => tab.setupDefaultBooks(USER, client)));
    // Every tab saw an empty library and tried to insert; the primary key
    // turned all but the first insert into no-ops.
    expect(calls.upserts).toBe(5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: await defaultBookId(USER), user_id: USER, title: "Sample PDF Book" });
  });

  test("a user who already has books gets nothing new", async () => {
    const rows: Array<Record<string, unknown>> = [{ id: "existing", user_id: USER }];
    const { client, calls } = fakeClient(rows);
    await freshModule().setupDefaultBooks(USER, client);
    expect(rows).toHaveLength(1);
    expect(calls.upserts).toBe(0);
  });

  test("a later run after completion is a no-op", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const { client } = fakeClient(rows);
    const mod = freshModule();
    await mod.setupDefaultBooks(USER, client);
    await mod.setupDefaultBooks(USER, client);
    expect(rows).toHaveLength(1);
  });
});

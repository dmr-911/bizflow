import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { MIGRATIONS, type Migration } from "./migrations";

/*
 * Storage layout: one Postgres database (Neon in production). Accounts, logins
 * and billing are ordinary tables; every business table carries account_id and
 * every business query filters on it. Composite keys (account_id, id) and
 * composite foreign keys mean a row can only ever point at rows of the same
 * business, so one account can never read or link another account's data.
 *
 * Conventions for SQL in the services: `$1` is always the account id in
 * business queries, and camelCase aliases are double-quoted ("customerId").
 */

// COUNT, SUM and BIGINT columns arrive as strings by default. Every value we store
// fits comfortably in a double (money is minor units, ids are sequence numbers).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

type Conn = pg.Pool | pg.PoolClient;

/** Thin async wrapper over a pool or, inside `tx`, a single transaction's client. */
export class Db {
  constructor(
    protected readonly conn: Conn,
    readonly inTransaction = false,
  ) {}

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return (await this.query(sql, params)).rows as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return (await this.query(sql, params)).rows[0] as T | undefined;
  }

  /** Returns the number of rows changed. */
  async run(sql: string, ...params: unknown[]): Promise<number> {
    return (await this.query(sql, params)).rowCount ?? 0;
  }

  // A transaction's client runs one query at a time; queue them so Promise.all inside tx is safe.
  private queue: Promise<unknown> = Promise.resolve();

  private query(sql: string, params: unknown[]): Promise<pg.QueryResult> {
    // Ids parsed from URLs and forms can be NaN. Bind those as NULL so they match nothing
    // (as SQLite did) instead of failing with "invalid input syntax for type bigint".
    const values = params.map((p) => (typeof p === "number" && !Number.isFinite(p) ? null : p));
    if (!this.inTransaction) return this.conn.query(sql, values);
    const result = this.queue.then(() => this.conn.query(sql, values));
    this.queue = result.catch(() => {});
    return result;
  }

  /** Run fn in one transaction. Nested calls join the outer transaction. */
  async tx<T>(fn: (db: this) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const client = await (this.conn as pg.Pool).connect();
    try {
      await client.query("BEGIN");
      const db = this.bind(client);
      await db.onBegin();
      const result = await fn(db);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  protected bind(client: pg.PoolClient): this {
    return new Db(client, true) as this;
  }

  protected async onBegin(): Promise<void> {}
}

/** The database as seen by one business. Services must filter every query on `accountId`. */
export class TenantDb extends Db {
  constructor(
    conn: Conn,
    readonly accountId: number,
    inTransaction = false,
  ) {
    super(conn, inTransaction);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("Invalid account id");
  }

  protected bind(client: pg.PoolClient): this {
    return new TenantDb(client, this.accountId, true) as this;
  }

  /**
   * Writes for one business run one at a time, like they did with a SQLite file per
   * business. This keeps read-then-write steps (document numbering, payment totals) safe
   * when two requests for the same business arrive together. Other businesses are not blocked.
   */
  protected async onBegin(): Promise<void> {
    await this.conn.query("SELECT pg_advisory_xact_lock($1, $2)", [TENANT_LOCK, this.accountId]);
  }
}

const TENANT_LOCK = 1;
const MIGRATION_LOCK = 2;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See docs/SETUP.md (Create the Neon database).");
  return url;
}

/**
 * Neon's copy-paste strings say sslmode=require. node-postgres already treats that as
 * verify-full (check the certificate and host name) and warns that pg 9 will weaken it;
 * spell it out so behaviour stays the same and the warning goes away.
 */
function strictSsl(connectionString: string): string {
  if (/[?&]uselibpqcompat=/.test(connectionString)) return connectionString;
  return connectionString.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, "$1verify-full");
}

export function createPool(connectionString = databaseUrl(), extra: pg.PoolConfig = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: strictSsl(connectionString),
    // Serverless functions each hold their own pool, so keep it small; Neon's pooler does the fan-in.
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000, // a Neon compute that scaled to zero takes a moment to wake
    ...extra,
  });
  // An idle client dropped by the server must not crash the process.
  pool.on("error", (e) => console.error("Postgres pool error", e.message));
  return pool;
}

// The pool lives for the server process and survives dev hot reloads.
const globalForDb = globalThis as unknown as { __bizflowPool?: pg.Pool; __bizflowReady?: Promise<void> };

export function getPool(): pg.Pool {
  return (globalForDb.__bizflowPool ??= createPool());
}

/** Use a specific pool, e.g. a per-test schema. Resets the migration check. */
export function setPool(pool: pg.Pool): void {
  globalForDb.__bizflowPool = pool;
  globalForDb.__bizflowReady = undefined;
}

export async function closePool(): Promise<void> {
  const pool = globalForDb.__bizflowPool;
  globalForDb.__bizflowPool = undefined;
  globalForDb.__bizflowReady = undefined;
  await pool?.end();
}

/** Migrates once per process, on first use, so a fresh database just works. */
function ready(): Promise<void> {
  return (globalForDb.__bizflowReady ??= migrate(getPool()).then(
    () => {},
    (e) => {
      globalForDb.__bizflowReady = undefined;
      throw e;
    },
  ));
}

/** Accounts, logins and billing. */
export async function getDb(): Promise<Db> {
  await ready();
  return new Db(getPool());
}

/** One business's view of the database. */
export async function getTenantDb(accountId: number): Promise<TenantDb> {
  await ready();
  return new TenantDb(getPool(), accountId);
}

/**
 * Apply pending migrations in one transaction. A transaction-scoped advisory lock
 * makes concurrent cold starts wait for each other, and works through Neon's pooler.
 */
export async function migrate(pool: pg.Pool, migrations: Migration[] = MIGRATIONS): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    );
    const applied = new Set((await client.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    let count = 0;
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1, $2, $3)", [m.id, m.name, new Date().toISOString()]);
      count++;
    }
    await client.query("COMMIT");
    return count;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * After rows were inserted with explicit ids (restore, SQLite import), move each
 * identity sequence past the highest id so new rows never collide.
 */
export async function syncSequences(db: Db, tables: readonly string[]): Promise<void> {
  for (const t of tables) {
    await db.run(
      `SELECT setval(s, GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), COALESCE(pg_sequence_last_value(s::regclass), 0), 1))
       FROM pg_get_serial_sequence('${t}', 'id') AS s`,
    );
  }
}

const clock = new AsyncLocalStorage<string>();

export function nowIso(): string {
  return clock.getStore() ?? new Date().toISOString();
}

/** Run fn with timestamps pinned to `iso`. Used by demo data so history looks realistic. Works across awaits. */
export function withClock<T>(iso: string, fn: () => T): T {
  return clock.run(iso, fn);
}

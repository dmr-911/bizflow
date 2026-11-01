import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { and, eq, sql, type Column, type SQL } from "drizzle-orm";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { runMigrations, type MigrateOptions } from "./migrate";

export { schema };

/*
 * Storage layout: one Postgres database (Neon in production), accessed through
 * Drizzle ORM. The tables are declared in ./schema.ts and created by the SQL
 * migrations in /drizzle. Accounts, logins and billing are ordinary tables; every
 * business table carries account_id and every business query filters on it
 * (`db.owns(table)`). Composite keys (account_id, id) and composite foreign keys mean
 * a row can only ever point at rows of the same business, so one account can never
 * read or link another account's data.
 */

// COUNT, SUM and BIGINT values arrive as strings by default. Every value we store fits
// comfortably in a double (money is minor units, ids are sequence numbers).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

/** A Drizzle database or transaction: both run queries the same way. */
export type Orm = PgDatabase<NodePgQueryResultHKT, typeof schema>;

type Results<T extends readonly (() => Promise<unknown>)[]> = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };

/** Accounts, logins and billing. `orm` is the Drizzle query builder, bound to a transaction inside `tx`. */
export class Db {
  constructor(
    readonly orm: Orm,
    readonly inTransaction = false,
  ) {}

  /** Run fn in one transaction. Nested calls join the outer transaction. */
  async tx<T>(fn: (db: this) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    return this.orm.transaction(async (t) => {
      const db = this.bind(t);
      await db.onBegin();
      return fn(db);
    });
  }

  /**
   * Run independent reads together. A transaction holds one connection, which runs one
   * query at a time, so inside `tx` they run in order instead.
   */
  async parallel<const T extends readonly (() => Promise<unknown>)[]>(...fns: T): Promise<Results<T>> {
    if (!this.inTransaction) return (await Promise.all(fns.map((f) => f()))) as Results<T>;
    const out: unknown[] = [];
    for (const f of fns) out.push(await f());
    return out as Results<T>;
  }

  /** Raw SQL for the few statements the query builder can't express (aggregates, bulk loads, locks). */
  async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    return (await this.orm.execute(query)).rows as T[];
  }

  protected bind(t: Orm): this {
    return new Db(t, true) as this;
  }

  protected async onBegin(): Promise<void> {}
}

/** The database as seen by one business. Every query must filter on `db.owns(table)`. */
export class TenantDb extends Db {
  constructor(
    orm: Orm,
    readonly accountId: number,
    inTransaction = false,
  ) {
    super(orm, inTransaction);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("Invalid account id");
  }

  /** `table.account_id = <this business>` */
  owns(table: { accountId: Column }): SQL {
    return eq(table.accountId, this.accountId);
  }

  /** One row of this business by id. */
  byId(table: { accountId: Column; id: Column }, id: number): SQL {
    return and(this.owns(table), idEq(table.id, id))!;
  }

  protected bind(t: Orm): this {
    return new TenantDb(t, this.accountId, true) as this;
  }

  /**
   * Writes for one business run one at a time, like they did with a SQLite file per
   * business. This keeps read-then-write steps (document numbering, payment totals) safe
   * when two requests for the same business arrive together. Other businesses are not blocked.
   */
  protected async onBegin(): Promise<void> {
    await this.orm.execute(sql`SELECT pg_advisory_xact_lock(${TENANT_LOCK}, ${this.accountId})`);
  }
}

/**
 * `column = id`, or false for ids that can't exist. Ids parsed from URLs and forms can be
 * NaN; Postgres would reject those with "invalid input syntax for type bigint".
 */
export function idEq(column: Column, id: number | null | undefined): SQL {
  return typeof id === "number" && Number.isSafeInteger(id) ? eq(column, id) : sql`false`;
}

const TENANT_LOCK = 1;

/**
 * The Postgres error behind a failed query. Drizzle wraps driver errors in
 * DrizzleQueryError (its message includes the SQL and parameters), with the original as `cause`.
 */
export function pgError(e: unknown): { code: string; constraint?: string; message: string } | undefined {
  for (let err = e; err && typeof err === "object"; err = (err as { cause?: unknown }).cause) {
    if (typeof (err as { code?: unknown }).code === "string") return err as { code: string; constraint?: string; message: string };
  }
  return undefined;
}

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

export function createOrm(pool: pg.Pool): Orm {
  return drizzle({ client: pool, schema });
}

// The pool lives for the server process and survives dev hot reloads.
const globalForDb = globalThis as unknown as {
  __bizflowPool?: pg.Pool;
  __bizflowOrm?: Orm;
  __bizflowReady?: Promise<void>;
  __bizflowMigrate?: MigrateOptions;
};

export function getPool(): pg.Pool {
  return (globalForDb.__bizflowPool ??= createPool());
}

function getOrm(): Orm {
  return (globalForDb.__bizflowOrm ??= createOrm(getPool()));
}

/** Use a specific pool, e.g. a per-test schema. Resets the migration check. */
export function setPool(pool: pg.Pool, migrate: MigrateOptions = {}): void {
  globalForDb.__bizflowPool = pool;
  globalForDb.__bizflowOrm = undefined;
  globalForDb.__bizflowReady = undefined;
  globalForDb.__bizflowMigrate = migrate;
}

export async function closePool(): Promise<void> {
  const pool = globalForDb.__bizflowPool;
  globalForDb.__bizflowPool = undefined;
  globalForDb.__bizflowOrm = undefined;
  globalForDb.__bizflowReady = undefined;
  await pool?.end();
}

/** Migrates once per process, on first use, so a fresh database just works. */
function ready(): Promise<void> {
  return (globalForDb.__bizflowReady ??= runMigrations(getPool(), globalForDb.__bizflowMigrate).then(
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
  return new Db(getOrm());
}

/** One business's view of the database. */
export async function getTenantDb(accountId: number): Promise<TenantDb> {
  await ready();
  return new TenantDb(getOrm(), accountId);
}

export { runMigrations as migrate, type MigrateOptions };

/**
 * After rows were inserted with explicit ids (restore, SQLite import), move each
 * identity sequence past the highest id so new rows never collide.
 */
export async function syncSequences(db: Db, tables: readonly string[]): Promise<void> {
  for (const t of tables) {
    await db.orm.execute(
      sql.raw(
        `SELECT setval(s, GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), COALESCE(pg_sequence_last_value(s::regclass), 0), 1))
         FROM pg_get_serial_sequence('${t}', 'id') AS s`,
      ),
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

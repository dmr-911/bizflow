/**
 * Command-line maintenance for the hosted service. Reads DATABASE_URL (from .env too).
 *
 *   npm run db:migrate                      apply pending migrations from ./drizzle
 *   npm run db:generate                     write a migration after editing src/lib/db/schema.ts (Drizzle Kit)
 *   npm run db:import-sqlite [data-dir]     one-time copy of the old SQLite files (control.db + tenants/*.db)
 *   npm run db:backup [dir]                 a JSON backup per business, restorable from Settings
 *   npm run db:accounts                     list accounts with their subscription state
 *   npm run db:seed <email>                 replace that account's business data with demo data
 *   npm run set-password <email> <pw>       reset a user's password (signs out their sessions)
 *   npm run db:grant <email> <days>         extend paid-through date, e.g. for a bank transfer or support credit
 */
import fs from "node:fs";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { closePool, getDb, getPool, getTenantDb, idEq, migrate, pgError } from "../src/lib/db";
import { accounts, subscriptions, users } from "../src/lib/db/schema";
import { seedDemoData } from "../src/lib/services/seed";
import { findUserIdByEmail, setPassword } from "../src/lib/services/auth";
import { accessState, getSubscription } from "../src/lib/services/billing";
import { exportBackup } from "../src/lib/services/data";
import { passwordSchema } from "../src/lib/validation";
import { importSqlite } from "./sqlite-import";

// Same .env the app uses, without adding a dependency. Real environment variables win.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "migrate") {
    const applied = await migrate(getPool());
    console.log(applied ? `Applied ${applied} migration(s). Database schema is up to date.` : "Database schema is already up to date.");
    return;
  }
  const db = await getDb();
  const accountFor = async (email: string | undefined) => {
    if (!email) throw new Error("Give the account owner's email address");
    const userId = await findUserIdByEmail(db, email);
    if (!userId) throw new Error(`No user with email ${email}`);
    const [{ accountId }] = await db.orm.select({ accountId: users.accountId }).from(users).where(eq(users.id, userId));
    return { userId, accountId };
  };
  switch (cmd) {
    case "import-sqlite": {
      const dir = path.resolve(args[0] ?? process.env.DATA_DIR ?? "data");
      await importSqlite(db, dir, { log: console.log });
      break;
    }
    case "backup": {
      const dir = path.resolve(args[0] ?? "backups", new Date().toISOString().replace(/[:.]/g, "-"));
      fs.mkdirSync(dir, { recursive: true });
      const ids = await db.orm.select({ id: accounts.id }).from(accounts).orderBy(asc(accounts.id));
      for (const { id } of ids) {
        const backup = await exportBackup(await getTenantDb(id));
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(backup, null, 2));
      }
      console.log(`Wrote ${ids.length} business backup(s) to ${dir}. For a full database copy use pg_dump or a Neon branch.`);
      break;
    }
    case "accounts": {
      const rows = await db.orm
        .select({ id: accounts.id, business: accounts.businessName, email: users.email, created: accounts.createdAt })
        .from(accounts)
        .innerJoin(users, sql`${users.accountId} = ${accounts.id} AND ${users.role} = 'owner'`)
        .orderBy(asc(accounts.id));
      const table = [];
      for (const r of rows) {
        const sub = await getSubscription(db, r.id);
        const access = accessState(sub);
        table.push({ ...r, created: r.created.slice(0, 10), status: access.state, provider: sub.provider ?? "-", until: access.endsAt?.slice(0, 10) ?? "-" });
      }
      console.table(table);
      break;
    }
    case "seed": {
      const { accountId } = await accountFor(args[0]);
      await seedDemoData(await getTenantDb(accountId));
      console.log(`Demo data loaded for account ${accountId}.`);
      break;
    }
    case "set-password": {
      const [email, password] = args;
      if (!password) throw new Error("Usage: npm run set-password <email> <new-password>");
      passwordSchema.parse(password);
      await setPassword(db, (await accountFor(email)).userId, password);
      console.log(`Password updated for ${email}. Existing sessions were signed out.`);
      break;
    }
    case "grant": {
      const [email, daysArg] = args;
      const days = Number(daysArg);
      if (!Number.isInteger(days) || days <= 0) throw new Error("Usage: npm run db:grant <email> <days>");
      const { accountId } = await accountFor(email);
      const sub = await getSubscription(db, accountId);
      const from = Math.max(Date.now(), sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : 0);
      const until = new Date(from + days * 86_400_000).toISOString();
      await db.orm
        .update(subscriptions)
        .set({
          currentPeriodEnd: until,
          status: sql`CASE WHEN ${subscriptions.status} IN ('canceled', 'trialing') THEN 'active' ELSE ${subscriptions.status} END`,
          updatedAt: new Date().toISOString(),
        })
        .where(idEq(subscriptions.accountId, accountId));
      console.log(`Account ${accountId} now has access until ${until}.`);
      break;
    }
    default:
      console.log(
        "Commands: migrate | import-sqlite [data-dir] | backup [dir] | accounts | seed <email> | set-password <email> <password> | grant <email> <days>",
      );
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    // Show Postgres's own message, not the failed SQL with all its parameters.
    console.error(pgError(e)?.message ?? (e instanceof Error ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => closePool());

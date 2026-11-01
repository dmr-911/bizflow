/**
 * Command-line maintenance for the hosted service. Reads DATABASE_URL (from .env too).
 *
 *   npm run db:migrate                      create / upgrade the schema
 *   npm run db:import-sqlite [data-dir]     one-time copy of the old SQLite files (control.db + tenants/*.db)
 *   npm run db:backup [dir]                 a JSON backup per business, restorable from Settings
 *   npm run db:accounts                     list accounts with their subscription state
 *   npm run db:seed <email>                 replace that account's business data with demo data
 *   npm run set-password <email> <pw>       reset a user's password (signs out their sessions)
 *   npm run db:grant <email> <days>         extend paid-through date, e.g. for a bank transfer or support credit
 */
import fs from "node:fs";
import path from "node:path";
import { closePool, getDb, getPool, getTenantDb, migrate } from "../src/lib/db";
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
  const db = await getDb();
  const accountFor = async (email: string | undefined) => {
    if (!email) throw new Error("Give the account owner's email address");
    const userId = await findUserIdByEmail(db, email);
    if (!userId) throw new Error(`No user with email ${email}`);
    const { id } = (await db.get<{ id: number }>("SELECT account_id AS id FROM users WHERE id = $1", userId))!;
    return { userId, accountId: id };
  };
  switch (cmd) {
    case "migrate": {
      // getDb() already applied anything pending; run again to report.
      const applied = await migrate(getPool());
      const { n } = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM schema_migrations"))!;
      console.log(`Database schema is up to date (${n} migration(s)${applied ? `, ${applied} just applied` : ""}).`);
      break;
    }
    case "import-sqlite": {
      const dir = path.resolve(args[0] ?? process.env.DATA_DIR ?? "data");
      await importSqlite(db, dir, { log: console.log });
      break;
    }
    case "backup": {
      const dir = path.resolve(args[0] ?? "backups", new Date().toISOString().replace(/[:.]/g, "-"));
      fs.mkdirSync(dir, { recursive: true });
      const accounts = await db.all<{ id: number }>("SELECT id FROM accounts ORDER BY id");
      for (const { id } of accounts) {
        const backup = await exportBackup(await getTenantDb(id));
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(backup, null, 2));
      }
      console.log(`Wrote ${accounts.length} business backup(s) to ${dir}. For a full database copy use pg_dump or a Neon branch.`);
      break;
    }
    case "accounts": {
      const rows = await db.all<{ id: number; business: string; email: string; created: string }>(
        `SELECT a.id, a.business_name AS business, u.email, a.created_at AS created FROM accounts a
         JOIN users u ON u.account_id = a.id AND u.role = 'owner' ORDER BY a.id`,
      );
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
      await db.run(
        `UPDATE subscriptions SET current_period_end = $1,
           status = CASE WHEN status = 'canceled' OR status = 'trialing' THEN 'active' ELSE status END, updated_at = $2
         WHERE account_id = $3`,
        until,
        new Date().toISOString(),
        accountId,
      );
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
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePool());

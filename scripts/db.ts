/**
 * Command-line maintenance for the hosted service.
 *
 *   npm run db:migrate                      create / upgrade the control database and every business database
 *   npm run db:backup [dir]                 consistent copies of all databases (safe while running)
 *   npm run db:accounts                     list accounts with their subscription state
 *   npm run db:seed <email>                 replace that account's business data with demo data
 *   npm run set-password <email> <pw>       reset a user's password (signs out their sessions)
 *   npm run db:grant <email> <days>         extend paid-through date, e.g. for a bank transfer or support credit
 */
import path from "node:path";
import fs from "node:fs";
import { controlDatabasePath, dataDir, openDatabase, tenantDatabasePath } from "../src/lib/db";
import { CONTROL_MIGRATIONS } from "../src/lib/db/control-migrations";
import { seedDemoData } from "../src/lib/services/seed";
import { findUserIdByEmail, setPassword } from "../src/lib/services/auth";
import { accessState, getSubscription } from "../src/lib/services/billing";
import { passwordSchema } from "../src/lib/validation";

function tenantIds(): number[] {
  const dir = path.join(dataDir(), "tenants");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^(\d+)\.db$/.exec(f)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort((a, b) => a - b);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const control = openDatabase(controlDatabasePath(), CONTROL_MIGRATIONS);
  const accountFor = (email: string | undefined) => {
    if (!email) throw new Error("Give the account owner's email address");
    const userId = findUserIdByEmail(control, email);
    if (!userId) throw new Error(`No user with email ${email}`);
    return { userId, accountId: (control.prepare("SELECT account_id AS id FROM users WHERE id = ?").get(userId) as { id: number }).id };
  };
  switch (cmd) {
    case "migrate": {
      const ids = tenantIds();
      for (const id of ids) openDatabase(tenantDatabasePath(id)).close();
      console.log(`Control database ready at ${controlDatabasePath()}; ${ids.length} business database(s) migrated.`);
      break;
    }
    case "backup": {
      const dir = path.resolve(args[0] ?? "backups", new Date().toISOString().replace(/[:.]/g, "-"));
      fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
      await control.backup(path.join(dir, "control.db"));
      const ids = tenantIds();
      for (const id of ids) {
        const db = openDatabase(tenantDatabasePath(id));
        await db.backup(path.join(dir, "tenants", `${id}.db`));
        db.close();
      }
      console.log(`Backed up control database and ${ids.length} business database(s) to ${dir}`);
      break;
    }
    case "accounts": {
      const rows = control
        .prepare(
          `SELECT a.id, a.business_name AS business, u.email, a.created_at AS created FROM accounts a
           JOIN users u ON u.account_id = a.id AND u.role = 'owner' ORDER BY a.id`,
        )
        .all() as { id: number; business: string; email: string; created: string }[];
      console.table(
        rows.map((r) => {
          const sub = getSubscription(control, r.id);
          const access = accessState(sub);
          return { ...r, created: r.created.slice(0, 10), status: access.state, provider: sub.provider ?? "-", until: access.endsAt?.slice(0, 10) ?? "-" };
        }),
      );
      break;
    }
    case "seed": {
      const { accountId } = accountFor(args[0]);
      const db = openDatabase(tenantDatabasePath(accountId));
      seedDemoData(db);
      db.close();
      console.log(`Demo data loaded for account ${accountId}.`);
      break;
    }
    case "set-password": {
      const [email, password] = args;
      if (!password) throw new Error("Usage: npm run set-password <email> <new-password>");
      passwordSchema.parse(password);
      setPassword(control, accountFor(email).userId, password);
      console.log(`Password updated for ${email}. Existing sessions were signed out.`);
      break;
    }
    case "grant": {
      const [email, daysArg] = args;
      const days = Number(daysArg);
      if (!Number.isInteger(days) || days <= 0) throw new Error("Usage: npm run db:grant <email> <days>");
      const { accountId } = accountFor(email);
      const sub = getSubscription(control, accountId);
      const from = Math.max(Date.now(), sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : 0);
      const until = new Date(from + days * 86_400_000).toISOString();
      control
        .prepare("UPDATE subscriptions SET current_period_end = ?, status = CASE WHEN status = 'canceled' OR status = 'trialing' THEN 'active' ELSE status END, updated_at = ? WHERE account_id = ?")
        .run(until, new Date().toISOString(), accountId);
      console.log(`Account ${accountId} now has access until ${until}.`);
      break;
    }
    default:
      console.log("Commands: migrate | backup [dir] | accounts | seed <email> | set-password <email> <password> | grant <email> <days>");
      process.exitCode = 1;
  }
  control.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

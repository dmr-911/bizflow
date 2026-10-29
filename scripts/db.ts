/**
 * Command-line maintenance for self-hosted installs.
 *
 *   npm run db:migrate                 create / upgrade the database
 *   npm run db:seed                    replace business data with demo data
 *   npm run db:reset                   erase all business data (keeps settings + login)
 *   npm run db:backup [dir]            consistent copy of the SQLite file (safe while running)
 *   npm run set-password <user> <pw>   reset a password (or create the first user)
 */
import path from "node:path";
import fs from "node:fs";
import { databasePath, openDatabase } from "../src/lib/db";
import { resetBusinessData } from "../src/lib/services/data";
import { seedDemoData } from "../src/lib/services/seed";
import { createUser, hasUsers, setPassword } from "../src/lib/services/auth";
import { passwordSchema } from "../src/lib/validation";

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const file = databasePath();
  const db = openDatabase(file);
  switch (cmd) {
    case "migrate":
      console.log(`Database ready at ${file}`);
      break;
    case "seed":
      seedDemoData(db);
      console.log("Demo data loaded.");
      break;
    case "reset":
      resetBusinessData(db);
      console.log("All business data erased. Settings and login kept.");
      break;
    case "backup": {
      const dir = path.resolve(args[0] ?? "backups");
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `bizflow-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      await db.backup(target);
      console.log(`Backup written to ${target}`);
      break;
    }
    case "set-password": {
      const [username, password] = args;
      if (!username || !password) throw new Error("Usage: npm run set-password <username> <new-password>");
      passwordSchema.parse(password);
      if (!hasUsers(db)) {
        createUser(db, username, password);
        console.log(`Created user ${username}.`);
      } else if (setPassword(db, username, password)) {
        console.log(`Password updated for ${username}. Existing sessions were signed out.`);
      } else {
        throw new Error(`No user named ${username}`);
      }
      break;
    }
    default:
      console.log("Commands: migrate | seed | reset | backup [dir] | set-password <user> <password>");
      process.exitCode = 1;
  }
  db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

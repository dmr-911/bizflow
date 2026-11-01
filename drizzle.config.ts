import fs from "node:fs";
import { defineConfig } from "drizzle-kit";

// Studio and `drizzle-kit migrate` need DATABASE_URL; read .env like the app does. Real env vars win.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

// Schema lives in src/lib/db/schema.ts; `npm run db:generate` writes a new SQL migration
// to ./drizzle after a schema change. Review the SQL before committing it. The app applies
// pending migrations itself (src/lib/db/migrate.ts), or run `npm run db:migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});

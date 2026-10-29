import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // server-only throws outside a React Server Components build; tests import server modules directly.
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});

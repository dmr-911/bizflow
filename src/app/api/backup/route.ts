import { getDb } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { exportBackup } from "@/lib/services/data";
import { routeUser } from "@/lib/server/route-auth";

export async function GET() {
  if (!(await routeUser())) return new Response("Unauthorized", { status: 401 });
  return new Response(JSON.stringify(exportBackup(getDb()), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bizflow-backup-${todayIso()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

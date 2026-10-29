import { todayIso } from "@/lib/dates";
import { exportBackup } from "@/lib/services/data";
import { routeTenant } from "@/lib/server/route-auth";

export async function GET() {
  const auth = await routeTenant({ allowLapsed: true });
  if ("error" in auth) return auth.error;
  return new Response(JSON.stringify(exportBackup(auth.db), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bizflow-backup-${todayIso()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

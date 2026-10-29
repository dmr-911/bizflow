import "server-only";
import { cookies } from "next/headers";
import { getControlDb, getTenantDb } from "../db";
import { sessionUser } from "../services/auth";
import { accessState, getSubscription } from "../services/billing";
import { SESSION_COOKIE } from "./context";

/** Route handlers return 401/402 instead of redirecting. */
export async function routeUser() {
  return sessionUser(getControlDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Signed-in user and their business database. `allowLapsed` lets an account
 * whose subscription ended still take its data out (backup and CSV export).
 */
export async function routeTenant(opts: { allowLapsed?: boolean } = {}) {
  const user = await routeUser();
  if (!user) return { error: new Response("Unauthorized", { status: 401 }) } as const;
  if (!opts.allowLapsed && !accessState(getSubscription(getControlDb(), user.accountId)).allowed) {
    return { error: new Response("Subscription required", { status: 402 }) } as const;
  }
  return { user, db: getTenantDb(user.accountId) } as const;
}

import "server-only";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { sessionUser } from "../services/auth";
import { SESSION_COOKIE } from "./context";

/** Route handlers return 401 instead of redirecting. */
export async function routeUser() {
  return sessionUser(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

import "server-only";
import { ZodError } from "zod";
import { fieldErrors } from "../validation";
import { TransitionError } from "../status";
import { NotFoundError } from "../services/customers";
import { pgError } from "../db";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Convert expected business errors to a result the form can show; rethrow everything else. */
export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof ZodError) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(e) };
  if (e instanceof TransitionError || e instanceof NotFoundError) return { ok: false, error: e.message };
  if (pgError(e)?.code === "23505") {
    return { ok: false, error: "That number is already in use." };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

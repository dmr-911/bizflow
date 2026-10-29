"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/server/action";

/**
 * useActionState wired through onSubmit instead of the form `action` prop.
 * React resets uncontrolled fields after a form action; submitting this way
 * keeps what the user typed when the server returns a validation error.
 */
export function useFormAction(action: (s: ActionResult | null, f: FormData) => Promise<ActionResult>) {
  const [state, dispatch, pending] = useActionState(action, null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return [state, onSubmit, pending] as const;
}

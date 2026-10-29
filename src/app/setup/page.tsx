import { redirect } from "next/navigation";
import { setupAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getDb } from "@/lib/db";
import { hasUsers } from "@/lib/services/auth";
import { getContext } from "@/lib/server/context";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  if (hasUsers(getDb())) redirect("/login");
  const { t } = await getContext();
  return (
    <AuthShell title={t.auth.setupTitle} text={t.auth.setupText}>
      <AuthForm action={setupAction} newPassword labels={{ username: t.auth.username, password: t.auth.password, submit: t.auth.setupButton }} />
    </AuthShell>
  );
}

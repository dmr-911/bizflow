import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getDb } from "@/lib/db";
import { hasUsers } from "@/lib/services/auth";
import { currentUser, getContext } from "@/lib/server/context";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (!hasUsers(getDb())) redirect("/setup");
  if (await currentUser()) redirect("/");
  const { t } = await getContext();
  return (
    <AuthShell title={t.auth.login} text={t.auth.signInText}>
      <AuthForm action={loginAction} labels={{ username: t.auth.username, password: t.auth.password, submit: t.auth.login }} />
    </AuthShell>
  );
}

import Link from "next/link";
import { cx } from "./ui";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-lg bg-brand-600 font-bold text-white", className ?? "size-8")} aria-hidden>
      B
    </span>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cx("flex items-center gap-2 font-semibold tracking-tight text-slate-900", className)} aria-label="BizFlow home">
      <LogoMark />
      <span className="text-lg">BizFlow</span>
    </Link>
  );
}

import type { ReactNode } from "react";

export function AuthShell({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">B</span>
          <span className="text-lg font-semibold">BizFlow Kit</span>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mb-5 mt-1 text-sm text-slate-500">{text}</p>
          {children}
        </div>
      </div>
    </main>
  );
}

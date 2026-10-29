"use client";

import { useEffect } from "react";

export function PrintButton({ label, auto }: { label: string; auto?: boolean }) {
  useEffect(() => {
    if (auto) window.print();
  }, [auto]);
  return (
    <button onClick={() => window.print()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
      {label}
    </button>
  );
}

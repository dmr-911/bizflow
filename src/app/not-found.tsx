import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
      <Link href="/" className="mt-4 text-sm text-brand-600 hover:underline">
        ← Home
      </Link>
    </main>
  );
}

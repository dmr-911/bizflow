"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <p className="font-semibold">Something went wrong.</p>
      <p className="mt-1">The error was logged on the server. Your data has not been changed.</p>
      <button onClick={reset} className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100">
        Try again
      </button>
    </div>
  );
}

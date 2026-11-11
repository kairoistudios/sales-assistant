"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h1 className="serif text-3xl">The list didn’t load</h1>
      <p className="mt-3 text-sm text-muted-foreground">{error.message}</p>
      <button className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}

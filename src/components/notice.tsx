export function Notice({ notice }: { notice?: string }) {
  if (!notice) return null;
  return <p className="mb-6 rounded-md border border-border bg-card px-4 py-3 text-sm">{notice}</p>;
}

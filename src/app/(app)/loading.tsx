export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
      <div className="h-4 w-72 animate-pulse rounded bg-secondary" />
      <div className="h-40 animate-pulse rounded-lg bg-card" />
      <div className="h-40 animate-pulse rounded-lg bg-card" />
    </div>
  );
}

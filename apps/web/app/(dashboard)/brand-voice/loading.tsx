export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-20 animate-pulse rounded-2xl bg-muted/30" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="h-96 animate-pulse rounded-xl bg-muted/30" />
        <div className="h-96 animate-pulse rounded-xl bg-muted/30" />
      </div>
    </div>
  );
}

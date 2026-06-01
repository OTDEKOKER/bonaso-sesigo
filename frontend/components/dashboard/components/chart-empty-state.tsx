export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[1.1rem] border border-dashed border-border bg-card px-4 py-10 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

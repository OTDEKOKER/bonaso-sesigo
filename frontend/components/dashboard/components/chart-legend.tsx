export type ChartLegendItem = {
  color: string;
  label: string;
};

export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <div
          key={`${item.label}-${item.color}`}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1"
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

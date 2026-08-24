import { Plus } from "lucide-react";

export function AddCardTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex w-full items-center justify-center gap-2 self-start rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={onClick}
      title="Add another graph, pie chart, or indicator card directly into this dashboard layout."
    >
      <Plus className="h-4 w-4" />
      Add dashboard card
    </button>
  );
}

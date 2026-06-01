import { Plus } from "lucide-react";

export function AddCardTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex min-h-[260px] w-full self-start flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-card px-6 py-10 text-center text-muted-foreground transition-colors hover:bg-muted"
      onClick={onClick}
    >
      <div className="mb-4 rounded-full border border-border bg-background p-3">
        <Plus className="h-5 w-5" />
      </div>
      <div className="text-base font-semibold text-foreground">Add dashboard card</div>
      <div className="mt-2 max-w-xs text-sm">
        Add another graph, pie chart, or indicator card directly into this dashboard layout.
      </div>
    </button>
  );
}

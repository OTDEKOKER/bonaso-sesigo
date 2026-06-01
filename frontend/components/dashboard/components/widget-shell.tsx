import type { ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CustomWidgetShell({
  children,
  onDelete,
  onEdit,
}: {
  children: ReactNode;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="relative min-w-0 w-full max-w-full overflow-hidden">
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border bg-background/95 text-foreground shadow-sm hover:bg-muted"
          onClick={onEdit}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="border-border bg-background/95 text-foreground shadow-sm hover:bg-muted"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

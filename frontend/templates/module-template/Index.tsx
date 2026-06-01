"use client";

import { useEffect, useState } from "react";
import { moduleService } from "./api";
import type { ModuleRecord } from "./types";

export default function ModuleIndex() {
  const [items, setItems] = useState<ModuleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await moduleService.list();
        if (isMounted) setItems(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load module data";
        if (isMounted) setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-destructive">{error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Module Index</h1>
      <div className="text-sm text-muted-foreground">
        Records: {items.length}
      </div>
    </div>
  );
}

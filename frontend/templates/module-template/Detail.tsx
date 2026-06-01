"use client";

import { useEffect, useState } from "react";
import { moduleService } from "./api";
import type { ModuleRecord } from "./types";

interface ModuleDetailProps {
  id: number;
}

export default function ModuleDetail({ id }: ModuleDetailProps) {
  const [record, setRecord] = useState<ModuleRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await moduleService.get(id);
        if (isMounted) setRecord(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load record";
        if (isMounted) setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [id]);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-destructive">{error}</div>;
  if (!record) return <div>No record found.</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Module Detail</h1>
      <pre className="rounded bg-muted p-4 text-xs">
        {JSON.stringify(record, null, 2)}
      </pre>
    </div>
  );
}

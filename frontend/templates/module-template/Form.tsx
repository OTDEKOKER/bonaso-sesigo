"use client";

import { useState, type FormEvent } from "react";
import { moduleService } from "./api";
import type { ModuleCreateRequest } from "./types";

interface ModuleFormProps {
  onSuccess?: () => void;
}

export default function ModuleForm({ onSuccess }: ModuleFormProps) {
  const [form, setForm] = useState<ModuleCreateRequest>({ name: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await moduleService.create(form);
      onSuccess?.();
      setForm({ name: "" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save record");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Name</label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Module name"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Saving..." : "Save"}
      </button>
    </form>
  );
}

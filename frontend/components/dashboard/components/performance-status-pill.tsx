import {
  getPerformanceStatusFromValues,
  type PerformanceStatusResult,
} from "@/components/dashboard/engine/performance-status";

/**
 * Small RAG status chip for target-vs-achieved rows. Pass either raw
 * value/target (it will classify) or a precomputed status result.
 */
export function PerformanceStatusPill({
  value,
  target,
  status,
}: {
  value?: number;
  target?: number;
  status?: PerformanceStatusResult;
}) {
  const resolved = status ?? getPerformanceStatusFromValues(value ?? 0, target ?? 0);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        borderColor: `${resolved.color}55`,
        backgroundColor: `${resolved.color}14`,
        color: resolved.color,
      }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolved.color }} />
      {resolved.label}
    </span>
  );
}

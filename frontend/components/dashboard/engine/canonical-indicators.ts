import { resolveCanonicalIndicator } from "@/lib/indicators/canonical";
import { cleanIndicatorLabel, detectIndicatorStage } from "./normalize-indicators";

export function resolveDashboardIndicator(label: string) {
  const canonical = resolveCanonicalIndicator(label);
  const cleanLabel = canonical?.label ?? cleanIndicatorLabel(label);
  const stage = canonical?.stage ?? detectIndicatorStage(cleanLabel);
  return { canonical, cleanLabel, stage };
}

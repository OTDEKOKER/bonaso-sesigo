// Client-safe feature flags for the visualization engine migration.
// Keep the legacy engine as the default until the v2 path is fully verified.

export function getVisualizationEngineV2Enabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.NEXT_PUBLIC_ENABLE_VISUALIZATION_ENGINE_V2 === "true" ||
    env.ENABLE_VISUALIZATION_ENGINE_V2 === "true"
  );
}

export const ENABLE_VISUALIZATION_ENGINE_V2 =
  getVisualizationEngineV2Enabled();

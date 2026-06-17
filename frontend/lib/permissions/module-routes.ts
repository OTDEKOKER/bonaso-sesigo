/**
 * Single source of truth mapping app routes to permission modules. Shared by the
 * sidebar (visibility) and the route guard (access). A path with no mapping has
 * no module gate and is always allowed.
 */
const MODULE_BY_PATH: Record<string, string> = {
  "/dashboard": "dashboard",
  "/organizations": "organizations",
  "/users": "users",
  "/projects": "projects",
  "/indicators": "indicators",
  "/targets": "targets",
  "/respondents": "respondents",
  "/aggregates": "aggregates",
  "/events": "events",
  "/social": "social",
  // Client organizations are org-management; gate them with the orgs module.
  "/clients": "organizations",
  "/batch-record": "batch_record",
  "/uploads": "uploads",
  "/analysis": "analytics",
  "/reports": "reports",
  "/messages": "messages",
  "/announcements": "notifications",
  "/system-status": "system_status",
  // NOTE: /settings is intentionally NOT gated — it is the user's own profile /
  // password / appearance page that every role needs. No role default grants the
  // `settings` module, so mapping it here would lock non-admins out of their own
  // account page. Admin-only system settings are gated elsewhere if needed.
}

/** Resolve the permission module for a route, or null when the route is ungated. */
export function moduleForPath(path: string | null | undefined): string | null {
  if (!path) return null
  let normalized = path.split("?")[0].split("#")[0]
  // Training Mode mirrors live routes under /training/*; gate by the live module.
  if (normalized === "/training" || normalized.startsWith("/training/")) {
    const stripped = normalized.slice("/training".length) || "/"
    if (stripped === "/") return "training_mode"
    normalized = stripped
  }
  const match = Object.keys(MODULE_BY_PATH).find(
    (base) => normalized === base || normalized.startsWith(base + "/"),
  )
  return match ? MODULE_BY_PATH[match] : null
}

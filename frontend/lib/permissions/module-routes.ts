/**
 * Single source of truth mapping app routes to permission modules. Shared by the
 * sidebar (visibility) and the route guard (access). A path with no mapping has
 * no module gate and is always allowed.
 */
const MODULE_BY_PATH: Record<string, string> = {
  "/dashboard": "dashboard",
  // Executive Dashboard is a dashboard view — same gate as /dashboard.
  "/executive": "dashboard",
  // Explore workbench — a self-service dashboard view; same gate as /dashboard.
  // Underlying data is org-scoped server-side, so this only gates UI access.
  "/explore": "dashboard",
  "/organizations": "organizations",
  "/users": "users",
  "/projects": "projects",
  "/indicators": "indicators",
  "/targets": "targets",
  "/respondents": "respondents",
  "/aggregates": "aggregates",
  "/events": "events",
  "/social": "social",
  // Grants / financial accounting — deny-by-default (no role default grants it).
  "/grants": "grants",
  // Client organizations are org-management; gate them with the orgs module.
  "/clients": "organizations",
  "/batch-record": "batch_record",
  "/uploads": "uploads",
  "/analysis": "analytics",
  "/reports": "reports",
  // Funder reports are part of the Reports module.
  "/funder-reports": "reports",
  // Reporting-period windows are an M&E/admin control — gate with Targets
  // (managers/admins have it; front-line data entry does not).
  "/reporting-periods": "targets",
  "/messages": "messages",
  "/announcements": "notifications",
  "/support": "support",
  "/cso-mapping-submissions": "cso_mapping",
  "/cso-mapping-map": "cso_mapping",
  "/cso-mapping-form-editor": "cso_mapping",
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

// Preferred landing order for a user who cannot open /dashboard (e.g. a user
// restricted to a single module such as CSO Mapping). The default post-login
// route is /dashboard; if that is not viewable, send them to the first route
// they can view instead of a dead-end "Access denied" screen.
const LANDING_PRIORITY: string[] = [
  "/dashboard",
  "/cso-mapping-submissions",
  "/organizations",
  "/projects",
  "/indicators",
  "/targets",
  "/respondents",
  "/aggregates",
  "/events",
  "/social",
  "/analysis",
  "/reports",
  "/uploads",
  "/messages",
  "/support",
]

/** The first route the user can view, falling back to /settings (never gated). */
export function firstAccessibleRoute(canView: (moduleName: string) => boolean): string {
  for (const route of LANDING_PRIORITY) {
    const mod = MODULE_BY_PATH[route]
    if (!mod || canView(mod)) return route
  }
  return "/settings"
}

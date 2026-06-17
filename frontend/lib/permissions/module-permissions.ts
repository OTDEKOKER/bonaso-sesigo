"use client"

import { useMemo } from "react"
import { useAuth } from "@/lib/contexts/auth-context"
import { isPlatformAdmin } from "@/lib/permissions"
import type { User } from "@/lib/types"

/**
 * Frontend mirror of the backend module-permission resolution
 * (users.module_permissions). The backend is the source of truth and enforces
 * every protected API; this is purely for UI gating — sidebar visibility, route
 * guards, and showing/hiding in-module action controls.
 *
 * The effective map comes from /api/users/me/ (`module_permissions`), which the
 * backend resolves to either the user's custom rows or their role defaults.
 * Non-admins are gated by that map (deny-by-default): a module not present, or
 * present without the required action, is hidden/blocked. Admins are treated as
 * fully permitted even if the map is absent.
 */

export type ModuleName = string
export type ActionName = string

function rawMap(user?: User | null): Record<string, string[]> | undefined {
  return user?.module_permissions as Record<string, string[]> | undefined
}

function effectiveMap(user?: User | null): Record<string, string[]> {
  return rawMap(user) ?? {}
}

/**
 * Informational only: whether an admin has explicitly configured this user
 * (vs. running on role defaults). No longer used to gate the UI — gating is
 * deny-by-default against the resolved map for every non-admin — but exposed on
 * the hook so callers can distinguish a customized user from a role-default one.
 */
function isEnforced(user?: User | null): boolean {
  return Boolean(user?.module_permissions_enforced)
}

/**
 * True if the user may perform `action` on `module`.
 *
 * Admins always pass. Every other user is gated by their resolved module map
 * (`/api/users/me/` → `module_permissions`, which is already the user's custom
 * rows or their role defaults). A module the map does not grant is denied — the
 * sidebar and route guard never show a module the user cannot actually use.
 */
export function hasModulePermission(
  user: User | null | undefined,
  module: ModuleName,
  action: ActionName,
): boolean {
  if (isPlatformAdmin(user)) return true
  // An absent map means the payload predates this field or hasn't resolved yet
  // (e.g. a stale localStorage cache hydrated before `/me` revalidates). Don't
  // hard-restrict on that — every real `/me` response includes the map, so
  // gating applies the moment it loads. Fail-closed only once we have a map.
  const map = rawMap(user)
  if (map === undefined) return true
  return (map[module] ?? []).includes(action)
}

/** True if the user can see the module at all (has at least `view`). */
export function canViewModule(user: User | null | undefined, module: ModuleName): boolean {
  return hasModulePermission(user, module, "view")
}

export interface ModulePermissionApi {
  /** Effective {module: [actions]} map (admins resolve as all-allowed at call sites). */
  permissions: Record<string, string[]>
  isAdmin: boolean
  /** True when an admin has explicitly customized this user (vs. role defaults). Informational. */
  enforced: boolean
  can: (module: ModuleName, action: ActionName) => boolean
  canView: (module: ModuleName) => boolean
}

/** Hook form for components: `const { can, canView } = useModulePermissions()`. */
export function useModulePermissions(): ModulePermissionApi {
  const { user } = useAuth()
  return useMemo<ModulePermissionApi>(
    () => ({
      permissions: effectiveMap(user),
      isAdmin: isPlatformAdmin(user),
      enforced: isEnforced(user),
      can: (module, action) => hasModulePermission(user, module, action),
      canView: (module) => canViewModule(user, module),
    }),
    [user],
  )
}

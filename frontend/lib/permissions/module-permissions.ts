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
 * The effective map comes from /api/users/me/ (`module_permissions`). Admins are
 * treated as fully permitted even if the map is absent.
 */

export type ModuleName = string
export type ActionName = string

function effectiveMap(user?: User | null): Record<string, string[]> {
  return (user?.module_permissions as Record<string, string[]> | undefined) ?? {}
}

/** Restriction only applies to users an admin explicitly configured. */
function isEnforced(user?: User | null): boolean {
  return Boolean(user?.module_permissions_enforced)
}

/**
 * True if the user may perform `action` on `module`.
 *
 * Admins always pass. Crucially, users an admin has NOT configured also pass —
 * the UI never restricts below the existing role-based experience; only an
 * explicitly-configured user is gated by their assigned permissions.
 */
export function hasModulePermission(
  user: User | null | undefined,
  module: ModuleName,
  action: ActionName,
): boolean {
  if (isPlatformAdmin(user)) return true
  if (!isEnforced(user)) return true
  return (effectiveMap(user)[module] ?? []).includes(action)
}

/** True if the user can see the module at all (has at least `view`). */
export function canViewModule(user: User | null | undefined, module: ModuleName): boolean {
  return hasModulePermission(user, module, "view")
}

export interface ModulePermissionApi {
  /** Effective {module: [actions]} map (admins resolve as all-allowed at call sites). */
  permissions: Record<string, string[]>
  isAdmin: boolean
  /** True only when this user is explicitly configured and thus UI-gated. */
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

import type { Organization } from "../types";
import { normalizeOrganizationType } from "../organization-hierarchy.ts";

export type AnalyticsScopeMode =
  | "all_orgs"
  | "parent_org"
  | "selected_orgs"
  | "self_only";

export type ResolveOrgScopeInput = {
  organizations: Organization[];
  scopeMode: AnalyticsScopeMode;
  currentUserOrgId?: string | null;
  currentUserRole?: string | null;
  currentUserIsStaff?: boolean;
  currentUserIsSuperuser?: boolean;
  parentOrgId?: string | null;
  selectedOrgIds?: string[];
};

export type ResolveOrgScopeResult = {
  allowedOrgIds: string[];
  resolvedOrgIds: string[];
  descendantByParent: Record<string, string[]>;
  effectiveScopeMode: AnalyticsScopeMode;
};

export type ProjectHierarchyOverridesInput = Record<
  string,
  Array<string | number> | null | undefined
>;

type BuildOrganizationDescendantMapOptions = {
  hierarchyOverrides?: ProjectHierarchyOverridesInput | null;
  scopedOrganizationIds?: Array<string | number> | null;
};

const dedupe = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const isPlatformAdmin = (input: {
  currentUserRole?: string | null;
  currentUserIsStaff?: boolean;
  currentUserIsSuperuser?: boolean;
}) =>
  Boolean(
    input.currentUserIsStaff ||
      input.currentUserIsSuperuser ||
      String(input.currentUserRole || "").toLowerCase() === "admin",
  );

function buildGlobalOrganizationDescendantMap(
  organizations: Organization[],
): Record<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  organizations.forEach((organization) => {
    const orgId = String(organization.id);
    const parentId = organization.parentId ? String(organization.parentId) : "";
    if (!parentId) return;
    const current = childrenByParent.get(parentId) || [];
    current.push(orgId);
    childrenByParent.set(parentId, current);
  });

  const descendantsByParent: Record<string, string[]> = {};
  organizations.forEach((organization) => {
    const rootId = String(organization.id);
    const queue = [...(childrenByParent.get(rootId) || [])];
    const seen = new Set<string>();
    const descendants: string[] = [];
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId || seen.has(nextId)) continue;
      seen.add(nextId);
      descendants.push(nextId);
      (childrenByParent.get(nextId) || []).forEach((childId) => queue.push(childId));
    }
    descendantsByParent[rootId] = descendants;
  });

  return descendantsByParent;
}

export function buildOrganizationDescendantMap(
  organizations: Organization[],
  options?: BuildOrganizationDescendantMapOptions,
): Record<string, string[]> {
  const globalDescendants = buildGlobalOrganizationDescendantMap(organizations);
  const overrides = options?.hierarchyOverrides;
  if (!overrides || typeof overrides !== "object") {
    return globalDescendants;
  }

  const scopedOrgIdsRaw = options?.scopedOrganizationIds || null;
  const scopedOrgIds = scopedOrgIdsRaw
    ? new Set(
        scopedOrgIdsRaw
          .map((value) => String(value || "").trim())
          .filter((value) => value.length > 0),
      )
    : null;

  const orgIds = organizations
    .map((organization) => String(organization.id || "").trim())
    .filter((value) => value.length > 0)
    .filter((value) => (scopedOrgIds ? scopedOrgIds.has(value) : true));
  const validOrgIdSet = new Set(orgIds);

  const childrenByParent = new Map<string, string[]>();
  Object.entries(overrides).forEach(([rawParentId, rawChildren]) => {
    const parentId = String(rawParentId || "").trim();
    if (!parentId || !validOrgIdSet.has(parentId)) return;
    if (!Array.isArray(rawChildren)) return;

    const children = dedupe(
      rawChildren
        .map((child) => String(child || "").trim())
        .filter((childId) => childId.length > 0)
        .filter((childId) => childId !== parentId && validOrgIdSet.has(childId)),
    );

    childrenByParent.set(parentId, children);
  });

  if (childrenByParent.size === 0) {
    if (!scopedOrgIds) return globalDescendants;
    const filteredGlobal: Record<string, string[]> = {};
    Object.entries(globalDescendants).forEach(([rootId, descendants]) => {
      if (!scopedOrgIds.has(rootId)) return;
      filteredGlobal[rootId] = descendants.filter((descendantId) => scopedOrgIds.has(descendantId));
    });
    return filteredGlobal;
  }

  const allOverrideChildIds = new Set<string>();
  childrenByParent.forEach((children) => {
    children.forEach((childId) => allOverrideChildIds.add(childId));
  });

  const descendantsByParent: Record<string, string[]> = {};
  orgIds.forEach((rootId) => {
    const hasOverrideReference = childrenByParent.has(rootId) || allOverrideChildIds.has(rootId);
    if (!hasOverrideReference) {
      const globalForRoot = globalDescendants[rootId] || [];
      descendantsByParent[rootId] = scopedOrgIds
        ? globalForRoot.filter((descendantId) => scopedOrgIds.has(descendantId))
        : globalForRoot;
      return;
    }

    const queue = [...(childrenByParent.get(rootId) || [])];
    const seen = new Set<string>();
    const descendants: string[] = [];
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId || seen.has(nextId)) continue;
      seen.add(nextId);
      descendants.push(nextId);
      (childrenByParent.get(nextId) || []).forEach((childId) => queue.push(childId));
    }
    descendantsByParent[rootId] = descendants;
  });

  return descendantsByParent;
}

export function resolveAllowedOrganizationIdsForUser(input: {
  organizations: Organization[];
  currentUserOrgId?: string | null;
  currentUserRole?: string | null;
  currentUserIsStaff?: boolean;
  currentUserIsSuperuser?: boolean;
}): string[] {
  const allOrgIds = dedupe(input.organizations.map((organization) => String(organization.id)));
  if (
    isPlatformAdmin({
      currentUserRole: input.currentUserRole,
      currentUserIsStaff: input.currentUserIsStaff,
      currentUserIsSuperuser: input.currentUserIsSuperuser,
    })
  ) {
    return allOrgIds;
  }

  const userOrgId = String(input.currentUserOrgId || "").trim();
  if (!userOrgId) return [];

  const orgById = new Map(
    input.organizations.map((organization) => [String(organization.id), organization]),
  );
  const userOrg = orgById.get(userOrgId);
  if (!userOrg) return [userOrgId];

  const normalizedType = normalizeOrganizationType(userOrg.type);
  if (normalizedType === "subgrantee") {
    return [userOrgId];
  }

  if (
    normalizedType === "coordinator" ||
    normalizedType === "senior_coordinator" ||
    normalizedType === "funder"
  ) {
    const descendantsByParent = buildOrganizationDescendantMap(input.organizations);
    return dedupe([userOrgId, ...(descendantsByParent[userOrgId] || [])]);
  }

  return [userOrgId];
}

export function resolveOrgScope(input: ResolveOrgScopeInput): ResolveOrgScopeResult {
  const descendantsByParent = buildOrganizationDescendantMap(input.organizations);
  const allowedOrgIds = resolveAllowedOrganizationIdsForUser({
    organizations: input.organizations,
    currentUserOrgId: input.currentUserOrgId,
    currentUserRole: input.currentUserRole,
    currentUserIsStaff: input.currentUserIsStaff,
    currentUserIsSuperuser: input.currentUserIsSuperuser,
  });
  const allowedSet = new Set(allowedOrgIds);

  const safeSelectedOrgIds = dedupe(
    (input.selectedOrgIds || []).map(String).filter((orgId) => allowedSet.has(orgId)),
  );

  const userOrgId = String(input.currentUserOrgId || "").trim();
  const safeParentOrgId = String(input.parentOrgId || "").trim();
  const effectiveScopeMode = input.scopeMode;

  if (effectiveScopeMode === "self_only") {
    const resolved = userOrgId && allowedSet.has(userOrgId) ? [userOrgId] : [];
    return {
      allowedOrgIds,
      resolvedOrgIds: resolved,
      descendantByParent: descendantsByParent,
      effectiveScopeMode,
    };
  }

  if (effectiveScopeMode === "selected_orgs") {
    return {
      allowedOrgIds,
      resolvedOrgIds: safeSelectedOrgIds.length > 0 ? safeSelectedOrgIds : allowedOrgIds,
      descendantByParent: descendantsByParent,
      effectiveScopeMode,
    };
  }

  if (effectiveScopeMode === "parent_org") {
    const fallbackParentId =
      safeParentOrgId && allowedSet.has(safeParentOrgId) ? safeParentOrgId : userOrgId;
    const parentAndDescendants = dedupe([
      fallbackParentId,
      ...(descendantsByParent[fallbackParentId] || []),
    ]).filter((orgId) => allowedSet.has(orgId));

    return {
      allowedOrgIds,
      resolvedOrgIds: parentAndDescendants.length > 0 ? parentAndDescendants : allowedOrgIds,
      descendantByParent: descendantsByParent,
      effectiveScopeMode,
    };
  }

  return {
    allowedOrgIds,
    resolvedOrgIds: allowedOrgIds,
    descendantByParent: descendantsByParent,
    effectiveScopeMode: "all_orgs",
  };
}

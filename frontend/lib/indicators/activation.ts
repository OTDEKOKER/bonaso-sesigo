import type { Indicator } from "@/lib/types"

type ActivatableIndicator = Pick<Indicator, "organizations" | "project_targets" | "is_active">

export function getIndicatorOrganizationIds(indicator: Pick<Indicator, "organizations" | "project_targets">) {
  const organizationIds = new Set<string>()

  ;(indicator.organizations || []).forEach((organizationId) => {
    const normalizedId = String(organizationId || "").trim()
    if (normalizedId) organizationIds.add(normalizedId)
  })

  ;(indicator.project_targets || []).forEach((target) => {
    const normalizedId = String(target.organization || "").trim()
    if (normalizedId) organizationIds.add(normalizedId)
  })

  return organizationIds
}

export function getIndicatorProjectIds(indicator: Pick<Indicator, "project_targets">) {
  const projectIds = new Set<string>()

  ;(indicator.project_targets || []).forEach((target) => {
    const normalizedId = String(target.project || "").trim()
    if (normalizedId) projectIds.add(normalizedId)
  })

  return projectIds
}

export function getIndicatorAssignmentCounts(indicator: Pick<Indicator, "organizations" | "project_targets">) {
  const organizationIds = getIndicatorOrganizationIds(indicator)
  const projectIds = getIndicatorProjectIds(indicator)

  return {
    organizationCount: organizationIds.size,
    projectCount: projectIds.size,
  }
}

export function canIndicatorBeActive(indicator: Pick<Indicator, "organizations" | "project_targets">) {
  const { organizationCount, projectCount } = getIndicatorAssignmentCounts(indicator)
  return organizationCount > 0 && projectCount > 0
}

export function isIndicatorEffectivelyActive(indicator: ActivatableIndicator) {
  if (indicator.project_targets === undefined) {
    return Boolean(indicator.is_active)
  }
  return Boolean(indicator.is_active) && canIndicatorBeActive(indicator)
}

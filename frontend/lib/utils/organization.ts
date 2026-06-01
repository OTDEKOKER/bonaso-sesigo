type UserLike = {
  organizationId?: string | number | null
  organization?: string | number | null
} | null | undefined

export function getUserOrganizationId(user: UserLike): number | null {
  const raw = user?.organizationId ?? user?.organization
  if (raw === null || raw === undefined || raw === "") return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

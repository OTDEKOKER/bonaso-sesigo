import type { UserRole } from "./types"

export const USER_ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "M&E Manager" },
  { value: "officer", label: "M&E Officer" },
  { value: "collector", label: "Data Collector" },
  { value: "client", label: "Client" },
]

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "M&E Manager",
  officer: "M&E Officer",
  collector: "Data Collector",
  client: "Client",
}

export const USER_ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-chart-5/10 text-chart-5",
  officer: "bg-chart-1/10 text-chart-1",
  manager: "bg-chart-2/10 text-chart-2",
  collector: "bg-chart-3/10 text-chart-3",
  client: "bg-chart-4/10 text-chart-4",
}

export function getUserRoleLabel(role?: string | null): string {
  if (!role) return "-"
  if (role in USER_ROLE_LABELS) {
    return USER_ROLE_LABELS[role as UserRole]
  }
  return String(role).replace(/_/g, " ")
}

import {
  canonicalizeOrganizationName,
  isRecognizedParentOrganizationName,
} from "./organization-aliases.ts";

export const ORGANIZATION_TYPE_OPTIONS = [
  { value: "funder", label: "Funder" },
  { value: "senior_coordinator", label: "Project Senior Coordinator / Admin" },
  { value: "coordinator", label: "Coordinator" },
  { value: "subgrantee", label: "Sub-grantee" },
] as const;

const LEGACY_TYPE_TO_CANONICAL: Record<string, string> = {
  headquarters: "senior_coordinator",
  regional: "coordinator",
  district: "coordinator",
  partner: "subgrantee",
  ngo: "senior_coordinator",
  government: "funder",
};

const CANONICAL_TYPE_LABELS: Record<string, string> = {
  funder: "Funder",
  senior_coordinator: "Project Senior Coordinator / Admin",
  coordinator: "Coordinator",
  subgrantee: "Sub-grantee",
};

const CANONICAL_TYPE_COLORS: Record<string, string> = {
  funder: "bg-chart-5/10 text-chart-5",
  senior_coordinator: "bg-chart-1/10 text-chart-1",
  coordinator: "bg-chart-2/10 text-chart-2",
  subgrantee: "bg-chart-4/10 text-chart-4",
};

const ALLOWED_PARENT_TYPES: Record<string, string[]> = {
  funder: [],
  senior_coordinator: ["funder"],
  coordinator: ["senior_coordinator"],
  subgrantee: ["coordinator"],
};

export function normalizeOrganizationType(type?: string | null): string {
  const normalized = String(type || "").trim().toLowerCase();
  if (!normalized) return "";
  return LEGACY_TYPE_TO_CANONICAL[normalized] || normalized;
}

export function isBonasoOrganizationName(name?: string | null): boolean {
  return canonicalizeOrganizationName(String(name || "")) === "BONASO";
}

export function isSeedCoordinatorOrganizationName(name?: string | null): boolean {
  const normalizedName = String(name || "");
  return !isBonasoOrganizationName(normalizedName) && isRecognizedParentOrganizationName(normalizedName);
}

export function getEffectiveOrganizationType(
  subject?:
    | {
        name?: string | null;
        type?: string | null;
      }
    | null,
): string {
  if (isBonasoOrganizationName(subject?.name)) return "senior_coordinator";
  if (isSeedCoordinatorOrganizationName(subject?.name)) return "coordinator";
  return normalizeOrganizationType(subject?.type);
}

export function mapOrganizationTypeToBackend(type?: string | null): string | undefined {
  const normalized = normalizeOrganizationType(type);
  if (!normalized) return undefined;

  switch (normalized) {
    case "senior_coordinator":
      return "headquarters";
    case "coordinator":
      return "regional";
    case "subgrantee":
      return "partner";
    default:
      return normalized;
  }
}

export function getOrganizationTypeLabel(type?: string | null): string {
  const normalized = normalizeOrganizationType(type);
  return CANONICAL_TYPE_LABELS[normalized] || String(type || "Organization");
}

export function getOrganizationTypeColorClass(type?: string | null): string {
  const normalized = normalizeOrganizationType(type);
  return CANONICAL_TYPE_COLORS[normalized] || "bg-muted text-muted-foreground";
}

export function organizationCanBeParent(type?: string | null): boolean {
  return normalizeOrganizationType(type) !== "subgrantee";
}

export function organizationCanHaveParent(type?: string | null): boolean {
  return (ALLOWED_PARENT_TYPES[normalizeOrganizationType(type)] || []).length > 0;
}

export function canOrganizationBeParentForType(
  parentType?: string | null,
  childType?: string | null,
): boolean {
  const normalizedChildType = normalizeOrganizationType(childType);
  const normalizedParentType = normalizeOrganizationType(parentType);
  if (!normalizedChildType || !normalizedParentType) return true;
  return (ALLOWED_PARENT_TYPES[normalizedChildType] || []).includes(normalizedParentType);
}

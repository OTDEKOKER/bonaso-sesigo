/**
 * User groups are stored server-side via auth.Group.
 * These helpers are thin shims kept for call-site compatibility.
 * Reads come from the user object returned by the API (user.groups[]).
 * Writes go through usersService.update() / usersService.addGroup() / usersService.removeGroup().
 */

export const USER_GROUPS_STORAGE_KEY = "bonaso_user_groups_v1";

/** No-op: groups now live in the database, not localStorage. */
export const getUserGroupState = () => ({ catalog: [] as string[], assignments: {} as Record<string, string[]> });

/** No-op: groups now live in the database, not localStorage. */
export const setUserGroupState = (_state: { catalog: string[]; assignments: Record<string, string[]> }) => {};

/** No-op: use useGroupCatalog() hook or usersService.listGroupCatalog() instead. */
export const getGroupCatalog = (): string[] => [];

/** No-op: use usersService.addGroup(name) + mutate() instead. */
export const addGroupToCatalog = (_groupName: string): string[] => [];

/** No-op: use usersService.removeGroup(name) + mutate() instead. */
export const removeGroupFromCatalog = (_groupName: string): string[] => [];

/** No-op: groups come from user.groups[] returned by the API. */
export const getUserGroupsForUser = (_userId: string | number): string[] => [];

/** No-op: groups are saved by passing groups[] to usersService.update(). */
export const setUserGroupsForUser = (_userId: string | number, _groups: string[]) => {};

/** Read groups from the API user object. */
export const getGroupsFromUnknownUser = (user: unknown): string[] => {
  if (!user || typeof user !== "object") return [];
  const u = user as Record<string, unknown>;
  const raw = u.groups ?? u.user_groups;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (typeof g === "string") return g;
      if (g && typeof g === "object" && "name" in g) return String((g as { name?: unknown }).name ?? "");
      return "";
    })
    .filter(Boolean);
};

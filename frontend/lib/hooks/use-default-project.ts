import { useMemo } from "react"
import type { Project } from "@/lib/types"

/**
 * Default-project resolution (Sesigo readiness — risk R7).
 *
 * Centralises the "which project should this screen work in?" decision so every
 * assignment/data-entry surface behaves consistently and a single-project user
 * is never forced to repeatedly pick the only project they have. Also keeps the
 * Live/Training boundary intact: a training session only ever sees the training
 * project(s); a live session never offers a training project.
 *
 * Selection precedence for the auto-selected default:
 *   1. Training session  -> the training project.
 *   2. Backend preference -> User.default_project_id, when it's selectable.
 *   3. Exactly one selectable project -> that project.
 *   4. Otherwise null -> the caller must show a selector and guide the user.
 */
export interface DefaultProjectInfo {
  /** Projects the user may legitimately select in the current mode. */
  selectableProjects: Project[]
  /** Project id to auto-select, or null when the user must choose. */
  defaultProjectId: string | null
  /** Exactly one selectable project exists. */
  isSingleProject: boolean
  /** More than one selectable project exists (selector should be prominent). */
  isMultiProject: boolean
  /** Any selectable project exists. */
  hasProjects: boolean
}

export interface DefaultProjectOptions {
  isTrainingMode?: boolean
  trainingProjectId?: string | null
  /** Backend-provided preferred default (User.default_project_id). */
  preferredProjectId?: string | number | null
  /** In live mode, treat only status==='active' projects as selectable. Default true. */
  activeOnly?: boolean
}

export function useDefaultProject(
  projects: Project[] | undefined,
  options: DefaultProjectOptions = {},
): DefaultProjectInfo {
  const {
    isTrainingMode = false,
    trainingProjectId = null,
    preferredProjectId = null,
    activeOnly = true,
  } = options

  return useMemo(() => {
    const all = projects ?? []

    // Mode isolation first: training sessions see only training projects; live
    // sessions never see a training project.
    const modeScoped = all.filter((project) =>
      isTrainingMode ? project.is_training === true : project.is_training !== true,
    )

    // Prefer active projects in live mode, but fall back to the full mode-scoped
    // list if that would leave the user with nothing to pick.
    const activeScoped =
      activeOnly && !isTrainingMode
        ? modeScoped.filter((project) => project.status === "active")
        : modeScoped
    const pool = activeScoped.length > 0 ? activeScoped : modeScoped

    const inPool = (id: string | null | undefined) =>
      id != null && id !== "" && pool.some((project) => String(project.id) === String(id))

    let defaultProjectId: string | null = null
    if (isTrainingMode && inPool(trainingProjectId)) {
      defaultProjectId = String(trainingProjectId)
    } else if (preferredProjectId != null && inPool(String(preferredProjectId))) {
      defaultProjectId = String(preferredProjectId)
    } else if (pool.length === 1) {
      defaultProjectId = String(pool[0].id)
    }

    return {
      selectableProjects: pool,
      defaultProjectId,
      isSingleProject: pool.length === 1,
      isMultiProject: pool.length > 1,
      hasProjects: pool.length > 0,
    }
  }, [projects, isTrainingMode, trainingProjectId, preferredProjectId, activeOnly])
}

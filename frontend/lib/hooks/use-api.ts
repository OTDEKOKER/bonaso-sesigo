'use client';

/**
 * SWR Hooks for API Data Fetching
 * 
 * These hooks provide data fetching with caching, revalidation, and error handling.
 * 
 * Usage:
 *   const { data: projects, isLoading, error, mutate } = useProjects({ status: 'active' });
 */

import useSWR, { type SWRConfiguration } from 'swr';
import {
  projectsService,
  tasksService,
  deadlinesService,
  projectActivitiesService,
  clientOrganizationsService,
  narrativeReportsService,
  organizationsService,
  usersService,
  indicatorsService,
  assessmentsService,
  respondentsService,
  interactionsService,
  eventsService,
  socialPostsService,
  uploadsService,
  aggregatesService,
  notificationsService,
  messagesService,
  announcementsService,
  reportsService,
  analysisService,
  flagsService,
  dashboardChartsService,
  dashboardSettingsService,
  pivotTablesService,
  lineListsService,
  coordinatorTargetsService,
  type ProjectFilters,
  type TaskFilters,
  type DeadlineFilters,
  type ProjectActivityFilters,
  type ClientOrganizationFilters,
  type NarrativeReportFilters,
  type OrganizationFilters,
  type UserFilters,
  type IndicatorFilters,
  type AssessmentFilters,
  type RespondentFilters,
  type InteractionFilters,
  type EventFilters,
  type SocialPostFilters,
  type UploadFilters,
  type AggregateFilters,
  type NotificationFilters,
  type MessageFilters,
  type AnnouncementFilters,
  type ReportFilters,
  type FlagFilters,
  type DashboardSettingsFilters,
  type PivotTableFilters,
  type LineListFilters,
  type CoordinatorTargetFilters,
  type DashboardOverviewFilters,
} from '@/lib/api';

// Default SWR config
const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  shouldRetryOnError: false,
  dedupingInterval: 60_000,
  focusThrottleInterval: 60_000,
  keepPreviousData: true,
};

// ============================================================================
// Organizations Hooks
// ============================================================================

export function useOrganizations(filters?: OrganizationFilters, config?: SWRConfiguration) {
  return useSWR(
    ['organizations', filters],
    () => organizationsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useAllOrganizations(filters?: OrganizationFilters, config?: SWRConfiguration) {
  return useSWR(
    ['organizations-all', filters],
    async () => {
      const results = await organizationsService.listAll(filters);
      return { count: results.length, next: null, previous: null, results };
    },
    { ...defaultConfig, ...config }
  );
}

export function useOrganization(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['organization', id] : null,
    () => organizationsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useOrganizationTree(config?: SWRConfiguration) {
  return useSWR(
    'organizations-tree',
    () => organizationsService.getTree(),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Users Hooks
// ============================================================================

export function useUsers(filters?: UserFilters, config?: SWRConfiguration) {
  return useSWR(
    ['users', filters],
    () => usersService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useUser(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['user', id] : null,
    () => usersService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useUserPermissions(enabled: boolean = true, config?: SWRConfiguration) {
  return useSWR(
    enabled ? 'user-permissions' : null,
    () => usersService.listPermissions(),
    { ...defaultConfig, ...config }
  );
}

export function useGroupCatalog(enabled: boolean = true, config?: SWRConfiguration) {
  return useSWR(
    enabled ? 'user-group-catalog' : null,
    () => usersService.listGroupCatalog(),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Projects Hooks
// ============================================================================

export function useProjects(filters?: ProjectFilters, config?: SWRConfiguration) {
  return useSWR(
    ['projects', filters],
    () => projectsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useProject(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['project', id] : null,
    () => projectsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useAllProjects(filters?: ProjectFilters, config?: SWRConfiguration) {
  return useSWR(
    ['projects-all', filters],
    async () => {
      const results = await projectsService.listAll(filters);
      return { count: results.length, next: null, previous: null, results };
    },
    { ...defaultConfig, ...config }
  );
}

export function useAllProjectDetails(filters?: ProjectFilters, config?: SWRConfiguration) {
  return useSWR(
    ['projects-all-details', filters],
    async () => {
      const projects = await projectsService.listAll(filters);
      const settled = await Promise.allSettled(
        projects.map((project) => projectsService.get(Number(project.id))),
      );
      const detailedProjects = settled
        .filter((result): result is PromiseFulfilledResult<(typeof projects)[number]> => result.status === 'fulfilled')
        .map((result) => result.value);
      const results = detailedProjects.length > 0 ? detailedProjects : projects;
      const count = detailedProjects.length > 0 ? detailedProjects.length : projects.length;

      return { count, next: null, previous: null, results };
    },
    { ...defaultConfig, ...config }
  );
}
export function useProjectStats(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['project-stats', id] : null,
    () => projectsService.getStats(id!),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Tasks Hooks
// ============================================================================

export function useTasks(filters?: TaskFilters, config?: SWRConfiguration) {
  return useSWR(
    ['tasks', filters],
    () => tasksService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useTask(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['task', id] : null,
    () => tasksService.get(id!),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Deadlines Hooks
// ============================================================================

export function useDeadlines(filters?: DeadlineFilters, config?: SWRConfiguration) {
  return useSWR(
    ['deadlines', filters],
    () => deadlinesService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useDeadline(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['deadline', id] : null,
    () => deadlinesService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useClientOrganizations(filters?: ClientOrganizationFilters, config?: SWRConfiguration) {
  return useSWR(
    ['client-organizations', filters],
    () => clientOrganizationsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useProjectActivities(filters?: ProjectActivityFilters, config?: SWRConfiguration) {
  return useSWR(
    ['project-activities', filters],
    () => projectActivitiesService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useNarrativeReports(filters?: NarrativeReportFilters, config?: SWRConfiguration) {
  return useSWR(
    ['narrative-reports', filters],
    () => narrativeReportsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Indicators Hooks
// ============================================================================

export function useIndicators(filters?: IndicatorFilters, config?: SWRConfiguration) {
  return useSWR(
    ['indicators', filters],
    () => indicatorsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useAllIndicators(filters?: IndicatorFilters, config?: SWRConfiguration) {
  return useSWR(
    ['indicators-all', filters],
    () => indicatorsService.listAll(filters),
    { ...defaultConfig, ...config }
  );
}

export function useIndicator(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['indicator', id] : null,
    () => indicatorsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useIndicatorCategories(config?: SWRConfiguration) {
  return useSWR(
    'indicator-categories',
    () => indicatorsService.getCategories(),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Assessments Hooks
// ============================================================================

export function useAssessments(filters?: AssessmentFilters, config?: SWRConfiguration) {
  return useSWR(
    ['assessments', filters],
    () => assessmentsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useAssessment(id: number | string | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['assessment', id] : null,
    () => assessmentsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Respondents Hooks
// ============================================================================

export function useRespondents(filters?: RespondentFilters, config?: SWRConfiguration) {
  return useSWR(
    ['respondents', filters],
    () => respondentsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useRespondent(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['respondent', id] : null,
    () => respondentsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useRespondentProfile(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['respondent-profile', id] : null,
    () => respondentsService.getProfile(id!),
    { ...defaultConfig, ...config }
  );
}

export function useRespondentStats(config?: SWRConfiguration) {
  return useSWR(
    'respondent-stats',
    () => respondentsService.getStats(),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Interactions Hooks
// ============================================================================

export function useInteractions(filters?: InteractionFilters, config?: SWRConfiguration) {
  return useSWR(
    ['interactions', filters],
    () => interactionsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Events Hooks
// ============================================================================

export function useEvents(filters?: EventFilters, config?: SWRConfiguration) {
  return useSWR(
    ['events', filters],
    () => eventsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useEvent(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['event', id] : null,
    () => eventsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useUpcomingEvents(days?: number, config?: SWRConfiguration) {
  return useSWR(
    ['upcoming-events', days],
    () => eventsService.getUpcoming(days),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Social Posts Hooks
// ============================================================================

export function useSocialPosts(filters?: SocialPostFilters, config?: SWRConfiguration) {
  return useSWR(
    ['social-posts', filters],
    () => socialPostsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useSocialPost(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['social-post', id] : null,
    () => socialPostsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Uploads Hooks
// ============================================================================

export function useUploads(filters?: UploadFilters, config?: SWRConfiguration) {
  return useSWR(
    ['uploads', filters],
    () => uploadsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useAllUploads(filters?: UploadFilters, config?: SWRConfiguration) {
  return useSWR(
    ['uploads-all', filters],
    () => uploadsService.listAll(filters),
    { ...defaultConfig, ...config }
  );
}

export function useUpload(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['upload', id] : null,
    () => uploadsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useImportJobs(filters?: { status?: string; upload?: string }, config?: SWRConfiguration) {
  return useSWR(
    ['import-jobs', filters],
    () => uploadsService.listImports(filters),
    { ...defaultConfig, ...config }
  );
}

export function useAllImportJobs(filters?: { status?: string; upload?: string }, config?: SWRConfiguration) {
  return useSWR(
    ['import-jobs-all', filters],
    async () => {
      const results = await uploadsService.listAllImports(filters);
      return { count: results.length, next: null, previous: null, results };
    },
    { ...defaultConfig, ...config }
  );
}

export function useAllExportJobs(filters?: { status?: string; job_type?: string }, config?: SWRConfiguration) {
  return useSWR(
    ['export-jobs-all', filters],
    async () => {
      const results = await uploadsService.listAllExports(filters);
      return { count: results.length, next: null, previous: null, results };
    },
    { ...defaultConfig, ...config }
  );
}
// ============================================================================
// Aggregates Hooks
// ============================================================================

export function useAggregates(filters?: AggregateFilters, config?: SWRConfiguration) {
  return useSWR(
    ['aggregates', filters],
    () => aggregatesService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useAllAggregates(filters?: AggregateFilters | null, config?: SWRConfiguration) {
  return useSWR(
    filters === null ? null : ['aggregates-all', filters],
    () => aggregatesService.listAll(filters || undefined),
    { ...defaultConfig, ...config }
  );
}

export function useNotifications(filters?: NotificationFilters | null, config?: SWRConfiguration) {
  return useSWR(
    filters === null ? null : ['notifications', filters],
    () => notificationsService.list(filters || undefined),
    { ...defaultConfig, ...config }
  );
}

export function useAnnouncements(filters?: AnnouncementFilters, config?: SWRConfiguration) {
  return useSWR(
    ['announcements', filters],
    () => announcementsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useMessages(tab: 'inbox' | 'sent' = 'inbox', filters?: MessageFilters, config?: SWRConfiguration) {
  return useSWR(
    ['messages', tab, filters],
    () => tab === 'inbox' ? messagesService.inbox(filters) : messagesService.sent(filters),
    { ...defaultConfig, ...config }
  );
}

export function useUnreadNotificationCount(enabled: boolean = true, config?: SWRConfiguration) {
  return useSWR(
    enabled ? 'notifications-unread-count' : null,
    () => notificationsService.unreadCount(),
    { ...defaultConfig, ...config },
  );
}

export function useUnreadMessageCount(config?: SWRConfiguration) {
  return useSWR(
    'messages-unread-count',
    () => messagesService.unreadCount(),
    { ...defaultConfig, refreshInterval: 60_000, ...config },
  );
}

export function useOpenFlagCount(config?: SWRConfiguration) {
  return useSWR(
    'flags-open-count',
    async () => {
      const stats = await flagsService.getStats();
      return stats.open ?? 0;
    },
    { ...defaultConfig, refreshInterval: 120_000, ...config },
  );
}

export function useAggregateTemplates(
  filters?: { project?: string; organization?: string },
  config?: SWRConfiguration
) {
  return useSWR(
    ['aggregate-templates', filters],
    () => aggregatesService.getTemplates(filters),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Reports Hooks
// ============================================================================

export function useReports(filters?: ReportFilters, config?: SWRConfiguration) {
  return useSWR(
    ['reports', filters],
    () => reportsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useDashboardCharts(config?: SWRConfiguration) {
  return useSWR(
    'dashboard-charts',
    () => dashboardChartsService.list(),
    { ...defaultConfig, ...config }
  );
}

export function useDashboardSettings(filters?: DashboardSettingsFilters, config?: SWRConfiguration) {
  return useSWR(
    ['dashboard-settings', filters],
    () => dashboardSettingsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useDashboardSetting(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['dashboard-setting', id] : null,
    () => dashboardSettingsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useDashboardMeta(config?: SWRConfiguration) {
  return useSWR(
    'dashboard-meta',
    () => dashboardSettingsService.getMeta(),
    { ...defaultConfig, ...config }
  );
}

export function useDashboardBreakdowns(config?: SWRConfiguration) {
  return useSWR(
    'dashboard-breakdowns',
    () => dashboardSettingsService.getBreakdowns(),
    { ...defaultConfig, ...config }
  );
}

export function usePivotTables(filters?: PivotTableFilters, config?: SWRConfiguration) {
  return useSWR(
    ['pivot-tables', filters],
    () => pivotTablesService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function usePivotTable(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['pivot-table', id] : null,
    () => pivotTablesService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useLineLists(filters?: LineListFilters, config?: SWRConfiguration) {
  return useSWR(
    ['line-lists', filters],
    () => lineListsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useLineList(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['line-list', id] : null,
    () => lineListsService.get(id!),
    { ...defaultConfig, ...config }
  );
}

export function useCoordinatorTargets(filters?: CoordinatorTargetFilters, config?: SWRConfiguration) {
  return useSWR(
    ['coordinator-targets', filters],
    () => coordinatorTargetsService.list(filters),
    { ...defaultConfig, ...config },
  );
}

export function useAllCoordinatorTargets(filters?: CoordinatorTargetFilters, config?: SWRConfiguration) {
  return useSWR(
    ['coordinator-targets-all', filters],
    async () => {
      const results = await coordinatorTargetsService.listAll(filters);
      return { count: results.length, next: null, previous: null, results };
    },
    { ...defaultConfig, ...config },
  );
}

export function useCoordinatorTarget(id: number | null, config?: SWRConfiguration) {
  return useSWR(
    id ? ['coordinator-target', id] : null,
    () => coordinatorTargetsService.get(id!),
    { ...defaultConfig, ...config },
  );
}

export function useCoordinatorTargetPerformance(filters?: CoordinatorTargetFilters, config?: SWRConfiguration) {
  return useSWR(
    ['coordinator-target-performance', filters],
    () => coordinatorTargetsService.getPerformance(filters),
    { ...defaultConfig, ...config },
  );
}

export function useScheduledReports(config?: SWRConfiguration) {
  return useSWR(
    'scheduled-reports',
    () => reportsService.listScheduled(),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Analysis Hooks
// ============================================================================

export function useDashboardStats(
  filters?: number | DashboardOverviewFilters,
  config?: SWRConfiguration,
) {
  return useSWR(
    ['dashboard', filters],
    () => analysisService.getDashboard(filters),
    { ...defaultConfig, ...config }
  );
}

export function useDashboardMessageAnalytics(
  filters?: number | DashboardOverviewFilters,
  config?: SWRConfiguration,
) {
  return useSWR(
    ['dashboard-message-analytics', filters],
    () => analysisService.getDashboardMessageAnalytics(filters),
    { ...defaultConfig, ...config }
  );
}

export function useIndicatorTrends(
  indicatorId: number | null,
  params?: {
    months?: number;
    projectId?: number | null;
    coordinatorId?: number | null;
    organizationId?: number | null;
    dateFrom?: string;
    dateTo?: string;
  },
  config?: SWRConfiguration,
) {
  return useSWR(
    indicatorId ? ['indicator-trends', indicatorId, params] : null,
    () => analysisService.getIndicatorTrends(indicatorId!, params),
    { ...defaultConfig, ...config }
  );
}

export function useIndicatorTrendsBulk(
  indicatorIds: number[] | null,
  params?: {
    months?: number;
    projectId?: number | null;
    coordinatorId?: number | null;
    organizationId?: number | null;
    dateFrom?: string;
    dateTo?: string;
  },
  config?: SWRConfiguration,
) {
  return useSWR(
    indicatorIds && indicatorIds.length ? ['indicator-trends-bulk', indicatorIds, params] : null,
    () => analysisService.getIndicatorTrendsBulk(indicatorIds!, params),
    { ...defaultConfig, ...config }
  );
}

// ============================================================================
// Flags Hooks
// ============================================================================

export function useFlags(filters?: FlagFilters, config?: SWRConfiguration) {
  return useSWR(
    ['flags', filters],
    () => flagsService.list(filters),
    { ...defaultConfig, ...config }
  );
}

export function useFlagStats(config?: SWRConfiguration) {
  return useSWR(
    'flag-stats',
    () => flagsService.getStats(),
    { ...defaultConfig, ...config }
  );
}


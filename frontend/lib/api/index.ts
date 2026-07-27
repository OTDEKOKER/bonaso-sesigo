/**
 * BONASO Data Portal - API Services
 * 
 * Central export for all API services.
 * 
 * Usage:
 *   import { authService, projectsService } from '@/lib/api';
 *   
 *   // Login
 *   const { token, user } = await authService.login({ username, password });
 *   
 *   // Fetch projects
 *   const projects = await projectsService.list({ status: 'active' });
 * 
 * Configuration:
 *   Set NEXT_PUBLIC_API_URL in your environment variables to point to your Django API.
 *   Example: NEXT_PUBLIC_API_URL=https://sesigo.org.bw/api
 */

// Core client
export {
  api,
  fetchWithAuth,
  normalizeApiError,
  setAuthToken,
  clearAuthToken,
  setAuthTokens,
  clearAuthTokens,
  getRefreshToken,
} from './client';
export type { ApiResponse, ApiError, PaginatedResponse } from './client';

// Authentication
export { authService } from './services/auth';
export type {
  LoginCredentials,
  LoginResponse,
  PasswordChangeRequest,
  PasswordResetRequest,
  PasswordResetConfirm,
} from './services/auth';

// Organizations
export { organizationsService } from './services/organizations';
export type {
  OrganizationFilters,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
} from './services/organizations';

// Users
export { usersService } from './services/users';
export type {
  UserFilters,
  CreateUserRequest,
  UpdateUserRequest,
  UserActivity,
  UserPermissionOption,
  ModulePermissionRow,
  ModulePermissionsResponse,
} from './services/users';

// Projects, Tasks & Deadlines
export { projectsService, tasksService, deadlinesService, projectActivitiesService, clientOrganizationsService, narrativeReportsService } from './services/projects';
export type { ProjectActivity, ProjectActivityFilters, CreateProjectActivityRequest, UpdateProjectActivityRequest, ClientOrganization, ClientOrganizationFilters, CreateClientOrganizationRequest, NarrativeReport, NarrativeReportFilters } from './services/projects';
export type {
  ProjectFilters,
  CreateProjectRequest,
  UpdateProjectRequest,
  TaskFilters,
  CreateTaskRequest,
  UpdateTaskRequest,
  DeadlineFilters,
  CreateDeadlineRequest,
  UpdateDeadlineRequest,
  TargetRequest,
  ProjectOrganizationRoleRequest,
  ProjectDisaggregationRuleRequest,
  ProjectIndicatorAssignmentRequest,
} from './services/projects';

// Indicators & Assessments
export { indicatorsService, assessmentsService } from './services/indicators';
export type {
  IndicatorFilters,
  CreateIndicatorRequest,
  UpdateIndicatorRequest,
  DuplicateCandidatePair,
  DuplicateCandidatesResponse,
  MergeIndicatorRequest,
  AssessmentFilters,
  CreateAssessmentRequest,
  UpdateAssessmentRequest,
  SaveAssessmentQuestionRequest,
} from './services/indicators';

// Respondents & Interactions
export { respondentsService, interactionsService, responsesService } from './services/respondents';
export type {
  RespondentFilters,
  CreateRespondentRequest,
  UpdateRespondentRequest,
  InteractionFilters,
  CreateInteractionRequest,
  UpdateInteractionRequest,
  ResponseFilters,
  CreateResponseRequest,
  UpdateResponseRequest,
  RespondentImportRequest,
  RespondentExportRequest,
} from './services/respondents';

// Events
export { eventsService } from './services/events';
export type {
  EventFilters,
  CreateEventRequest,
  UpdateEventRequest,
  EventParticipant,
  AddParticipantRequest,
} from './services/events';

// Social Media
export { socialPostsService } from './services/social';
export type { SocialPostFilters, CreateSocialPostRequest, UpdateSocialPostRequest } from './services/social';

// Aggregates
export { aggregatesService } from './services/aggregates';
export type {
  AggregateFilters,
  CreateAggregateRequest,
  UpdateAggregateRequest,
  BulkAggregateRequest,
  AggregateTemplate,
  DerivationRule,
  DetectCopyPasteResult,
  AggregateFlagRequest,
} from './services/aggregates';

// Reports, Analysis & Flags
export { reportsService, analysisService, flagsService, dashboardChartsService } from './services/reports';
export type {
  Report,
  DashboardChart,
  ReportFilters,
  CreateReportRequest,
  ScheduledReport,
  CreateScheduledReportRequest,
  AnalysisQuery,
  AnalysisResult,
  DashboardOverviewFilters,
  DashboardMessageAnalyticsResponse,
  FlagFilters,
  CreateFlagRequest,
  UpdateFlagRequest,
} from './services/reports';

// Legacy Analytics
export { dashboardSettingsService, requestLogsService } from './services/analytics';
export type {
  ChartField,
  ChartFieldName,
  ChartFilter,
  LegacyChartType,
  LegacyChartAxis,
  IndicatorChartSetting,
  DashboardIndicatorChart,
  DashboardFilter,
  DashboardSetting,
  DashboardMeta,
  DashboardSettingsFilters,
  DashboardSettingRequest,
  DashboardChartRequest,
  RequestLog,
} from './services/analytics';

// Coordinator Portfolio Targets
export { coordinatorTargetsService } from "./services/coordinator-targets";
export type {
  CoordinatorTargetQuarter,
  CoordinatorTarget,
  CoordinatorTargetFilters,
  CreateCoordinatorTargetRequest,
  UpdateCoordinatorTargetRequest,
  CoordinatorTargetBulkAssignRequest,
  CoordinatorTargetChildContribution,
} from "./services/coordinator-targets";

// Uploads
export { uploadsService } from './services/uploads';
export type { UploadFilters, CreateUploadRequest, UpdateUploadRequest, UploadRecord, ImportJob } from './services/uploads';

// Messaging
export { notificationsService, messagesService, announcementsService } from './services/messaging';
export type { NotificationFilters, MessageFilters, CreateMessageRequest, AnnouncementFilters, CreateAnnouncementRequest } from './services/messaging';

// Support / help desk
export {
  supportService,
  SUPPORT_CATEGORIES, SUPPORT_STATUSES, SUPPORT_SEVERITIES, SUPPORT_PRIORITIES,
} from './services/support';
export type {
  SupportTicket, SupportComment, SupportHistoryEvent, SupportStats,
  SupportTicketFilters, CreateSupportTicket,
  SupportStatus, SupportSeverity, SupportPriority,
} from './services/support';

// System operations
export { systemService } from './services/system';
export type { SystemHealthStatus, SystemStatusResponse, BackupManagementStatus, BackupReminderLevel, RestoreValidationResult, RestoreHistoryEntry, SystemIssue, IssueSeverity, IssueStatus } from './services/system';

// Audit / activity log
export { auditService } from './services/audit';
export type { AuditEvent, AuditActionOption, AuditEventFilters, ActiveUser } from './services/audit';

export { workbookLayoutsService } from './services/workbook-layouts';
export type { WorkbookLayout, WorkbookLayoutItem, WorkbookLayoutAvailableIndicator, SaveWorkbookLayoutRequest } from './services/workbook-layouts';

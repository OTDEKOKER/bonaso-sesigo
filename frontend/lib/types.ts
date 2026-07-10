import React from "react"
import type { AggregateDisaggregationConfig } from "@/lib/indicators/disaggregation-presets"
// User & Auth Types
export type UserRole = 'admin' | 'manager' | 'officer' | 'collector' | 'client'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  /** Which Sesigo environment(s) the user may sign in to (enforced at login). */
  environment_access?: "both" | "live" | "training"
  permissions?: string[]
  groups?: string[]
  home_dashboard_preferences?: unknown
  organizationId: string
  clientOrganizationId?: string
  avatar?: string
  createdAt: string
  lastLogin?: string
  // Project-assignment scope (snake_case: returned as-is by /api/users/me/).
  // The user's current/default project for the dashboard, and the set of
  // projects they are assigned to (empty/undefined = no restriction yet).
  default_project_id?: number | null
  assigned_projects?: number[]
  // Effective module permissions resolved by the backend (/api/users/me/):
  // { module: [actions] }. Backend remains the source of truth; this drives
  // sidebar visibility, route guards and in-module action gating.
  module_permissions?: Record<string, string[]>
  // True only when an admin has explicitly configured this user's module
  // permissions. The UI restricts access ONLY when this is true, so existing
  // (un-configured) users keep their full role-based experience.
  module_permissions_enforced?: boolean
}

export interface Profile extends User {
  phone?: string
  jobTitle?: string
  department?: string
}

export interface Notification {
  id: string
  title: string
  content: string
  link?: string
  is_read: boolean
  created_at: string
}

export interface Announcement {
  id: string
  title: string
  content: string
  scope: 'global' | 'organization' | 'project'
  organization?: string | null
  organization_name?: string
  project?: string | null
  project_name?: string
  created_by?: string | null
  created_by_name?: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  sender: string | null
  sender_name?: string
  recipient: string
  recipient_name?: string
  message_type: 'notification' | 'alert' | 'message' | 'reminder'
  subject: string
  content: string
  is_read: boolean
  read_at?: string | null
  created_at: string
}

// Organization Types
export interface Organization {
  id: string
  name: string
  type:
    | 'funder'
    | 'senior_coordinator'
    | 'coordinator'
    | 'subgrantee'
    | 'headquarters'
    | 'regional'
    | 'district'
    | 'partner'
    | 'ngo'
    | 'government'
  code?: string
  parentId?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
  description?: string
  is_active?: boolean
  dashboard_config?: Record<string, unknown>
  createdAt: string
}

// Indicator Types
export type IndicatorCategory =
  | 'hiv_prevention'
  | 'ncd'
  | 'mental_health'
  | 'gbv'
  | 'sti'
  | 'trainings'
  | 'media'
  | 'events'
export type IndicatorType =
  | 'yes_no'
  | 'number'
  | 'percentage'
  | 'text'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'multi_int'

export interface Indicator {
  id: string
  name: string
  short_name?: string
  code: string
  description?: string
  category: IndicatorCategory
  type: IndicatorType
  unit?: string
  options?: Array<string | { label: string; value: string }>
  sub_labels?: string[]
  aggregate_disaggregation_config?: AggregateDisaggregationConfig
  denominator_indicator?: number | null
  denominator_indicator_detail?: { id: number; name: string; code?: string } | null
  aggregation_method?: 'sum' | 'average' | 'count' | 'latest'
  is_active: boolean
  is_deprecated?: boolean
  canonical_indicator?: string | null
  canonical_indicator_detail?: { id: string; name: string; code: string } | null
  deprecated_variants_count?: number
  organizations?: string[]
  created_at: string
  updated_at: string
  project_targets?: ProjectIndicatorTarget[]
}

export interface ProjectIndicatorTarget {
  id: string
  project: string
  project_name?: string
  project_code?: string
  indicator: string
  indicator_name?: string
  indicator_code?: string
  target_group?: string
  organization: string
  organization_name?: string
  organization_code?: string
  q1_target?: number
  q2_target?: number
  q3_target?: number
  q4_target?: number
  target_value: number
  current_value: number
  baseline_value: number
  progress: number
}

export interface ProjectOrganizationMembership {
  id: string
  project: string
  client?: string | null
  client_name?: string | null
  organization: string
  organization_name?: string
  organization_code?: string
  parent_assignment?: string | null
  parent_organization?: string | null
  parent_organization_name?: string | null
  role:
    | "lead"
    | "coordinator"
    | "sub_grantee"
    | "implementing_partner"
    | "data_reviewer"
    | "funder"
    | "other"
  cluster?: string
  is_coordinator?: boolean
  is_sub_grantee?: boolean
  is_implementer?: boolean
  can_report_indicators?: boolean
  partner_type?: string
  thematic_areas?: string[]
  districts?: string[]
  localities?: string[]
  contract_start_date?: string | null
  contract_end_date?: string | null
  source_sheet?: string
  source_row?: number | null
  is_training?: boolean
  is_active: boolean
  implementation_scope?: Record<string, unknown>
  assigned_indicator_count?: number
  reported_indicator_count?: number
  reporting_status?: "reporting" | "partially_reporting" | "not_reporting" | "not_assigned" | "reporting_disabled"
}

export interface ProjectHierarchyLink {
  id: string
  project: string
  parent_organization: string
  parent_organization_name?: string
  child_organization: string
  child_organization_name?: string
  is_active: boolean
}

export interface ProjectIndicatorAssignment {
  id: string
  project: string
  project_indicator: string
  project_organization?: string | null
  indicator: string
  indicator_name?: string
  indicator_code?: string
  organization: string
  organization_name?: string
  organization_code?: string
  assignment_source?: "project_scope" | "organization_target" | "manual" | "aggregate_history" | "workbook_layout"
  is_active: boolean
  assignment_metadata?: Record<string, unknown>
}

export interface ProjectDisaggregationRule {
  id: string
  project: string
  project_indicator: string
  indicator: string
  indicator_name?: string
  indicator_code?: string
  organization?: string | null
  organization_name?: string | null
  dimension_key: string
  display_label?: string
  is_required?: boolean
  is_active?: boolean
  sort_order?: number
  config?: Record<string, unknown>
}

export interface IndicatorOption {
  id: string
  indicatorId: string
  label: string
  value: string
  order: number
}

export interface AssessmentQuestionOption {
  label: string
  value: string
}

export interface AssessmentQuestion {
  id: string
  assessment: string
  indicator: string
  indicator_detail?: {
    id: string
    name: string
    code: string
    type: IndicatorType
    category: IndicatorCategory
  }
  question_text?: string
  question_text_display?: string
  help_text?: string
  response_type?: IndicatorType | ""
  response_type_display?: IndicatorType
  response_options?: Array<string | AssessmentQuestionOption>
  response_options_display?: Array<string | AssessmentQuestionOption>
  response_sub_labels?: string[]
  response_sub_labels_display?: string[]
  aggregate_mode?: "none" | "count_all" | "count_selected" | "sum_numeric"
  aggregate_match_values?: unknown[]
  order: number
  is_required: boolean
  depends_on?: string | null
  condition_value?: unknown
}

export interface Assessment {
  id: string
  name: string
  description?: string
  indicators: string[]
  indicators_detail?: AssessmentQuestion[]
  indicators_count?: number
  logic_rules?: Record<string, unknown>
  is_active: boolean
  organizations?: string[]
  created_at: string
  updated_at: string
}

// Project Types
export interface Project {
  id: string
  name: string
  code: string
  description?: string
  funder?: string
  status: 'draft' | 'active' | 'completed' | 'archived'
  start_date: string
  end_date: string
  organizations: string[]
  indicators_count?: number
  tasks_count?: number
  progress_percentage?: number
  created_at: string
  updated_at: string
  hierarchy_overrides?: Record<string, string[]>
  client_organizations?: Array<{ id: string; name: string }>
  /** True for the Training Project — data excluded from official reports by default. */
  is_training?: boolean
  training_expires_after_days?: number
  training_notes?: string
  project_indicators?: ProjectIndicatorTarget[]
  organization_targets?: ProjectIndicatorTarget[]
  project_organizations?: ProjectOrganizationMembership[]
  project_hierarchy_links?: ProjectHierarchyLink[]
  project_indicator_assignments?: ProjectIndicatorAssignment[]
  project_disaggregation_rules?: ProjectDisaggregationRule[]
  project_setup_ready?: boolean
}

export interface Task {
  id: string
  project: string
  project_name?: string
  name: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string | null
  assigned_to_name?: string
  due_date?: string | null
  completed_at?: string | null
  created_at: string
  updated_at: string
}

export interface Target {
  id: string
  taskId: string
  value: number
  period: 'monthly' | 'quarterly' | 'yearly'
  startDate: string
  endDate: string
}

export interface ProjectDeadline {
  id: string
  project: string
  project_name?: string
  name: string
  description?: string
  due_date: string
  status: 'pending' | 'submitted' | 'approved' | 'overdue'
  indicators?: string[]
  submitted_at?: string | null
  submitted_by?: string | null
  submitted_by_name?: string
  days_remaining?: number | null
  created_at: string
  updated_at: string
}

// Respondent Types
export interface Respondent {
  id: string
  unique_id: string
  first_name: string
  last_name: string
  full_name?: string
  gender?: 'male' | 'female' | 'other'
  date_of_birth?: string | null
  phone?: string
  email?: string
  address?: string
  organization: string
  organization_name?: string
  demographics?: Record<string, unknown>
  is_active: boolean
  interactions_count?: number
  last_interaction?: string | null
  interactions?: Interaction[]
  created_at: string
  updated_at: string
}

export interface Interaction {
  id: string
  respondent: string
  respondent_name?: string
  assessment?: string | null
  assessment_name?: string | null
  project?: string | null
  project_name?: string | null
  event?: string | null
  event_name?: string | null
  date: string
  notes?: string
  responses?: Response[]
  responses_count?: number
  created_at: string
  updated_at: string
}

export interface Response {
  id: string
  interaction: string
  indicator: string
  indicator_name?: string
  indicator_code?: string
  indicator_type?: IndicatorType
  value: unknown
  created_at: string
  updated_at: string
}

// Aggregate Types
export interface AggregateGroup {
  id: string
  projectId: string
  indicatorId: string
  organizationId: string
  periodStart: string
  periodEnd: string
  counts: AggregateCount[]
  createdAt: string
}

export interface AggregateCount {
  id: string
  groupId: string
  sex?: string
  ageRange?: string
  optionId?: string
  value: number
  isFlagged: boolean
}
export interface Aggregate {
  id: string
  indicator: string
  indicator_name?: string
  indicator_code?: string
  project: string
  project_name?: string
  organization: string
  organization_name?: string
  period_start: string
  period_end: string
  value: unknown
  notes?: string
  copy_paste_verified?: boolean
  status: 'draft' | 'pending' | 'reviewed' | 'flagged' | 'approved' | 'rejected'
  reviewed_at?: string | null
  reviewed_by?: string | null
  reviewed_by_name?: string
  created_at: string
  updated_at: string
  history_entries?: AggregateHistoryEntry[]
}

export interface AggregateHistoryChange {
  label?: string
  from: unknown
  to: unknown
}

export interface AggregateHistoryEntry {
  id: string
  action: 'submitted' | 'corrected' | 'reviewed' | 'flagged' | 'approved'
  comment?: string
  changes?: Record<string, AggregateHistoryChange>
  created_at: string
  changed_by?: string | null
  changed_by_name?: string
}

// Event Types
export interface Event {
  id: string
  title: string
  description?: string
  type: 'training' | 'meeting' | 'outreach' | 'workshop' | 'other'
  status: 'planned' | 'ongoing' | 'completed' | 'cancelled'
  project?: string | null
  project_name?: string
  organization: string
  organization_name?: string
  participating_organizations?: string[]
  start_date: string
  end_date?: string | null
  location?: string
  expected_participants?: number
  actual_participants?: number
  participants_count?: number
  attendance_rate?: number
  budget?: number
  actual_cost?: number
  indicators?: string[]
  checkin_token?: string
  participants?: EventParticipant[]
  phases?: EventPhase[]
  created_at: string
  updated_at: string
}

export interface EventParticipant {
  id: string
  event: string
  respondent?: string | null
  respondent_name?: string
  name?: string
  gender?: string
  contact?: string
  attended?: boolean
  notes?: string
  created_at?: string
}

export interface EventPhase {
  id: string
  event: string
  title: string
  description?: string
  status: 'planned' | 'ongoing' | 'completed'
  due_date?: string | null
  created_at?: string
}

export interface SocialPost {
  id: string
  title: string
  description?: string
  post_date?: string
  indicator: string
  indicator_name?: string
  organization?: string | null
  organization_name?: string
  platform: 'facebook' | 'instagram' | 'twitter' | 'tiktok' | 'youtube' | 'other'
  url: string
  views?: number
  likes?: number
  comments?: number
  shares?: number
  interactions?: number
  last_synced?: string | null
  created_at: string
  updated_at: string
}

// Upload Types
export interface NarrativeReport {
  id: string
  title: string
  projectId: string
  organizationId: string
  fileUrl: string
  fileType: 'pdf' | 'docx'
  uploadedById: string
  createdAt: string
}

// Analysis Types
export interface AnalysisQuery {
  projectId?: string
  organizationId?: string
  indicatorIds?: string[]
  startDate?: string
  endDate?: string
  groupBy?: 'organization' | 'period' | 'indicator'
}

export interface AnalysisResult {
  indicator: Indicator
  organization?: Organization
  period?: string
  target: number
  achieved: number
  percentage: number
}

// Flag Types
export type FlagType = 'data_quality' | 'follow_up' | 'urgent' | 'review' | 'other'
export type FlagStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed'
export type FlagPriority = 'low' | 'medium' | 'high' | 'critical'

export interface Flag {
  id: string
  flag_type: FlagType
  status: FlagStatus
  priority: FlagPriority
  title: string
  description: string
  content_type: string
  object_id: string
  organization: string
  assigned_to?: string | null
  resolution_notes?: string
  resolved_at?: string | null
  resolved_by?: string | null
  created_at: string
  updated_at: string
}

// Navigation Types
export interface NavItem {
  title: string
  href: string
  icon: string
  badge?: number
  children?: NavItem[]
}

// Table Types
export interface Column<T> {
  key: keyof T | string
  label: string
  sortable?: boolean
  render?: (item: T) => React.ReactNode
}



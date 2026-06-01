/**
 * Events & Social Media Service
 * 
 * CRUD operations for events and social media posts.
 * Django endpoint base: /api/activities/ and /api/social/
 */

import { api, type PaginatedResponse } from '../client';
import type { Event, EventPhase } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface EventFilters {
  search?: string;
  type?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  organization?: string;
  project?: string;
  page?: string;
  page_size?: string;
}

export interface CreateEventRequest {
  title: string;
  type: 'training' | 'meeting' | 'outreach' | 'workshop' | 'other';
  description?: string;
  status?: 'planned' | 'ongoing' | 'completed' | 'cancelled';
  start_date: string;
  end_date?: string;
  location?: string;
  organization: number;
  project?: number;
  expected_participants?: number;
  actual_participants?: number;
  budget?: number;
  actual_cost?: number;
  indicators?: number[];
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {
  status?: 'planned' | 'ongoing' | 'completed' | 'cancelled';
}

export interface EventParticipant {
  id: number;
  event: number;
  respondent?: number;
  name?: string;
  gender?: string;
  attended: boolean;
  contact?: string;
  notes?: string;
  created_at?: string;
}

export interface AddParticipantRequest {
  respondent_id?: number;
  name?: string;
  gender?: string;
  contact?: string;
  notes?: string;
}

export interface CreatePhaseRequest {
  event: number;
  title: string;
  description?: string;
  status?: 'planned' | 'ongoing' | 'completed';
  due_date?: string;
}

export type UpdatePhaseRequest = Partial<CreatePhaseRequest>

// ============================================================================
// Events Service
// ============================================================================

export const eventsService = {
  /**
   * List all events with optional filters
   * Django endpoint: GET /api/activities/
   */
  async list(filters?: EventFilters): Promise<PaginatedResponse<Event>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Event>>('/activities/', params);
    return data;
  },

  /**
   * Get a single event by ID
   * Django endpoint: GET /api/activities/:id/
   */
  async get(id: number): Promise<Event> {
    const { data } = await api.get<Event>(`/activities/${id}/`);
    return data;
  },

  /**
   * Create a new event
   * Django endpoint: POST /api/activities/
   */
  async create(request: CreateEventRequest): Promise<Event> {
    const { data } = await api.post<Event>('/activities/', request);
    return data;
  },

  /**
   * Update an event
   * Django endpoint: PATCH /api/activities/:id/
   */
  async update(id: number, request: UpdateEventRequest): Promise<Event> {
    const { data } = await api.patch<Event>(`/activities/${id}/`, request);
    return data;
  },

  /**
   * Delete an event
   * Django endpoint: DELETE /api/activities/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/activities/${id}/`);
  },

  /**
   * Get event participants
   * Django endpoint: GET /api/activities/participants/?event=:id
   */
  async getParticipants(id: number): Promise<EventParticipant[]> {
    const { data } = await api.get<EventParticipant[]>(`/activities/participants/`, { event: id.toString() });
    return data;
  },

  /**
   * Add participant to event
   * Django endpoint: POST /api/activities/:id/add_participant/
   */
  async addParticipant(id: number, request: AddParticipantRequest): Promise<EventParticipant> {
    const { data } = await api.post<EventParticipant>(`/activities/${id}/add_participant/`, request);
    return data;
  },

  /**
   * Remove participant from event
   * Django endpoint: DELETE /api/activities/participants/:participantId/
   */
  async removeParticipant(eventId: number, participantId: number): Promise<void> {
    await api.delete(`/activities/participants/${participantId}/`);
  },

  /**
   * Mark attendance for participant
   * Django endpoint: POST /api/activities/participants/:id/mark_attendance/
   */
  async markAttendance(eventId: number, participantId: number, attended: boolean): Promise<void> {
    await api.post(`/activities/participants/${participantId}/mark_attendance/`, {
      attended,
    });
  },

  /**
   * List phases for an event
   * Django endpoint: GET /api/activities/phases/?event=:id
   */
  async getPhases(eventId: number): Promise<EventPhase[]> {
    const { data } = await api.get<EventPhase[]>('/activities/phases/', { event: eventId.toString() });
    return data;
  },

  /**
   * Create a phase/activity for an event
   * Django endpoint: POST /api/activities/phases/
   */
  async createPhase(request: CreatePhaseRequest): Promise<EventPhase> {
    const { data } = await api.post<EventPhase>('/activities/phases/', request);
    return data;
  },

  /**
   * Update a phase/activity
   * Django endpoint: PATCH /api/activities/phases/:id/
   */
  async updatePhase(id: number, request: UpdatePhaseRequest): Promise<EventPhase> {
    const { data } = await api.patch<EventPhase>(`/activities/phases/${id}/`, request);
    return data;
  },

  /**
   * Delete a phase/activity
   * Django endpoint: DELETE /api/activities/phases/:id/
   */
  async deletePhase(id: number): Promise<void> {
    await api.delete(`/activities/phases/${id}/`);
  },

  /**
   * Get event types for filtering
   * Django endpoint: GET /api/activities/types/
   */
  async getTypes(): Promise<string[]> {
    const { data } = await api.get<Array<{ value: string }>>('/activities/types/');
    return data.map((item) => item.value);
  },

  /**
   * Get event statistics
   * Django endpoint: GET /api/activities/stats/
   */
  async getStats(): Promise<{
    total: number;
    completed: number;
    total_participants: number;
    by_type: Record<string, number>;
  }> {
    const { data } = await api.get('/activities/stats/');
    return data as {
      total: number;
      completed: number;
      total_participants: number;
      by_type: Record<string, number>;
    };
  },

  /**
   * Get upcoming events
   * Django endpoint: GET /api/activities/upcoming/
   */
  async getUpcoming(days: number = 30): Promise<Event[]> {
    const { data } = await api.get<Event[]>('/activities/upcoming/', { days: days.toString() });
    return data;
  },
};

export default eventsService;

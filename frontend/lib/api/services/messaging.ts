import { api, type PaginatedResponse } from "../client";
import type { Announcement, Message, Notification } from "@/lib/types";

// ============================================================================
// Messages Service
// ============================================================================

export interface MessageFilters {
  message_type?: string;
  is_read?: string;
  page?: string;
  page_size?: string;
}

export interface CreateMessageRequest {
  recipient: number;
  subject: string;
  content: string;
  message_type?: 'notification' | 'alert' | 'message' | 'reminder';
}

export const messagesService = {
  async list(filters?: MessageFilters): Promise<PaginatedResponse<Message>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Message>>('/messages/', params);
    return data;
  },

  async inbox(filters?: MessageFilters): Promise<Message[]> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<Message[]>('/messages/inbox/', params);
    return Array.isArray(data) ? data : (data as { results?: Message[] }).results || [];
  },

  async sent(filters?: MessageFilters): Promise<Message[]> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<Message[]>('/messages/sent/', params);
    return Array.isArray(data) ? data : (data as { results?: Message[] }).results || [];
  },

  async send(request: CreateMessageRequest): Promise<Message> {
    const { data } = await api.post<Message>('/messages/', request);
    return data;
  },

  async markRead(id: number): Promise<Message> {
    const { data } = await api.post<Message>(`/messages/${id}/mark_read/`, {});
    return data;
  },

  async markAllRead(): Promise<void> {
    await api.post('/messages/mark_all_read/', {});
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/messages/${id}/`);
  },

  async unreadCount(): Promise<number> {
    try {
      const { data } = await api.get<{ count: number }>('/messages/unread_count/');
      return Number(data?.count || 0);
    } catch {
      return 0;
    }
  },
};

export interface NotificationFilters {
  is_read?: string;
  page?: string;
  page_size?: string;
}

const NOTIFICATIONS_BASE = "/messages/notifications";

interface NotificationUnreadCountResponse {
  count: number;
}

export const notificationsService = {
  async list(filters?: NotificationFilters): Promise<PaginatedResponse<Notification>> {
    const params = filters ? ({ ...filters } as Record<string, string>) : undefined;
    const { data } = await api.get<PaginatedResponse<Notification>>(`${NOTIFICATIONS_BASE}/`, params);
    return data;
  },

  async listAll(filters?: NotificationFilters): Promise<Notification[]> {
    const results: Notification[] = [];
    let page = Number(filters?.page || 1);

    while (true) {
      const { data } = await api.get<PaginatedResponse<Notification>>(`${NOTIFICATIONS_BASE}/`, {
        ...filters,
        page: String(page),
      });
      results.push(...(data.results || []));
      if (!data.next) break;
      page += 1;
    }

    return results;
  },

  async markRead(id: number): Promise<Notification> {
    const { data } = await api.post<Notification>(`${NOTIFICATIONS_BASE}/${id}/mark_read/`, {});
    return data;
  },

  async markAllRead(): Promise<void> {
    await api.post(`${NOTIFICATIONS_BASE}/mark_all_read/`, {});
  },

  async unreadCount(): Promise<number> {
    try {
      const { data } = await api.get<NotificationUnreadCountResponse>(`${NOTIFICATIONS_BASE}/unread_count/`);
      return Number(data?.count || 0);
    } catch {
      const { data } = await api.get<PaginatedResponse<Notification>>(`${NOTIFICATIONS_BASE}/`, {
        is_read: "false",
        page: "1",
        page_size: "1",
      });
      return Number(data?.count || 0);
    }
  },
};

// ============================================================================
// Announcements Service
// ============================================================================

export interface AnnouncementFilters {
  scope?: string;
  organization?: string;
  project?: string;
  search?: string;
  page?: string;
  page_size?: string;
}

export interface CreateAnnouncementRequest {
  title: string;
  content: string;
  scope: 'global' | 'organization' | 'project';
  organization?: number;
  project?: number;
}

export type UpdateAnnouncementRequest = Partial<CreateAnnouncementRequest>;

export const announcementsService = {
  async list(filters?: AnnouncementFilters): Promise<PaginatedResponse<Announcement>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Announcement>>('/messages/announcements/', params);
    return data;
  },

  async create(request: CreateAnnouncementRequest): Promise<Announcement> {
    const { data } = await api.post<Announcement>('/messages/announcements/', request);
    return data;
  },

  async update(id: number, request: UpdateAnnouncementRequest): Promise<Announcement> {
    const { data } = await api.patch<Announcement>(`/messages/announcements/${id}/`, request);
    return data;
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/messages/announcements/${id}/`);
  },
};

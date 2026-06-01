/**
 * Social Media Posts Service
 *
 * CRUD operations for social posts.
 * Django endpoint base: /api/social/
 */

import { api, type PaginatedResponse } from "../client";
import type { SocialPost } from "@/lib/types";

// ============================================================================
// Types
// ============================================================================

export interface SocialPostFilters {
  search?: string;
  indicator?: string;
  organization?: string;
  platform?: string;
  page?: string;
  page_size?: string;
}

export interface CreateSocialPostRequest {
  title: string;
  description?: string;
  post_date?: string;
  indicator: number;
  organization?: number;
  platform?: "facebook" | "instagram" | "twitter" | "tiktok" | "youtube" | "other";
  url: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export type UpdateSocialPostRequest = Partial<CreateSocialPostRequest>

type RawSocialPost = SocialPost & {
  name?: string;
  published_at?: string;
  organization_id?: number | string | null;
  organization_detail?: { id?: number | string; name?: string } | null;
  indicator_detail?: { id?: number | string; name?: string } | null;
  link_to_post?: string;
  description?: string;
  post_date?: string;
};

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function normalizeSocialPost(post: RawSocialPost): SocialPost {
  return {
    ...post,
    title: post.title || post.name || "",
    indicator: String(post.indicator_detail?.id ?? post.indicator ?? ""),
    indicator_name: post.indicator_name || post.indicator_detail?.name,
    organization:
      post.organization !== undefined && post.organization !== null
        ? String(post.organization)
        : post.organization_id !== undefined && post.organization_id !== null
          ? String(post.organization_id)
          : null,
    organization_name:
      post.organization_name || post.organization_detail?.name,
    url: post.url || post.link_to_post || "",
    description: post.description,
    post_date: post.post_date || post.published_at,
  };
}

function buildSocialPostPayload(request: CreateSocialPostRequest | UpdateSocialPostRequest) {
  return stripUndefined({
    ...request,
    name: request.title,
    published_at: request.post_date,
    organization_id: request.organization,
    link_to_post: request.url,
  });
}

// ============================================================================
// Social Posts
// ============================================================================

export const socialPostsService = {
  async list(filters?: SocialPostFilters): Promise<PaginatedResponse<SocialPost>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<RawSocialPost>>(
      "/social/posts/",
      params,
    );
    return {
      ...data,
      results: (data.results || []).map(normalizeSocialPost),
    };
  },

  async get(id: number): Promise<SocialPost> {
    const { data } = await api.get<RawSocialPost>(`/social/posts/${id}/`);
    return normalizeSocialPost(data);
  },

  async create(request: CreateSocialPostRequest): Promise<SocialPost> {
    const { data } = await api.post<RawSocialPost>("/social/posts/", buildSocialPostPayload(request));
    return normalizeSocialPost(data);
  },

  async update(id: number, request: UpdateSocialPostRequest): Promise<SocialPost> {
    const { data } = await api.patch<RawSocialPost>(`/social/posts/${id}/`, buildSocialPostPayload(request));
    return normalizeSocialPost(data);
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/social/posts/${id}/`);
  },
};


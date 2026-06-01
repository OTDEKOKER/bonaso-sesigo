import { api } from "@/lib/api";
import type { ModuleCreateRequest, ModuleRecord, ModuleUpdateRequest } from "./types";

export const moduleService = {
  async list(): Promise<ModuleRecord[]> {
    const { data } = await api.get<ModuleRecord[]>("/modules/");
    return data || [];
  },
  async get(id: number): Promise<ModuleRecord> {
    const { data } = await api.get<ModuleRecord>(`/modules/${id}/`);
    if (!data) throw new Error("Module not found");
    return data;
  },
  async create(payload: ModuleCreateRequest): Promise<ModuleRecord> {
    const { data } = await api.post<ModuleRecord>("/modules/", payload);
    if (!data) throw new Error("Failed to create module");
    return data;
  },
  async update(id: number, payload: ModuleUpdateRequest): Promise<ModuleRecord> {
    const { data } = await api.patch<ModuleRecord>(`/modules/${id}/`, payload);
    if (!data) throw new Error("Failed to update module");
    return data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/modules/${id}/`);
  },
};

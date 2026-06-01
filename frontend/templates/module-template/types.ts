export interface ModuleRecord {
  id: number;
  name: string;
  code?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ModuleCreateRequest {
  name: string;
  code?: string;
  description?: string;
}

export type ModuleUpdateRequest = Partial<ModuleCreateRequest>

import type { ModuleRecord } from "./types";

export const formatModuleLabel = (record: ModuleRecord) => {
  return record.code ? `${record.name} (${record.code})` : record.name;
};

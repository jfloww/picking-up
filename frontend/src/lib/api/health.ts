import { apiRequest } from "./server";

export interface BackendHealth {
  status: string;
  service: string;
  version: string;
  commit: string;
  environment: string;
}

export async function requestHealth(): Promise<BackendHealth> {
  return apiRequest<BackendHealth>("/api/health/");
}

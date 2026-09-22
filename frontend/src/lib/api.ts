import type { LocationsResponse } from "./types";

// Set VITE_API_BASE_URL at build time (GitHub Actions secret/var) to your
// deployed Vercel backend, e.g. https://atis-radio-backend.vercel.app
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export function fetchLocations(): Promise<LocationsResponse> {
  return getJson<LocationsResponse>("/api/locations");
}

export function streamUrl(): string {
  return `${API_BASE}/api/stream`;
}

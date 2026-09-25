/**
 * ATIS-only domain types, mirroring the backend's /api/atis contract,
 * which itself mirrors 24data's GET /atis response exactly. No
 * controller-position types exist anywhere in this app.
 */

export interface AtisData {
  airport: string;
  letter: string;
  content: string;
  lines: string[];
  editor: string | null;
  fetchedAt: number;
}

export interface AtisListResponse {
  atis: AtisData[];
  generatedAt: number;
  source: "live" | "cache-stale" | "cache-error-fallback";
  meta: {
    totalAirports: number;
  };
}

export type NormalizedPositionKind =
  | "DEL"
  | "GND"
  | "TWR"
  | "APP"
  | "DEP"
  | "CTR"
  | "FSS"
  | "ATIS"
  | "UNKNOWN";

export interface ControllerPosition {
  holder: string | null;
  heldSince: number | null;
  claimable: boolean;
  airport: string;
  position: NormalizedPositionKind;
  rawPosition: string;
  queue: string[];
}

export interface AtisData {
  airport: string;
  letter: string | null;
  content: string;
  lines: string[];
  editor: string | null;
  fetchedAt: number;
}

export type AtisStatus = "available" | "unavailable" | "stale" | "updating";

export interface AirportLocation {
  code: string;
  name: string | null;
  frequency: string | null;
  controllerPositions: ControllerPosition[];
  hasController: boolean;
  atis: AtisData | null;
  atisStatus: AtisStatus;
  lastUpdated: number | null;
}

export interface LocationsResponse {
  locations: AirportLocation[];
  generatedAt: number;
  source: "live" | "cache-stale" | "cache-error-fallback";
  meta: {
    totalLocations: number;
    withAtis: number;
    withController: number;
  };
}

import type { AirportLocation } from "../lib/types";

interface LocationListProps {
  locations: AirportLocation[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
  loading: boolean;
}

export function LocationList({ locations, selectedCode, onSelect, loading }: LocationListProps) {
  if (loading && locations.length === 0) {
    return (
      <div className="location-list" role="status" aria-label="Loading locations">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="location-row location-row--skeleton" />
        ))}
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="location-list-empty">
        <p>No airports match that search.</p>
        <p className="location-list-empty__hint">Try a shorter code, like the first two or three letters.</p>
      </div>
    );
  }

  return (
    <ul className="location-list" role="listbox" aria-label="ATC24 airport locations">
      {locations.map((loc) => {
        const isSelected = loc.code === selectedCode;
        return (
          <li key={loc.code}>
            <button
              type="button"
              className={`location-row${isSelected ? " location-row--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(loc.code)}
            >
              <span className="location-row__code">{loc.code}</span>
              <span className="location-row__status">
                <StatusDot location={loc} />
                {statusLabel(loc)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function statusLabel(loc: AirportLocation): string {
  if (loc.atis) return `ATIS ${loc.atis.letter ?? "—"}`;
  if (loc.hasController) return "Staffed";
  return "No ATC";
}

function StatusDot({ location }: { location: AirportLocation }) {
  const variant = location.atis ? "active" : location.hasController ? "staffed" : "idle";
  return <span className={`status-dot status-dot--${variant}`} aria-hidden="true" />;
}

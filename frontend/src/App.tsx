import { useEffect, useMemo, useState } from "react";
import { SearchBox } from "./components/SearchBox";
import { LocationList } from "./components/LocationList";
import { RadioPanel } from "./components/RadioPanel";
import { useLiveLocations } from "./hooks/useLiveLocations";
import { useRadioAudio } from "./hooks/useRadioAudio";
import "./App.css";

export default function App() {
  const { locations, generatedAt, mode, error } = useLiveLocations();
  const { power, speaking, enable, disable, speak, keyClick } = useRadioAudio();

  const [query, setQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return locations;
    return locations.filter((loc) => loc.code.includes(q));
  }, [locations, query]);

  // Auto-select the first result when the current selection drops out of
  // view (e.g. after a search) but don't fight the user's own selection.
  useEffect(() => {
    if (selectedCode && locations.some((l) => l.code === selectedCode)) return;
    if (filtered.length > 0 && filtered[0]) {
      setSelectedCode(filtered[0].code);
    }
  }, [filtered, locations, selectedCode]);

  const selectedLocation = locations.find((l) => l.code === selectedCode) ?? null;

  const handleSelect = (code: string) => {
    keyClick();
    setSelectedCode(code);
  };

  const handleTogglePower = () => {
    if (power === "off") {
      enable();
    } else {
      disable();
    }
  };

  const handlePlay = () => {
    if (!selectedLocation?.atis) return;
    const letterPrefix = selectedLocation.atis.letter
      ? `${selectedLocation.code}, information ${selectedLocation.atis.letter}. `
      : `${selectedLocation.code} ATIS. `;
    speak(letterPrefix + selectedLocation.atis.content);
  };

  const connectionLabel =
    mode === "live"
      ? "LIVE"
      : mode === "polling"
        ? "POLLING"
        : mode === "connecting"
          ? "CONNECTING"
          : "OFFLINE";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>ATIS Radio</h1>
          <p className="app-header__sub">Live ATC24 station data via the 24data network</p>
        </div>
        <div className="app-header__meta">
          {generatedAt && (
            <span className="app-header__updated">
              Updated {formatRelativeTime(generatedAt)}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="app-banner app-banner--error" role="alert">
          Having trouble reaching the data service — showing the most recent information available.
        </div>
      )}

      <main className="app-layout">
        <section className="app-sidebar" aria-label="Airport search and list">
          <SearchBox value={query} onChange={setQuery} resultCount={filtered.length} />
          <LocationList
            locations={filtered}
            selectedCode={selectedCode}
            onSelect={handleSelect}
            loading={locations.length === 0 && mode !== "offline"}
          />
        </section>

        <section className="app-radio-stage" aria-label="ATIS radio">
          <RadioPanel
            location={selectedLocation}
            power={power}
            speaking={speaking}
            onTogglePower={handleTogglePower}
            onPlay={handlePlay}
            connectionLabel={connectionLabel}
            connectionOk={mode === "live" || mode === "polling"}
          />
        </section>
      </main>

      <footer className="app-footer">
        <p>
          Unofficial fan tool. Not affiliated with ATC24 or PTFS. Data sourced from the public
          24data API for flight simulation use only.
        </p>
      </footer>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diffSeconds = Math.round((Date.now() - timestamp) / 1000);
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
}

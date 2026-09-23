/**
 * Deterministic, stable virtual COM frequency assignment.
 *
 * Requirement: the same airport code must always map to the same
 * frequency, independent of array position/order. We derive it from a
 * simple stable string hash of the airport code, so IRFD always gets the
 * same frequency whether it's item 0 or item 3 in the current /atis list,
 * and whether or not other airports are present.
 *
 * Real-world VHF airband channels are typically spaced in 25kHz/8.33kHz
 * steps within roughly 118.000–136.975. We map the hash into the
 * 118.000–121.975 range in 25kHz steps (a plausible ATIS/tower band) and
 * format like a real COM frequency, e.g. "118.025".
 */

const BAND_MIN_KHZ = 118_000;
const BAND_MAX_KHZ = 121_975;
const STEP_KHZ = 25;
const STEP_COUNT = Math.floor((BAND_MAX_KHZ - BAND_MIN_KHZ) / STEP_KHZ) + 1;

function stableHash(input: string): number {
  // Small, dependency-free, deterministic 32-bit string hash (djb2
  // variant). Not cryptographic — just needs to be stable and well
  // distributed across short ICAO-style codes.
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Returns a stable, deterministic "XXX.XXX" MHz frequency string for a
 * given airport code. Always returns the same value for the same code. */
export function frequencyForAirport(airportCode: string): string {
  const code = airportCode.trim().toUpperCase();
  const hash = stableHash(code);
  const stepIndex = hash % STEP_COUNT;
  const khz = BAND_MIN_KHZ + stepIndex * STEP_KHZ;
  const mhz = khz / 1000;
  return mhz.toFixed(3);
}

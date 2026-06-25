import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Station name -> CRS code. Seeded from the bundled full National Rail dataset (~2,600 stations,
// derived from davwheat/uk-railway-stations). Read via fs rather than `import ... json` so it works
// uniformly under tsx, node and vitest without import-attribute / resolveJsonModule fuss.
const CRS: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL("./stations-data.json", import.meta.url)), "utf8"),
);

// Common short names people and email parsers actually use, which the official dataset only spells
// out in full (e.g. "Edinburgh" -> "Edinburgh Waverley"). Each maps to that city's principal
// station. Merged on top so both the short and official forms resolve.
const ALIASES: Record<string, string> = {
  "Edinburgh": "EDB", // Edinburgh Waverley
  "Glasgow": "GLC", // Glasgow Central
  "Cardiff": "CDF", // Cardiff Central
};
Object.assign(CRS, ALIASES);

/** Merge a user-supplied station dataset over the bundled one (e.g. corrections or new openings). */
export function registerStations(extra: Record<string, string>): void {
  Object.assign(CRS, extra);
}

/** All known station names, sorted — feeds the dashboard's autocomplete so users don't mistype. */
export function stationNames(): string[] {
  return Object.keys(CRS).sort();
}

/** Resolve a station name to its CRS code, or null if unknown. Whitespace/case tolerant. */
export function toCrs(name: string): string | null {
  const trimmed = name.trim();
  // Already a CRS code (e.g. the parser handed us "MAN") — pass it straight through.
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  const target = trimmed.toLowerCase();
  const hit = Object.keys(CRS).find((k) => k.toLowerCase() === target);
  return hit ? CRS[hit] : null;
}

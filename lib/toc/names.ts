// National Rail two-letter operator (TOC) codes -> the names passengers recognise. The live arrival
// feed only carries the code, so "GW" would otherwise show in the UI looking like a truncated "GWR".
// Not exhaustive — an unmapped code falls back to itself (see tocName), so a new operator degrades
// to its code rather than a blank.
const NAMES: Record<string, string> = {
  AV: "Avanti West Coast",
  GW: "GWR",
  GR: "LNER",
  SE: "Southeastern",
  SW: "South Western Railway",
  XC: "CrossCountry",
  TP: "TransPennine Express",
  NT: "Northern",
  SR: "ScotRail",
  AW: "Transport for Wales",
  XR: "Elizabeth line",
  TL: "Thameslink",
  GN: "Great Northern",
  GX: "Gatwick Express",
  SN: "Southern",
  LE: "Greater Anglia",
  LO: "London Overground",
  LM: "West Midlands Railway",
  CH: "Chiltern Railways",
  EM: "East Midlands Railway",
  ME: "Merseyrail",
  CC: "c2c",
  HX: "Heathrow Express",
  HT: "Hull Trains",
  GC: "Grand Central",
  LD: "Lumo",
};

/** Friendly operator name for a TOC code, or the code itself when it isn't mapped. */
export function tocName(code: string): string {
  return NAMES[code] ?? code;
}

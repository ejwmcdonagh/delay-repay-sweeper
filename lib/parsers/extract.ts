import type { Journey, RawEmail, TicketParser } from "./types.js";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "24 Jun 2026" + "16:38" -> ISO, built explicitly because Date string parsing of
// "24 Jun 2026 16:38" is engine-dependent. ponytail: treated as UTC; add Europe/London DST
// handling when polling real arrivals.
function toIso(day: string, mon: string, year: string, hhmm: string): string {
  return new Date(`${year}-${MONTHS[mon]}-${day.padStart(2, "0")}T${hhmm}:00.000Z`).toISOString();
}

function need<T>(value: T | null | undefined, field: string, id: string): T {
  if (value === null || value === undefined) throw new Error(`${id}: could not extract ${field}`);
  return value;
}

// Common booking-confirmation fields shared across UK retailer/TOC receipts. Each parser
// only differs by the sender it matches; real-world format drift is handled by adding a new
// parser module, never by editing one central regex.
function extractStandard(email: RawEmail, id: string): Journey {
  const body = email.body;
  const ref = need(body.match(/Booking reference:\s*([A-Z0-9]+)/)?.[1], "booking reference", id);
  const route = need(body.match(/^(.+?) to (.+?)$/m), "route", id);
  const date = need(body.match(/(\d{1,2}) (\w{3}) (\d{4})/), "date", id);
  const times = need(body.match(/dep (\d{2}:\d{2}) arr (\d{2}:\d{2})/), "times", id);
  const type = need(body.match(/Ticket type:\s*(Single|Return)/i)?.[1], "ticket type", id);
  const price = need(body.match(/Total:\s*£([\d.]+)/)?.[1], "price", id);
  const [, day, mon, year] = date;

  return {
    retailer: id,
    bookingRef: ref,
    origin: route[1].trim(),
    destination: route[2].trim(),
    scheduledDeparture: toIso(day, mon, year, times[1]),
    scheduledArrival: toIso(day, mon, year, times[2]),
    pricePence: Math.round(parseFloat(price) * 100),
    ticketType: type.toLowerCase() as "single" | "return",
  };
}

/** Build a parser that recognises emails by sender and extracts the standard fields. */
export function makeReceiptParser(id: string, senderPattern: RegExp): TicketParser {
  return {
    id,
    matches: (email) => senderPattern.test(email.from),
    parse: (email) => extractStandard(email, id),
  };
}

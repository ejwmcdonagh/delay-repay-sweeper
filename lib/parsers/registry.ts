import type { Journey, RawEmail, TicketParser } from "./types.js";
import { trainlineParser } from "./trainline.js";
import { lnerParser, gwrParser, avantiParser } from "./toc.js";

// Add a parser module here to extend UK coverage. Retailers (Trainline/Omio) before direct-TOC
// parsers, since a retailer receipt could otherwise be misread by a TOC parser.
export const parsers: TicketParser[] = [trainlineParser, lnerParser, gwrParser, avantiParser];

/** Returns the parsed journey from the first parser that recognises the email, or null. */
export function parseEmail(email: RawEmail): Journey | null {
  const parser = parsers.find((p) => p.matches(email));
  return parser ? parser.parse(email) : null;
}

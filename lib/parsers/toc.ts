import { makeReceiptParser } from "./extract.js";

// Direct-TOC booking confirmations. Each is one line because the receipt layout is shared;
// give a TOC its own module here when its real-world format diverges from the standard fields.
export const lnerParser = makeReceiptParser("lner", /lner\.co\.uk/i);
export const gwrParser = makeReceiptParser("gwr", /gwr\.com/i);
export const avantiParser = makeReceiptParser("avanti", /avantiwestcoast\.co\.uk/i);

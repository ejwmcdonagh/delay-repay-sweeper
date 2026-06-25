import { makeReceiptParser } from "./extract.js";

export const trainlineParser = makeReceiptParser("trainline", /thetrainline\.com/i);

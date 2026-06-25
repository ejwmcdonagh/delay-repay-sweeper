import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { load } from "../store.js";
import { RttArrivalProvider } from "../arrival/rtt.js";
import { RttNgArrivalProvider } from "../arrival/rtt-ng.js";
import { HspBackfiller, msUntilNextRun } from "../arrival/hsp.js";
import { ManualHelperExecutor } from "../claim/executor.js";
import { PlaywrightExecutor } from "../claim/playwright.js";
import { registerStations } from "../stations.js";
import { getPassphrase } from "../keychain.js";
import { demoProvider, demoRoute } from "../demo.js";
import { FakeArrivalProvider } from "../arrival/provider.js";
import { createServer } from "../server.js";
import { sweep, backfill, type Ctx } from "../app.js";

const PORT = Number(process.env.DRS_PORT ?? 4505);
const STATE_PATH = process.env.DRS_STATE ?? join(homedir(), ".delay-repay-sweeper", "state.json");
// Master key precedence: explicit env > OS keychain > dev default (so the demo runs with no setup).
// ponytail: dev default for the demo; real installs set it once and it lives in the keychain.
const PASSPHRASE = process.env.DRS_PASSPHRASE ?? getPassphrase() ?? "dev-passphrase";

// Optional full CRS dataset dropped next to the state file overrides the built-in station subset.
const stationsPath = join(dirname(STATE_PATH), "stations.json");
if (existsSync(stationsPath)) registerStations(JSON.parse(readFileSync(stationsPath, "utf8")));

const state = load(STATE_PATH, PASSPHRASE);

// Demo is now an explicit opt-in (Settings toggle), not the default. When on, seed a sample route.
if (state.config.demo && !state.config.routes?.length) state.config.routes = [demoRoute()];

// Provider factory: demo on -> scripted sample data; `user` present -> legacy basic-auth api.rtt.io;
// a token alone -> Next Gen data.rtt.io; nothing yet (pre-setup) -> an empty provider that returns
// no arrivals, so the daemon idles harmlessly until the setup wizard saves a token.
const buildProvider = (config: typeof state.config) =>
  config.demo
    ? demoProvider()
    : config.rtt
      ? config.rtt.user
        ? new RttArrivalProvider(config.rtt.user, config.rtt.token)
        : new RttNgArrivalProvider(config.rtt.token, config.rtt.baseUrl)
      : new FakeArrivalProvider();

const demo = !!state.config.demo;
const provider = buildProvider(state.config);

// Manual helper is always available; the headless filer is built only when a CAPTCHA key exists.
// claim() selects between them per-call based on the live mode.
const autoExecutor = state.config.captcha ? new PlaywrightExecutor(state.config.captcha.apiKey) : undefined;

const ctx: Ctx = {
  statePath: STATE_PATH, passphrase: PASSPHRASE, state, provider,
  executor: new ManualHelperExecutor(), autoExecutor, demo, buildProvider,
};

// Live sweep every 5 minutes: poll due arrivals, fire notifications and deadline alerts.
setInterval(() => void sweep(ctx).catch((e) => console.error("sweep failed:", e.message)), 5 * 60 * 1000);

// HSP batch fallback at 02:00 daily for anything still unresolved.
if (state.config.hsp) {
  const backfiller = new HspBackfiller(state.config.hsp.user, state.config.hsp.password);
  const runNightly = () => void backfill(ctx, backfiller).catch((e) => console.error("backfill failed:", e.message));
  setTimeout(() => {
    runNightly();
    setInterval(runNightly, 24 * 60 * 60 * 1000);
  }, msUntilNextRun(2));
}

createServer(ctx).listen(PORT, "127.0.0.1", () => {
  console.log(`Delay Repay Sweeper — dashboard at http://127.0.0.1:${PORT}  (mode: ${state.config.mode}${demo ? ", demo" : ""})`);
});

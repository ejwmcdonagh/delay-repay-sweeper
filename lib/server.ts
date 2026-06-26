import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ctx } from "./app.js";
import { sweep, claim, markFiled, view, setExtras, setTicketDetails, removeTicket, addRoute, removeRoute, setRouteFares, confirmJourney, applyConfig, backfillRoutes } from "./app.js";
import { stationNames } from "./stations.js";

const ui = (name: string) => readFileSync(fileURLToPath(new URL(`../ui/${name}`, import.meta.url)));

// Demo arrivals are dated 24 Jun 2026; pin "now" just after so the demo always validates
// regardless of the host clock. Real mode uses the wall clock.
const DEMO_NOW = new Date("2026-06-25T18:00:00.000Z");

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

// Plain node:http — the API surface is tiny and same-origin on localhost, so a framework would
// be pure overhead. Everything binds to 127.0.0.1 in the daemon; nothing is exposed off-machine.
export function createServer(ctx: Ctx) {
  return createHttp(async (req, res) => {
    try {
      const url = req.url ?? "/";
      if (req.method === "GET" && url === "/") return res.end(ui("index.html"));
      if (req.method === "GET" && url === "/app.js") {
        res.setHeader("content-type", "text/javascript");
        return res.end(ui("app.js"));
      }
      if (req.method === "GET" && url === "/api/state") return send(res, 200, view(ctx));
      if (req.method === "GET" && url === "/api/stations") return send(res, 200, stationNames());
      if (req.method === "POST" && url === "/api/refresh") {
        // On-demand sweep: poll due arrivals and surface route delays now, instead of waiting for
        // the daemon's 5-minute timer.
        await sweep(ctx, ctx.demo ? DEMO_NOW : new Date());
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/claim") {
        const { id } = await readJson(req);
        return send(res, 200, await claim(ctx, id));
      }
      if (req.method === "POST" && url === "/api/filed") {
        markFiled(ctx, (await readJson(req)).id);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/ticket/extras") {
        const { id, extras } = await readJson(req);
        setExtras(ctx, id, extras);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/routes") {
        addRoute(ctx, await readJson(req));
        await sweep(ctx, ctx.demo ? DEMO_NOW : new Date()); // surface delays on the new route now
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/backfill") {
        // Setup wizard's final step: import the trailing 28 days of route delays, then sweep "now".
        await backfillRoutes(ctx, ctx.state.config.scanDays, ctx.demo ? DEMO_NOW : new Date());
        await sweep(ctx, ctx.demo ? DEMO_NOW : new Date());
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/routes/fare") {
        const { id, fares } = await readJson(req);
        setRouteFares(ctx, id, fares);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/routes/delete") {
        removeRoute(ctx, (await readJson(req)).id);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/ticket/details") {
        const { id, ...patch } = await readJson(req);
        setTicketDetails(ctx, id, patch);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/ticket/delete") {
        removeTicket(ctx, (await readJson(req)).id);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/ticket/confirm") {
        confirmJourney(ctx, (await readJson(req)).id);
        return send(res, 200, view(ctx));
      }
      if (req.method === "POST" && url === "/api/config") {
        applyConfig(ctx, await readJson(req)); // persists + rebuilds provider / demo flag
        await sweep(ctx, ctx.demo ? DEMO_NOW : new Date()); // pick up route delays under the new provider
        return send(res, 200, view(ctx));
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 400, { error: (err as Error).message });
    }
  });
}

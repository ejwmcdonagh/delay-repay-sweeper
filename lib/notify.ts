import { spawn } from "node:child_process";

/** PRD message format, kept pure so it can be asserted: "Success: £14.50 claimed from Avanti". */
export function formatSuccess(refundPence: number, toc: string): string {
  return `Success: £${(refundPence / 100).toFixed(2)} claimed from ${toc}`;
}

// Best-effort OS notification; falls back to stdout. Reserved for positive outcomes and required
// confirmations (PRD §6) — the daemon is otherwise silent. ponytail: shells out to the native
// notifier per platform; swap for a node-notifier dep only if these break on some distro.
export function notify(title: string, body: string): void {
  const p = process.platform;
  const [cmd, args] =
    p === "darwin"
      ? ["osascript", ["-e", `display notification "${body}" with title "${title}"`]]
      : p === "win32"
        ? ["powershell", ["-Command", `New-BurntToastNotification -Text '${title}','${body}'`]]
        : ["notify-send", [title, body]];
  // A missing notifier surfaces as an async 'error' event (ENOENT), not a throw — must be handled
  // or it crashes the daemon. The dashboard still shows the outcome either way.
  const child = spawn(cmd as string, args as string[]);
  child.on("error", () => {});
  console.log(`[notify] ${title}: ${body}`);
}

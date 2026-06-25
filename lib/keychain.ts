import { spawnSync } from "node:child_process";

const SERVICE = "delay-repay-sweeper";
const ACCOUNT = "vault-passphrase";

// Store the vault passphrase in the OS secret store via the platform's native CLI — no native
// node addon (keytar) to compile, which keeps install painless across machines.
// ponytail: shells out to security/secret-tool. Falls back to env/default when the CLI is absent;
// upgrade path is keytar or Tauri secure storage if a tool isn't available on some distro.

interface KeychainCmd {
  get: { cmd: string; args: string[] };
  set: { cmd: string; args: string[] };
}

export function keychainCommands(platform: NodeJS.Platform, secret = ""): KeychainCmd {
  if (platform === "darwin") {
    return {
      get: { cmd: "security", args: ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"] },
      set: { cmd: "security", args: ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", secret] },
    };
  }
  if (platform === "win32") {
    return {
      get: { cmd: "powershell", args: ["-Command", `(Get-StoredCredential -Target ${SERVICE}).GetNetworkCredential().Password`] },
      set: { cmd: "powershell", args: ["-Command", `New-StoredCredential -Target ${SERVICE} -UserName ${ACCOUNT} -Password '${secret}' -Persist LocalMachine`] },
    };
  }
  // Linux / freedesktop secret service
  return {
    get: { cmd: "secret-tool", args: ["lookup", "service", SERVICE, "account", ACCOUNT] },
    set: { cmd: "secret-tool", args: ["store", "--label", SERVICE, "service", SERVICE, "account", ACCOUNT] },
  };
}

export function getPassphrase(platform: NodeJS.Platform = process.platform): string | null {
  const { get } = keychainCommands(platform);
  const r = spawnSync(get.cmd, get.args, { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.trim();
}

export function setPassphrase(secret: string, platform: NodeJS.Platform = process.platform): boolean {
  const { set } = keychainCommands(platform, secret);
  // secret-tool reads the value from stdin rather than argv.
  const input = platform !== "darwin" && platform !== "win32" ? secret : undefined;
  return spawnSync(set.cmd, set.args, { input, encoding: "utf8" }).status === 0;
}

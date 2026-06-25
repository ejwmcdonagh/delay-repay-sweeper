import { describe, it, expect } from "vitest";
import { keychainCommands } from "./keychain.js";

describe("keychainCommands", () => {
  it("uses the macOS security tool to read the passphrase", () => {
    const { get } = keychainCommands("darwin");
    expect(get.cmd).toBe("security");
    expect(get.args).toContain("find-generic-password");
  });

  it("uses secret-tool on Linux", () => {
    expect(keychainCommands("linux").get.cmd).toBe("secret-tool");
  });
});

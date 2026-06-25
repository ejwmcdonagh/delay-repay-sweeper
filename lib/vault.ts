import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

// AES-256-GCM with a scrypt-derived key. node:crypto is stdlib — no dependency for the
// security path. GCM gives us authenticated encryption, so a wrong passphrase (or tampered
// blob) fails the auth tag instead of returning garbage.
// ponytail: key derived from a passphrase + per-blob salt. Upgrade path: store the key in the
// OS keychain (keytar / Tauri secure storage) and drop the passphrase prompt.
export interface SealedBlob {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

export function seal(data: unknown, passphrase: string): SealedBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function open<T = unknown>(blob: SealedBlob, passphrase: string): T {
  const key = deriveKey(passphrase, Buffer.from(blob.salt, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "hex"));
  decipher.setAuthTag(Buffer.from(blob.tag, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "hex")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

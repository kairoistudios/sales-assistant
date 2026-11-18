import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc1";
const AAD = Buffer.from("sales-assistant/microsoft-oauth/v1");

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

const KEY_HELP =
  "TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as base64 (openssl rand -base64 32) or as 64 hex characters.";

function decodeKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = Buffer.from(normalized + padding, "base64");
  if (decoded.length !== 32) throw new TokenKeyError(KEY_HELP);

  const canonical = decoded.toString("base64").replace(/=+$/, "");
  const given = normalized.replace(/=+$/, "");
  if (given !== canonical) throw new TokenKeyError(KEY_HELP);
  return decoded;
}

/** Returns the key, or null when the variable is unset. Throws when it is set but not a 32-byte key. */
export function resolveTokenKey(raw: string | undefined = process.env.TOKEN_ENCRYPTION_KEY): Buffer | null {
  if (raw == null || raw.trim() === "") return null;
  return decodeKey(raw);
}

export function outlookTokensCanBeStored(raw: string | undefined = process.env.TOKEN_ENCRYPTION_KEY): boolean {
  try {
    return resolveTokenKey(raw) !== null;
  } catch {
    return false;
  }
}

export function isEncryptedToken(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(`${PREFIX}:`));
}

export function encryptToken(plaintext: string, key?: Buffer | null): string {
  if (isEncryptedToken(plaintext)) {
    throw new TokenKeyError("Refusing to encrypt a value that is already encrypted.");
  }
  const resolved = key === undefined ? resolveTokenKey() : key;
  if (!resolved) {
    throw new TokenKeyError(
      "Set TOKEN_ENCRYPTION_KEY before storing Outlook tokens. Generate one with: openssl rand -base64 32",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolved, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptToken(stored: string, key?: Buffer | null): string {
  if (!isEncryptedToken(stored)) return stored;
  const resolved = key === undefined ? resolveTokenKey() : key;
  if (!resolved) {
    throw new TokenKeyError("Stored Outlook tokens are encrypted. Set TOKEN_ENCRYPTION_KEY to the key that encrypted them.");
  }
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new TokenKeyError("Stored Outlook token is not in the expected encrypted format.");
  }
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const data = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || data.length === 0) {
      throw new Error("malformed ciphertext");
    }
    const decipher = createDecipheriv("aes-256-gcm", resolved, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof TokenKeyError) throw error;
    throw new TokenKeyError(
      "Could not decrypt stored Outlook tokens. Confirm TOKEN_ENCRYPTION_KEY is the same key that was used when those tokens were saved. If that key was replaced, each seller must connect Outlook again.",
    );
  }
}

export function openToken(stored: string | null | undefined, key?: Buffer | null): string | null {
  if (!stored) return null;
  return decryptToken(stored, key);
}

export function revealOutlookTokens<
  T extends { microsoft_access_token: string | null; microsoft_refresh_token: string | null },
>(user: T, key?: Buffer | null): T {
  return {
    ...user,
    microsoft_access_token: openToken(user.microsoft_access_token, key),
    microsoft_refresh_token: openToken(user.microsoft_refresh_token, key),
  };
}

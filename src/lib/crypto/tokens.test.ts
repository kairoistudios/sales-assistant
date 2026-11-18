import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { migrateStoredOutlookTokens, saveOutlookTokens } from "@/lib/auth/outlook-tokens";
import { one, openDatabase, run, type Db } from "@/lib/db";
import { getUserByEmail } from "@/lib/services/engine";
import { decryptToken, encryptToken, isEncryptedToken, resolveTokenKey, TokenKeyError } from "./tokens";

const ACCESS = "eyJhbGciOiJSUzI1NiJ9.access-PLAINTEXT-sentinel.sig";
const REFRESH = "refresh-PLAINTEXT-sentinel";
const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

function withKey<T>(key: string | undefined, fn: () => T): T {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
}

function sellerDb(): Db {
  const db = openDatabase(":memory:");
  run(
    db,
    `INSERT INTO organizations (id, name, domain, timezone, timing_json, briefing_cap, created_at)
     VALUES ('org_turb0', 'Turb0', 'turb0.ai', 'America/New_York', '{}', 5, '2026-01-01T00:00:00.000Z')`,
  );
  run(
    db,
    `INSERT INTO users (id, org_id, email, name, timezone, created_at)
     VALUES ('user_johnny', 'org_turb0', 'johnny@turb0.ai', 'Johnny', 'America/New_York', '2026-01-01T00:00:00.000Z')`,
  );
  return db;
}

function storedTokens(db: Db) {
  return one<{ microsoft_access_token: string | null; microsoft_refresh_token: string | null }>(
    db,
    "SELECT microsoft_access_token, microsoft_refresh_token FROM users WHERE id = ?",
    ["user_johnny"],
  );
}

describe("Outlook token encryption", () => {
  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips access and refresh tokens and hides the plaintext", () => {
    const key = randomBytes(32);
    const access = encryptToken(ACCESS, key);
    const refresh = encryptToken(REFRESH, key);
    expect(access.startsWith("enc1:")).toBe(true);
    expect(access).not.toContain("PLAINTEXT");
    expect(refresh).not.toContain(REFRESH);
    expect(encryptToken(ACCESS, key)).not.toBe(access);
    expect(decryptToken(access, key)).toBe(ACCESS);
    expect(decryptToken(refresh, key)).toBe(REFRESH);
    expect(isEncryptedToken("eyJhbGciOiJSUzI1NiJ9.payload.sig")).toBe(false);
    expect(decryptToken("eyJhbGciOiJSUzI1NiJ9.payload.sig")).toBe("eyJhbGciOiJSUzI1NiJ9.payload.sig");
  });

  it("accepts the same 32 bytes as base64, base64url, or hex", () => {
    const raw = randomBytes(32);
    const stored = encryptToken("mailbox-token", resolveTokenKey(raw.toString("base64"))!);
    expect(decryptToken(stored, resolveTokenKey(raw.toString("base64url"))!)).toBe("mailbox-token");
    expect(decryptToken(stored, resolveTokenKey(raw.toString("hex"))!)).toBe("mailbox-token");
    expect(decryptToken(stored, resolveTokenKey(raw.toString("base64").replace(/=+$/, ""))!)).toBe("mailbox-token");
  });

  it("rejects a missing, short, or mistyped key and a tampered ciphertext", () => {
    expect(resolveTokenKey("")).toBeNull();
    expect(resolveTokenKey(undefined)).toBeNull();
    expect(() => resolveTokenKey("not-a-key")).toThrow(TokenKeyError);
    expect(() => resolveTokenKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => encryptToken("secret", null)).toThrow(/TOKEN_ENCRYPTION_KEY/);

    const key = randomBytes(32);
    const stored = encryptToken("secret", key);
    const flipped = `${stored.slice(0, -1)}${stored.endsWith("a") ? "b" : "a"}`;
    expect(() => decryptToken(flipped, key)).toThrow(/Could not decrypt/);
    expect(() => decryptToken(stored, randomBytes(32))).toThrow(/Could not decrypt/);
    expect(() => decryptToken(stored, null)).toThrow(/Set TOKEN_ENCRYPTION_KEY/);
    expect(() => encryptToken(stored, key)).toThrow(/already encrypted/);
  });

  it("encrypts legacy plaintext rows once and leaves ciphertext alone", () => {
    const db = sellerDb();
    run(db, "UPDATE users SET microsoft_access_token = ?, microsoft_refresh_token = ? WHERE id = ?", [
      ACCESS,
      REFRESH,
      "user_johnny",
    ]);
    expect(withKey(undefined, () => migrateStoredOutlookTokens(db))).toBe(0);
    expect(storedTokens(db)?.microsoft_refresh_token).toBe(REFRESH);

    const key = randomBytes(32).toString("base64");
    expect(withKey(key, () => migrateStoredOutlookTokens(db))).toBe(1);
    const sealed = storedTokens(db);
    if (!sealed?.microsoft_access_token || !sealed.microsoft_refresh_token) throw new Error("tokens missing");
    expect(sealed.microsoft_access_token.startsWith("enc1:")).toBe(true);
    expect(sealed.microsoft_refresh_token.startsWith("enc1:")).toBe(true);
    expect(sealed?.microsoft_access_token).not.toContain("PLAINTEXT");
    expect(sealed?.microsoft_refresh_token).not.toContain(REFRESH);
    expect(withKey(key, () => migrateStoredOutlookTokens(db))).toBe(0);

    const user = withKey(key, () => getUserByEmail(db, "johnny@turb0.ai"));
    expect(user?.microsoft_access_token).toBe(ACCESS);
    expect(user?.microsoft_refresh_token).toBe(REFRESH);
  });

  it("refuses to store a new token when the key is unset and does not write the secret", () => {
    const db = sellerDb();
    expect(() =>
      withKey(undefined, () =>
        saveOutlookTokens(db, "user_johnny", {
          accessToken: ACCESS,
          refreshToken: REFRESH,
          expiresAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(storedTokens(db)?.microsoft_access_token).toBeNull();
    expect(storedTokens(db)?.microsoft_refresh_token).toBeNull();
  });

  it("writes ciphertext and reads it back as plaintext", () => {
    const db = sellerDb();
    const key = randomBytes(32).toString("base64");
    withKey(key, () =>
      saveOutlookTokens(db, "user_johnny", {
        accessToken: ACCESS,
        refreshToken: REFRESH,
        expiresAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const sealed = storedTokens(db);
    if (!sealed?.microsoft_access_token) throw new Error("access token missing");
    expect(sealed.microsoft_access_token.startsWith("enc1:")).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain("PLAINTEXT");
    const user = withKey(key, () => getUserByEmail(db, "johnny@turb0.ai"));
    expect(user?.microsoft_access_token).toBe(ACCESS);
    expect(user?.microsoft_refresh_token).toBe(REFRESH);
  });
});

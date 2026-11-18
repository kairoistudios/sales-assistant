import { encryptToken, isEncryptedToken, resolveTokenKey } from "@/lib/crypto/tokens";
import { many, run, type Db } from "@/lib/db";

interface StoredOutlookTokens {
  id: string;
  microsoft_access_token: string | null;
  microsoft_refresh_token: string | null;
}

function seal(value: string | null, key: Buffer): string | null {
  if (!value) return null;
  if (isEncryptedToken(value)) return value;
  return encryptToken(value, key);
}

export function saveOutlookTokens(
  db: Db,
  userId: string,
  input: { accessToken: string | null; refreshToken: string | null; expiresAt: string | null },
): void {
  run(
    db,
    `UPDATE users SET microsoft_access_token = ?, microsoft_refresh_token = ?, microsoft_token_expires = ? WHERE id = ?`,
    [
      input.accessToken ? encryptToken(input.accessToken) : null,
      input.refreshToken ? encryptToken(input.refreshToken) : null,
      input.expiresAt,
      userId,
    ],
  );
}

/**
 * Encrypts Outlook tokens that were stored before encryption existed.
 * Rows that are already encrypted are left as they are. With no key configured, nothing is rewritten.
 */
export function migrateStoredOutlookTokens(db: Db): number {
  const key = resolveTokenKey();
  if (!key) return 0;
  const rows = many<StoredOutlookTokens>(
    db,
    "SELECT id, microsoft_access_token, microsoft_refresh_token FROM users",
  );
  let migrated = 0;
  for (const row of rows) {
    const accessToken = seal(row.microsoft_access_token, key);
    const refreshToken = seal(row.microsoft_refresh_token, key);
    if (accessToken === row.microsoft_access_token && refreshToken === row.microsoft_refresh_token) continue;
    run(db, "UPDATE users SET microsoft_access_token = ?, microsoft_refresh_token = ? WHERE id = ?", [
      accessToken,
      refreshToken,
      row.id,
    ]);
    migrated += 1;
  }
  if (migrated > 0) {
    console.info(`Encrypted Outlook tokens for ${migrated} seller(s).`);
  }
  return migrated;
}

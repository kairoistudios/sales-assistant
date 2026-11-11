import { createHmac, timingSafeEqual } from "node:crypto";

interface SessionPayload {
  uid: string;
  exp: number;
}

export function signSession(userId: string, secret: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + maxAgeSeconds * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSession(token: string | undefined, secret: string): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.uid || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

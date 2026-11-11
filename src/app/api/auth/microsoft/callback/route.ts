import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeJwtPayload, MICROSOFT_SCOPES, microsoftTokenRequest } from "@/lib/adapters/mail/microsoft";
import { signSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { run } from "@/lib/db";
import { getUserByEmail, ready } from "@/lib/services/engine";

export async function GET(request: Request) {
  const config = getConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  if (!code || !state || state !== jar.get("sa_oauth_state")?.value) redirect("/?error=microsoft");
  jar.delete("sa_oauth_state");

  const token = await microsoftTokenRequest(
    config.microsoftTenantId,
    new URLSearchParams({
      client_id: config.microsoftClientId,
      client_secret: config.microsoftClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.microsoftRedirectUri,
      scope: MICROSOFT_SCOPES,
    }),
  );
  if (token.id_token) {
    const claims = decodeJwtPayload(token.id_token);
    if (claims.tid && claims.tid !== config.microsoftTenantId) redirect("/?error=tenant");
  }
  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) redirect("/?error=microsoft");
  const profile = (await profileResponse.json()) as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
  const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
  if (!email || (config.orgDomain && !email.endsWith(`@${config.orgDomain}`))) redirect("/?error=domain");

  const db = ready();
  const expires = new Date(Date.now() + token.expires_in * 1000).toISOString();
  let user = getUserByEmail(db, email);
  if (!user) {
    const id = randomUUID();
    run(
      db,
      `INSERT INTO users (id, org_id, email, name, timezone, autonomy, voice_notes, crm_provider, microsoft_oid, created_at)
       VALUES (?, 'org_turb0', ?, ?, 'America/New_York', 'suggest_only', 'Sign off with your first name.', 'local', ?, ?)`,
      [id, email, profile.displayName || email, profile.id || null, new Date().toISOString()],
    );
    user = getUserByEmail(db, email);
  }
  if (!user) redirect("/?error=microsoft");
  run(
    db,
    `UPDATE users SET microsoft_oid = ?, microsoft_access_token = ?, microsoft_refresh_token = ?, microsoft_token_expires = ?, name = ? WHERE id = ?`,
    [profile.id || user.microsoft_oid, token.access_token, token.refresh_token || user.microsoft_refresh_token, expires, profile.displayName || user.name, user.id],
  );
  jar.set("sa_session", signSession(user.id, config.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/briefing");
}

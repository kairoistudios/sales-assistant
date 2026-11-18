import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MICROSOFT_SCOPES } from "@/lib/adapters/mail/microsoft";
import { authCookieOptions, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/auth/cookies";
import { getConfig, microsoftConfigured } from "@/lib/config";
import { outlookTokensCanBeStored } from "@/lib/crypto/tokens";

export async function GET() {
  const config = getConfig();
  if (!microsoftConfigured(config)) redirect("/?error=microsoft");
  if (!outlookTokensCanBeStored()) redirect("/?error=token_key");
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("sa_oauth_state", state, authCookieOptions(config.appUrl, OAUTH_STATE_MAX_AGE_SECONDS));
  const url = new URL(`https://login.microsoftonline.com/${config.microsoftTenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.microsoftClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.microsoftRedirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  redirect(url.toString());
}

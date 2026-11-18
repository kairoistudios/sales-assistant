import { resolveTokenKey, TokenKeyError } from "@/lib/crypto/tokens";

export interface AppConfig {
  appUrl: string;
  demoMode: boolean;
  sessionSecret: string;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  microsoftTenantId: string;
  microsoftClientId: string;
  microsoftClientSecret: string;
  microsoftRedirectUri: string;
  orgDomain: string;
  crmProvider: "local" | "turb0";
  crmDryRun: boolean;
  turb0SupabaseUrl: string;
  turb0AnonKey: string;
  turb0AuthMode: "user_jwt" | "service_role";
  turb0ServiceRoleKey: string;
  notesWebhookSecret: string;
  jobSecret: string;
  autoSendEnabled: boolean;
  tokenEncryptionKey: string;
}

export function demoModeFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEMO_MODE != null && env.DEMO_MODE !== "") return env.DEMO_MODE !== "false";
  return env.NODE_ENV !== "production";
}

export function getConfig(): AppConfig {
  const appUrl = (process.env.APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
  return {
    appUrl,
    demoMode: demoModeFromEnv(),
    sessionSecret: process.env.SESSION_SECRET || "dev-only-change-me",
    llmProvider: process.env.LLM_PROVIDER || "heuristic",
    llmApiKey: process.env.LLM_API_KEY || "",
    llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
    llmBaseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    microsoftTenantId: process.env.MICROSOFT_TENANT_ID || "",
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID || "",
    microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
    microsoftRedirectUri: process.env.MICROSOFT_REDIRECT_URI || `${appUrl}/api/auth/microsoft/callback`,
    orgDomain: (process.env.ORG_DOMAIN || "turb0.ai").toLowerCase(),
    crmProvider: process.env.CRM_PROVIDER === "turb0" ? "turb0" : "local",
    crmDryRun: (process.env.CRM_DRY_RUN ?? "true") !== "false",
    turb0SupabaseUrl: (process.env.TURB0_SUPABASE_URL || "").replace(/\/$/, ""),
    turb0AnonKey: process.env.TURB0_SUPABASE_ANON_KEY || "",
    turb0AuthMode: process.env.TURB0_AUTH_MODE === "service_role" ? "service_role" : "user_jwt",
    turb0ServiceRoleKey: process.env.TURB0_SERVICE_ROLE_KEY || "",
    notesWebhookSecret: process.env.NOTES_WEBHOOK_SECRET || "",
    jobSecret: process.env.JOB_SECRET || "",
    autoSendEnabled: process.env.AUTO_SEND_ENABLED === "true",
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  };
}

export function assertRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NEXT_PHASE === "phase-production-build") return;
  if (env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  const secret = env.SESSION_SECRET || "";
  if (secret.length < 24 || secret === "dev-only-change-me") {
    problems.push("Set SESSION_SECRET to a long random string (openssl rand -base64 32).");
  }
  if (!env.TOKEN_ENCRYPTION_KEY) {
    problems.push("Set TOKEN_ENCRYPTION_KEY to 32 bytes from: openssl rand -base64 32");
  } else {
    try {
      resolveTokenKey(env.TOKEN_ENCRYPTION_KEY);
    } catch (error) {
      problems.push(error instanceof TokenKeyError ? error.message : "TOKEN_ENCRYPTION_KEY is invalid.");
    }
  }
  const appUrl = env.APP_URL || "";
  if (!appUrl.startsWith("https://") || appUrl.endsWith("/")) {
    problems.push("Set APP_URL to the https address of this deployment, with no trailing slash.");
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
  }
}

export function microsoftConfigured(config: AppConfig): boolean {
  return Boolean(config.microsoftTenantId && config.microsoftClientId && config.microsoftClientSecret);
}

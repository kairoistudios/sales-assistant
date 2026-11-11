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
}

export function getConfig(): AppConfig {
  const appUrl = (process.env.APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
  return {
    appUrl,
    demoMode: (process.env.DEMO_MODE ?? "true") !== "false",
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
  };
}

export function microsoftConfigured(config: AppConfig): boolean {
  return Boolean(config.microsoftTenantId && config.microsoftClientId && config.microsoftClientSecret);
}

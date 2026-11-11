import type {
  CrmAdapter,
  CrmClientContactInput,
  CrmClientInput,
  CrmNoteInput,
  CrmOpportunityInput,
  CrmPartnerContactInput,
  CrmResult,
} from "./types";

export const TURB0_STAGES = [
  "new",
  "qualifying",
  "discovery",
  "proposal",
  "implementation",
  "contracting",
  "closed_won",
  "closed_lost",
  "delayed",
] as const;

export function buildClientBody(input: CrmClientInput): Record<string, unknown> {
  return {
    name: input.name,
    website: input.website ?? null,
    is_prospect: input.isProspect,
    ...(input.partnerExternalId ? { partner_id: input.partnerExternalId } : {}),
  };
}

export function buildClientContactBody(input: CrmClientContactInput): Record<string, unknown> {
  return {
    client_id: input.clientExternalId,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    title: input.title ?? null,
  };
}

export function buildPartnerContactBody(input: CrmPartnerContactInput): Record<string, unknown> {
  return {
    partner_id: input.partnerExternalId,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    position: input.position ?? null,
  };
}

export function buildOpportunityBody(input: CrmOpportunityInput): Record<string, unknown> {
  const stage = (TURB0_STAGES as readonly string[]).includes(input.stage) ? input.stage : "new";
  const contractType = input.contractType === "one_time" ? "one_time" : "subscription";
  return {
    name: input.name,
    description: input.description ?? null,
    stage,
    contract_value_usd: input.valueCents != null ? Math.round(input.valueCents) / 100 : null,
    contract_type: contractType,
    close_date: input.closeOn ?? null,
    client_id: input.clientExternalId ?? null,
    client_name: input.clientName ?? null,
    client_website: input.clientWebsite ?? null,
    ...(input.partnerExternalId ? { partner_id: input.partnerExternalId } : {}),
    ...(input.createdBy ? { created_by: input.createdBy } : {}),
  };
}

export function buildNoteBody(input: CrmNoteInput): Record<string, unknown> {
  return {
    opportunity_id: input.opportunityExternalId,
    body: input.body,
    ...(input.createdBy ? { created_by: input.createdBy } : {}),
  };
}

export interface Turb0Options {
  supabaseUrl: string;
  anonKey: string;
  authMode: "user_jwt" | "service_role";
  accessToken?: string | null;
  serviceRoleKey?: string | null;
  dryRun: boolean;
  fetchImpl?: typeof fetch;
}

export class Turb0PartnersCrm implements CrmAdapter {
  readonly provider = "turb0" as const;

  constructor(private readonly options: Turb0Options) {}

  private headers(): Record<string, string> {
    if (this.options.authMode === "service_role") {
      const key = this.options.serviceRoleKey || "";
      return {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };
    }
    return {
      apikey: this.options.anonKey,
      Authorization: `Bearer ${this.options.accessToken || ""}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  private async send(method: "POST" | "PATCH", table: string, body: Record<string, unknown>, externalId?: string | null): Promise<CrmResult> {
    const filter = externalId ? `?id=eq.${encodeURIComponent(externalId)}` : "";
    const path = `/rest/v1/${table}${filter}`;
    if (this.options.dryRun) {
      return {
        ok: true,
        externalId: externalId ?? null,
        skipped: true,
        reason: "CRM_DRY_RUN is true. No request was sent to Turb0 Partners.",
        request: { method, path, body },
      };
    }
    if (this.options.authMode === "user_jwt" && !this.options.accessToken) {
      return {
        ok: false,
        externalId: externalId ?? null,
        skipped: true,
        reason: "Link this seller's Turb0 Partners login before writing. Row level security needs their token.",
        request: { method, path, body },
      };
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.options.supabaseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        externalId: externalId ?? null,
        skipped: false,
        reason: `Turb0 Partners ${response.status}: ${text.slice(0, 300)}`,
        request: { method, path, body },
      };
    }
    let created: { id?: string }[] = [];
    try {
      const parsed = text ? JSON.parse(text) : [];
      created = Array.isArray(parsed) ? parsed : [];
    } catch {
      created = [];
    }
    if (method === "PATCH" && created.length === 0) {
      return {
        ok: false,
        externalId: externalId ?? null,
        skipped: false,
        reason: "No row updated. Turb0 Partners row level security may only allow updates to records this user created or is assigned to.",
        request: { method, path, body },
      };
    }
    return {
      ok: true,
      externalId: created[0]?.id || externalId || null,
      skipped: false,
      request: { method, path, body },
    };
  }

  pushClient(input: CrmClientInput): Promise<CrmResult> {
    return this.send(input.externalId ? "PATCH" : "POST", "clients", buildClientBody(input), input.externalId);
  }
  pushClientContact(input: CrmClientContactInput): Promise<CrmResult> {
    return this.send(input.externalId ? "PATCH" : "POST", "client_contacts", buildClientContactBody(input), input.externalId);
  }
  pushPartnerContact(input: CrmPartnerContactInput): Promise<CrmResult> {
    return this.send(
      input.externalId ? "PATCH" : "POST",
      "partner_contacts",
      buildPartnerContactBody(input),
      input.externalId,
    );
  }
  pushOpportunity(input: CrmOpportunityInput): Promise<CrmResult> {
    if (!input.externalId && !input.createdBy && this.options.authMode === "user_jwt") {
      return Promise.resolve({
        ok: false,
        externalId: null,
        skipped: true,
        reason: "Opportunity writes need the seller's Turb0 user id in created_by so row level security can accept them.",
      });
    }
    return this.send(input.externalId ? "PATCH" : "POST", "opportunities", buildOpportunityBody(input), input.externalId);
  }
  pushNote(input: CrmNoteInput): Promise<CrmResult> {
    if (!input.createdBy && this.options.authMode === "user_jwt") {
      return Promise.resolve({
        ok: false,
        externalId: null,
        skipped: true,
        reason: "Notes need created_by set to the signed-in Turb0 user.",
      });
    }
    return this.send("POST", "opportunity_notes", buildNoteBody(input));
  }
}

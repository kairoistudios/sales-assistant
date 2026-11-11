export interface CrmResult {
  ok: boolean;
  externalId: string | null;
  skipped: boolean;
  reason?: string;
  request?: { method: string; path: string; body: Record<string, unknown> };
}

export interface CrmClientInput {
  externalId?: string | null;
  name: string;
  website?: string | null;
  isProspect: boolean;
  partnerExternalId?: string | null;
}

export interface CrmClientContactInput {
  externalId?: string | null;
  clientExternalId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
}

export interface CrmPartnerContactInput {
  externalId?: string | null;
  partnerExternalId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
}

export interface CrmOpportunityInput {
  externalId?: string | null;
  name: string;
  description?: string | null;
  stage: string;
  valueCents?: number | null;
  contractType?: "subscription" | "one_time" | null;
  closeOn?: string | null;
  clientExternalId?: string | null;
  clientName?: string | null;
  clientWebsite?: string | null;
  partnerExternalId?: string | null;
  createdBy?: string | null;
}

export interface CrmNoteInput {
  opportunityExternalId: string;
  body: string;
  createdBy?: string | null;
}

export interface CrmAdapter {
  readonly provider: "local" | "turb0";
  pushClient(input: CrmClientInput): Promise<CrmResult>;
  pushClientContact(input: CrmClientContactInput): Promise<CrmResult>;
  pushPartnerContact(input: CrmPartnerContactInput): Promise<CrmResult>;
  pushOpportunity(input: CrmOpportunityInput): Promise<CrmResult>;
  pushNote(input: CrmNoteInput): Promise<CrmResult>;
}

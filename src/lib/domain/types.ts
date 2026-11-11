export const LOOP_KINDS = [
  "meeting_request",
  "proposal",
  "voicemail",
  "commitment",
  "intro",
  "check_in",
  "other",
] as const;

export type LoopKind = (typeof LOOP_KINDS)[number];

export const DIRECTIONS = ["we_owe", "they_owe"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CONTACT_ROLES = [
  "decision_maker",
  "influencer",
  "champion",
  "gatekeeper",
  "unknown",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const MOTIONS = ["grow", "land"] as const;
export type Motion = (typeof MOTIONS)[number];

export const ORIGINATION_PATHS = [
  "in_person",
  "campaign_reply",
  "referral",
  "inbound",
  "expansion",
  "dormant",
  "unknown",
] as const;
export type OriginationPath = (typeof ORIGINATION_PATHS)[number];

export const OPPORTUNITY_STAGES = [
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
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const AUTONOMY_LEVELS = ["suggest_only", "auto_log", "auto_send"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const SOURCE_TYPES = ["email", "calendar", "meeting_notes", "manual"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type NudgeChannel = "email" | "phone" | "other";

export interface SourceMaterial {
  externalId: string;
  threadKey: string | null;
  sourceType: SourceType;
  direction: "inbound" | "outbound" | "internal";
  fromEmail: string | null;
  fromName: string | null;
  counterpartyEmails: string[];
  subject: string;
  bodyText: string;
  occurredAt: string;
}

export interface ExtractionLoop {
  direction: Direction;
  kind: LoopKind;
  subject: string;
  detail: string;
  dueOn: string | null;
  dueIsStated: boolean;
  excerpt: string;
}

export interface Extraction {
  isBusiness: boolean;
  filterReason?: string;
  accountName?: string | null;
  accountDomain?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  proposedRole?: { role: ContactRole; confidence: number } | null;
  summary?: { account?: string; contact?: string } | null;
  openLoops: ExtractionLoop[];
  close: { replied: boolean; fulfilled: boolean };
}

export interface KnownAccount {
  id: string;
  name: string;
  domain: string | null;
}

export interface KnownContact {
  id: string;
  email: string;
  name: string;
  accountId: string | null;
  kind: "client" | "partner";
  roleConfirmed: boolean;
}

export interface KnownLoop {
  id: string;
  ownerUserId: string;
  accountId: string | null;
  contactId: string | null;
  contactEmail: string | null;
  threadKey: string | null;
  sourceRef: string | null;
  direction: Direction;
  kind: LoopKind;
  status: "open" | "closed";
  suppressed: boolean;
  subject: string;
  sourceAt: string;
}

export function emptyExtraction(partial: Partial<Extraction> = {}): Extraction {
  return {
    isBusiness: false,
    openLoops: [],
    close: { replied: false, fulfilled: false },
    ...partial,
  };
}

export function isLoopKind(value: string): value is LoopKind {
  return (LOOP_KINDS as readonly string[]).includes(value);
}

export function isDirection(value: string): value is Direction {
  return value === "we_owe" || value === "they_owe";
}

export function isContactRole(value: string): value is ContactRole {
  return (CONTACT_ROLES as readonly string[]).includes(value);
}

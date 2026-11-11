import type {
  ContactRole,
  Direction,
  Extraction,
  KnownAccount,
  KnownContact,
  KnownLoop,
  LoopKind,
  SourceMaterial,
} from "./types";

const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "live.com",
  "aol.com",
]);

export interface PlannedAccount {
  tempId: string;
  name: string;
  domain: string | null;
  website: string | null;
  motion: "land";
}

export interface PlannedContact {
  tempId: string;
  accountId?: string;
  accountTempId?: string;
  email: string;
  firstName: string;
  lastName: string;
  role: ContactRole;
  roleConfidence: number;
  roleConfirmed: boolean;
}

export interface PlannedLoop {
  accountId?: string;
  accountTempId?: string;
  contactId?: string;
  contactTempId?: string;
  direction: Direction;
  kind: LoopKind;
  subject: string;
  detail: string;
  dueOn: string | null;
  dueIsStated: boolean;
  sourceExcerpt: string;
  threadKey: string | null;
  sourceRef: string;
}

export interface IngestionPlan {
  skipped: boolean;
  filterReason?: string;
  newAccounts: PlannedAccount[];
  newContacts: PlannedContact[];
  summary?: { account?: string; contact?: string };
  accountId?: string;
  accountTempId?: string;
  contactId?: string;
  contactTempId?: string;
  roleUpdate?: { contactId: string; role: ContactRole; confidence: number };
  closeLoops: { loopId: string; reason: "replied" | "fulfilled" }[];
  openLoops: PlannedLoop[];
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain || FREEMAIL.has(domain)) return null;
  return domain;
}

export function isFreemail(email: string | null | undefined): boolean {
  const domain = email?.split("@")[1]?.trim().toLowerCase() ?? "";
  return FREEMAIL.has(domain);
}

export function companyFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function counterpartyEmail(source: SourceMaterial, sellerEmail: string): string | null {
  const seller = sellerEmail.toLowerCase();
  if (source.direction === "outbound") {
    return source.counterpartyEmails.find((email) => email.toLowerCase() !== seller) ?? null;
  }
  if (source.fromEmail && source.fromEmail.toLowerCase() !== seller) return source.fromEmail;
  return source.counterpartyEmails.find((email) => email.toLowerCase() !== seller) ?? source.fromEmail;
}

function fulfillment(text: string): boolean {
  return /\b(attached|as promised|here is|here's|i've attached|ive attached|sending the|sent the)\b/i.test(text);
}

export function planIngestion(input: {
  ownerUserId: string;
  sellerEmail: string;
  source: SourceMaterial;
  extraction: Extraction;
  accounts: KnownAccount[];
  contacts: KnownContact[];
  loops: KnownLoop[];
}): IngestionPlan {
  if (!input.extraction.isBusiness) {
    return {
      skipped: true,
      filterReason: input.extraction.filterReason ?? "Not a business conversation.",
      newAccounts: [],
      newContacts: [],
      closeLoops: [],
      openLoops: [],
    };
  }

  const partyEmail = (input.extraction.contactEmail || counterpartyEmail(input.source, input.sellerEmail) || "")
    .trim()
    .toLowerCase();
  const domain =
    input.extraction.accountDomain?.toLowerCase() ||
    emailDomain(partyEmail) ||
    emailDomain(input.source.fromEmail) ||
    input.source.counterpartyEmails.map((email) => emailDomain(email)).find(Boolean) ||
    null;

  let account = input.accounts.find((item) => item.domain && domain && item.domain.toLowerCase() === domain);
  if (!account && partyEmail) {
    const contact = input.contacts.find((item) => item.email.toLowerCase() === partyEmail);
    if (contact?.accountId) account = input.accounts.find((item) => item.id === contact.accountId);
  }

  const newAccounts: PlannedAccount[] = [];
  let accountTempId: string | undefined;
  const accountId = account?.id;
  if (!accountId) {
    const name =
      input.extraction.accountName?.trim() ||
      (domain ? companyFromDomain(domain) : input.extraction.contactName?.trim() || "Unassigned");
    accountTempId = `new-account-${input.source.externalId}`;
    newAccounts.push({
      tempId: accountTempId,
      name,
      domain,
      website: domain ? `https://${domain}` : null,
      motion: "land",
    });
  }

  const contact = partyEmail
    ? input.contacts.find((item) => item.email.toLowerCase() === partyEmail)
    : undefined;
  const newContacts: PlannedContact[] = [];
  let contactTempId: string | undefined;
  const contactId = contact?.id;
  if (!contactId && partyEmail) {
    const name = splitName(input.extraction.contactName || input.source.fromName || partyEmail.split("@")[0]);
    contactTempId = `new-contact-${input.source.externalId}`;
    const role = input.extraction.proposedRole?.role ?? "unknown";
    newContacts.push({
      tempId: contactTempId,
      accountId,
      accountTempId,
      email: partyEmail,
      firstName: name.firstName,
      lastName: name.lastName,
      role,
      roleConfidence: input.extraction.proposedRole?.confidence ?? 0.4,
      roleConfirmed: false,
    });
  }

  const roleUpdate =
    contact && !contact.roleConfirmed && input.extraction.proposedRole && input.extraction.proposedRole.role !== "unknown"
      ? { contactId: contact.id, role: input.extraction.proposedRole.role, confidence: input.extraction.proposedRole.confidence }
      : undefined;

  const closeLoops: IngestionPlan["closeLoops"] = [];
  const seenClose = new Set<string>();
  const close = (loopId: string, reason: "replied" | "fulfilled") => {
    if (seenClose.has(loopId)) return;
    seenClose.add(loopId);
    closeLoops.push({ loopId, reason });
  };

  const ownLoops = input.loops.filter((loop) => loop.ownerUserId === input.ownerUserId && loop.status === "open" && !loop.suppressed);

  if (input.source.direction === "inbound" && input.source.threadKey && partyEmail) {
    for (const loop of ownLoops) {
      if (loop.direction !== "they_owe") continue;
      if (loop.threadKey !== input.source.threadKey) continue;
      if ((loop.contactEmail ?? "").toLowerCase() !== partyEmail) continue;
      if (loop.sourceAt >= input.source.occurredAt) continue;
      close(loop.id, "replied");
    }
  }

  if (input.extraction.close.replied && partyEmail) {
    for (const loop of ownLoops) {
      if (loop.direction !== "they_owe") continue;
      if ((loop.contactEmail ?? "").toLowerCase() !== partyEmail) continue;
      if (input.source.threadKey && loop.threadKey && loop.threadKey !== input.source.threadKey) continue;
      close(loop.id, "replied");
    }
  }

  const looksFulfilled = input.extraction.close.fulfilled || (input.source.direction === "outbound" && fulfillment(input.source.bodyText));
  if (looksFulfilled && input.source.threadKey) {
    for (const loop of ownLoops) {
      if (loop.direction !== "we_owe") continue;
      if (loop.threadKey !== input.source.threadKey) continue;
      close(loop.id, "fulfilled");
    }
  }

  const existingRefs = new Set(input.loops.filter((loop) => loop.ownerUserId === input.ownerUserId).map((loop) => loop.sourceRef));
  const openLoops: PlannedLoop[] = [];
  for (const loop of input.extraction.openLoops) {
    if (closeLoops.some((item) => item.reason === "replied") && loop.direction === "they_owe" && loop.kind === "meeting_request") {
      continue;
    }
    const sourceRef = `${input.source.externalId}:${loop.kind}:${loop.direction}`;
    if (existingRefs.has(sourceRef)) continue;
    const duplicateOpen = ownLoops.some(
      (existing) =>
        existing.kind === loop.kind &&
        existing.direction === loop.direction &&
        existing.threadKey &&
        existing.threadKey === input.source.threadKey &&
        (existing.contactEmail ?? "").toLowerCase() === partyEmail,
    );
    if (duplicateOpen) continue;
    existingRefs.add(sourceRef);
    openLoops.push({
      accountId,
      accountTempId,
      contactId,
      contactTempId,
      direction: loop.direction,
      kind: loop.kind,
      subject: loop.subject,
      detail: loop.detail,
      dueOn: loop.dueOn,
      dueIsStated: loop.dueIsStated,
      sourceExcerpt: loop.excerpt || input.source.bodyText.slice(0, 500),
      threadKey: input.source.threadKey,
      sourceRef,
    });
  }

  return {
    skipped: false,
    newAccounts,
    newContacts,
    summary: input.extraction.summary ?? undefined,
    accountId,
    accountTempId,
    contactId,
    contactTempId,
    roleUpdate,
    closeLoops,
    openLoops,
  };
}

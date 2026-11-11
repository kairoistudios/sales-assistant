import { randomUUID } from "node:crypto";
import { LocalCrm } from "@/lib/adapters/crm/local";
import type { CrmAdapter } from "@/lib/adapters/crm/types";
import { Turb0PartnersCrm } from "@/lib/adapters/crm/turb0";
import { createLlmProvider } from "@/lib/adapters/llm";
import type { LlmProvider } from "@/lib/adapters/llm";
import { DemoMail } from "@/lib/adapters/mail/demo";
import { MicrosoftMail, microsoftTokenRequest, MICROSOFT_SCOPES } from "@/lib/adapters/mail/microsoft";
import type { MailCalendarAdapter, NormalizedEvent, NormalizedMail } from "@/lib/adapters/mail/types";
import { getConfig, type AppConfig } from "@/lib/config";
import { getDb, many, one, run, withTx, type Db } from "@/lib/db";
import { customerSendAllowed, externalCrmWriteAllowed } from "@/lib/domain/autonomy";
import { parseBriefingCommand, type ParsedCommand } from "@/lib/domain/commands";
import { draftCorpus, heuristicDraft, stripUnverifiedClaims, type DraftInput } from "@/lib/domain/draft";
import { buildEvidence } from "@/lib/domain/evidence";
import { planIngestion, type IngestionPlan } from "@/lib/domain/ingest";
import { rankAndCap, type RankInput } from "@/lib/domain/ranking";
import {
  addBusinessDays,
  civilDate,
  dayContext,
  formatCivil,
  formatLongCivil,
  holidayMap,
  isDueOnOrBefore,
  parseTimingConfig,
  scheduleNext,
  setProposalWindow,
  zonedTimeToUtc,
  type TimingConfig,
} from "@/lib/domain/timing";
import type { Direction, Extraction, KnownAccount, KnownContact, KnownLoop, LoopKind, SourceMaterial } from "@/lib/domain/types";
import { contactLabel } from "@/lib/format";
import { ensureOrganization, seedDemo } from "@/lib/seed/demo";

export class ActionError extends Error {}

export interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  timezone: string;
  autonomy: "suggest_only" | "auto_log" | "auto_send";
  voice_notes: string;
  briefing_hour: number;
  microsoft_oid: string | null;
  microsoft_refresh_token: string | null;
  microsoft_access_token: string | null;
  microsoft_token_expires: string | null;
  crm_provider: string;
  crm_access_token: string | null;
  crm_refresh_token: string | null;
  crm_token_expires: string | null;
  crm_user_id: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  timing_json: string;
  briefing_cap: number;
}

interface LoopRow {
  id: string;
  org_id: string;
  owner_user_id: string;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  direction: Direction;
  kind: LoopKind;
  subject: string;
  detail: string;
  status: "open" | "closed";
  due_on: string | null;
  due_stated: number;
  source_type: string;
  source_ref: string | null;
  source_excerpt: string;
  source_at: string;
  thread_key: string | null;
  nudge_stage: number;
  last_nudged_at: string | null;
  next_action_at: string | null;
  next_channel: "email" | "phone" | "other" | null;
  snooze_until: string | null;
  suppressed: number;
  closed_reason: string | null;
}

interface ContactRow {
  id: string;
  account_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  role: string;
  role_confidence: number | null;
  role_confirmed: number;
  timezone: string | null;
  summary: string;
  kind: string;
  external_crm_id: string | null;
}

interface AccountRow {
  id: string;
  org_id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  motion: "grow" | "land" | null;
  summary: string;
  external_crm_id: string | null;
  is_prospect: number;
}

interface OpportunityRow {
  id: string;
  name: string;
  stage: string;
  value_cents: number | null;
  motion: "grow" | "land" | null;
  external_crm_id: string | null;
  contract_type: "subscription" | "one_time" | null;
  close_on: string | null;
  account_id: string | null;
}

export interface Runtime {
  db: Db;
  now: Date;
  llm: LlmProvider;
  config: AppConfig;
  mailFor: (user: UserRow) => MailCalendarAdapter;
  crmFor: (user: UserRow) => CrmAdapter;
}

let readyOnce = false;

export function ready(now = new Date()): Db {
  const db = getDb();
  if (!readyOnce) {
    const config = getConfig();
    const existing = one<{ id: string }>(db, "SELECT id FROM organizations LIMIT 1");
    if (!existing) {
      if (config.demoMode) seedDemo(db, now);
      else ensureOrganization(db, now);
    }
    readyOnce = true;
  }
  return db;
}

export function makeRuntime(db: Db, now = new Date(), config = getConfig()): Runtime {
  const llm = createLlmProvider({
    provider: config.llmProvider,
    apiKey: config.llmApiKey,
    model: config.llmModel,
    baseUrl: config.llmBaseUrl,
  });
  return {
    db,
    now,
    llm,
    config,
    mailFor: (user) => mailForUser(db, user, now, config),
    crmFor: (user) => crmForUser(user, config),
  };
}

function mailForUser(db: Db, user: UserRow, now: Date, config: AppConfig): MailCalendarAdapter {
  if (user.microsoft_refresh_token && config.microsoftTenantId && config.microsoftClientId) {
    return new MicrosoftMail(() => microsoftAccessToken(db, user, config));
  }
  if (config.demoMode) return new DemoMail(user.email, now);
  throw new ActionError("Connect Outlook before syncing mail.");
}

function crmForUser(user: UserRow, config: AppConfig): CrmAdapter {
  if (user.crm_provider === "turb0" && config.turb0SupabaseUrl) {
    return new Turb0PartnersCrm({
      supabaseUrl: config.turb0SupabaseUrl,
      anonKey: config.turb0AnonKey,
      authMode: config.turb0AuthMode,
      accessToken: user.crm_access_token,
      serviceRoleKey: config.turb0ServiceRoleKey,
      dryRun: config.crmDryRun,
    });
  }
  return new LocalCrm();
}

async function microsoftAccessToken(db: Db, user: UserRow, config: AppConfig): Promise<string> {
  const expires = user.microsoft_token_expires ? new Date(user.microsoft_token_expires).getTime() : 0;
  if (user.microsoft_access_token && expires > Date.now() + 60_000) return user.microsoft_access_token;
  if (!user.microsoft_refresh_token) throw new ActionError("Outlook is not connected for this seller.");
  const token = await microsoftTokenRequest(
    config.microsoftTenantId,
    new URLSearchParams({
      client_id: config.microsoftClientId,
      client_secret: config.microsoftClientSecret,
      grant_type: "refresh_token",
      refresh_token: user.microsoft_refresh_token,
      scope: MICROSOFT_SCOPES,
    }),
  );
  const nextExpires = new Date(Date.now() + token.expires_in * 1000).toISOString();
  run(
    db,
    `UPDATE users SET microsoft_access_token = ?, microsoft_refresh_token = ?, microsoft_token_expires = ? WHERE id = ?`,
    [token.access_token, token.refresh_token || user.microsoft_refresh_token, nextExpires, user.id],
  );
  return token.access_token;
}

export function getUser(db: Db, id: string): UserRow {
  const user = one<UserRow>(db, "SELECT * FROM users WHERE id = ?", [id]);
  if (!user) throw new ActionError("That seller is not in this workspace.");
  return user;
}

export function getUserByEmail(db: Db, email: string): UserRow | undefined {
  return one<UserRow>(db, "SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
}

export function listUsers(db: Db, orgId: string): UserRow[] {
  return many<UserRow>(db, "SELECT * FROM users WHERE org_id = ? ORDER BY name", [orgId]);
}

function orgOf(db: Db, orgId: string): OrgRow {
  const org = one<OrgRow>(db, "SELECT * FROM organizations WHERE id = ?", [orgId]);
  if (!org) throw new ActionError("Organization missing.");
  return org;
}

function timingOf(org: OrgRow): TimingConfig {
  return parseTimingConfig(JSON.parse(org.timing_json));
}

function audit(
  db: Db,
  input: {
    orgId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
    at: string;
  },
) {
  run(
    db,
    `INSERT INTO audit_log (id, org_id, user_id, action, entity_type, entity_id, summary, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.orgId,
      input.userId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.summary,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.at,
    ],
  );
}

function recomputeLoop(db: Db, loop: LoopRow, config: TimingConfig, now: Date) {
  const contact = loop.contact_id
    ? one<{ timezone: string | null }>(db, "SELECT timezone FROM contacts WHERE id = ?", [loop.contact_id])
    : undefined;
  const owner = one<{ timezone: string }>(db, "SELECT timezone FROM users WHERE id = ?", [loop.owner_user_id]);
  const timeZone = contact?.timezone || owner?.timezone || config.fallbackTimeZone;
  const schedule = scheduleNext({
    kind: loop.kind,
    anchorAt: new Date(loop.source_at),
    dueOn: loop.due_on,
    dueIsStated: loop.due_stated === 1,
    nudgeStage: loop.nudge_stage,
    lastNudgedAt: loop.last_nudged_at ? new Date(loop.last_nudged_at) : null,
    snoozeUntil: loop.snooze_until ? new Date(loop.snooze_until) : null,
    status: loop.status,
    suppressed: loop.suppressed === 1,
    timeZone,
    config,
  });
  run(
    db,
    `UPDATE loops SET next_action_at = ?, next_channel = ?, updated_at = ? WHERE id = ?`,
    [schedule.nextAt?.toISOString() ?? null, schedule.nextStage?.channel ?? null, now.toISOString(), loop.id],
  );
}

function loadLoop(db: Db, id: string): LoopRow {
  const loop = one<LoopRow>(db, "SELECT * FROM loops WHERE id = ?", [id]);
  if (!loop) throw new ActionError("That loop is gone.");
  return loop;
}

function knownState(db: Db, orgId: string, ownerId: string) {
  const accounts = many<AccountRow>(db, "SELECT * FROM accounts WHERE org_id = ?", [orgId]).map(
    (account): KnownAccount => ({ id: account.id, name: account.name, domain: account.domain }),
  );
  const contacts = many<ContactRow>(db, "SELECT * FROM contacts WHERE org_id = ?", [orgId]).map(
    (contact): KnownContact => ({
      id: contact.id,
      email: contact.email || "",
      name: contactLabel(contact.first_name, contact.last_name),
      accountId: contact.account_id,
      kind: contact.kind === "partner" ? "partner" : "client",
      roleConfirmed: contact.role_confirmed === 1,
    }),
  );
  const loops = many<LoopRow>(db, "SELECT * FROM loops WHERE owner_user_id = ?", [ownerId]).map((loop): KnownLoop => {
    const contact = contacts.find((item) => item.id === loop.contact_id);
    return {
      id: loop.id,
      ownerUserId: loop.owner_user_id,
      accountId: loop.account_id,
      contactId: loop.contact_id,
      contactEmail: contact?.email ?? null,
      threadKey: loop.thread_key,
      sourceRef: loop.source_ref,
      direction: loop.direction,
      kind: loop.kind,
      status: loop.status,
      suppressed: loop.suppressed === 1,
      subject: loop.subject,
      sourceAt: loop.source_at,
    };
  });
  return { accounts, contacts, loops };
}

function mergeSummary(existing: string, addition?: string): string {
  if (!addition) return existing;
  return [addition, existing].filter(Boolean).join("\n").slice(0, 1200);
}

function applyPlan(db: Db, runtime: Runtime, user: UserRow, source: SourceMaterial, plan: IngestionPlan, config: TimingConfig) {
  const at = runtime.now.toISOString();
  const accountIds = new Map<string, string>();
  const contactIds = new Map<string, string>();
  withTx(db, () => {
    for (const account of plan.newAccounts) {
      const id = randomUUID();
      accountIds.set(account.tempId, id);
      run(
        db,
        `INSERT INTO accounts (id, org_id, name, domain, website, motion, summary, is_prospect, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'land', '', 1, ?, ?, ?)`,
        [id, user.org_id, account.name, account.domain, account.website, user.id, at, at],
      );
      audit(db, {
        orgId: user.org_id,
        userId: user.id,
        action: "record_change",
        entityType: "account",
        entityId: id,
        summary: `Created account ${account.name}.`,
        after: account,
        at,
      });
    }
    for (const contact of plan.newContacts) {
      const id = randomUUID();
      contactIds.set(contact.tempId, id);
      const accountId = contact.accountId || (contact.accountTempId ? accountIds.get(contact.accountTempId) : null) || null;
      run(
        db,
        `INSERT INTO contacts (
          id, org_id, account_id, kind, first_name, last_name, email, role, role_confidence, role_confirmed, summary, created_at, updated_at
        ) VALUES (?, ?, ?, 'client', ?, ?, ?, ?, ?, 0, '', ?, ?)`,
        [id, user.org_id, accountId, contact.firstName, contact.lastName, contact.email, contact.role, contact.roleConfidence, at, at],
      );
      audit(db, {
        orgId: user.org_id,
        userId: user.id,
        action: "record_change",
        entityType: "contact",
        entityId: id,
        summary: `Added ${contact.firstName} ${contact.lastName}. Proposed role: ${contact.role}.`,
        at,
      });
    }
    if (plan.roleUpdate) {
      run(
        db,
        `UPDATE contacts SET role = ?, role_confidence = ?, updated_at = ? WHERE id = ? AND role_confirmed = 0`,
        [plan.roleUpdate.role, plan.roleUpdate.confidence, at, plan.roleUpdate.contactId],
      );
    }
    const accountId = plan.accountId || (plan.accountTempId ? accountIds.get(plan.accountTempId) : null);
    const contactId = plan.contactId || (plan.contactTempId ? contactIds.get(plan.contactTempId) : null);
    if (plan.summary?.account && accountId) {
      const current = one<{ summary: string }>(db, "SELECT summary FROM accounts WHERE id = ?", [accountId]);
      run(db, "UPDATE accounts SET summary = ?, updated_at = ? WHERE id = ?", [
        mergeSummary(current?.summary ?? "", plan.summary.account),
        at,
        accountId,
      ]);
    }
    if (plan.summary?.contact && contactId) {
      const current = one<{ summary: string }>(db, "SELECT summary FROM contacts WHERE id = ?", [contactId]);
      run(db, "UPDATE contacts SET summary = ?, updated_at = ? WHERE id = ?", [
        mergeSummary(current?.summary ?? "", plan.summary.contact),
        at,
        contactId,
      ]);
    }
    for (const close of plan.closeLoops) {
      run(
        db,
        `UPDATE loops SET status = 'closed', closed_at = ?, closed_reason = ?, next_action_at = NULL, updated_at = ? WHERE id = ? AND owner_user_id = ?`,
        [source.occurredAt, close.reason, at, close.loopId, user.id],
      );
      audit(db, {
        orgId: user.org_id,
        userId: user.id,
        action: "loop_closed",
        entityType: "loop",
        entityId: close.loopId,
        summary: close.reason === "replied" ? "Closed because the contact replied." : "Closed because the commitment was fulfilled.",
        at,
      });
    }
    for (const loop of plan.openLoops) {
      const id = randomUUID();
      const resolvedAccount = loop.accountId || (loop.accountTempId ? accountIds.get(loop.accountTempId) : null) || null;
      const resolvedContact = loop.contactId || (loop.contactTempId ? contactIds.get(loop.contactTempId) : null) || null;
      run(
        db,
        `INSERT INTO loops (
          id, org_id, owner_user_id, account_id, contact_id, direction, kind, subject, detail, status, due_on, due_stated,
          source_type, source_ref, source_excerpt, source_at, thread_key, nudge_stage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          user.org_id,
          user.id,
          resolvedAccount,
          resolvedContact,
          loop.direction,
          loop.kind,
          loop.subject,
          loop.detail,
          loop.dueOn,
          loop.dueIsStated ? 1 : 0,
          source.sourceType,
          loop.sourceRef,
          loop.sourceExcerpt,
          source.occurredAt,
          loop.threadKey,
          at,
          at,
        ],
      );
      audit(db, {
        orgId: user.org_id,
        userId: user.id,
        action: "loop_opened",
        entityType: "loop",
        entityId: id,
        summary: `Opened “${loop.subject}”.`,
        after: { direction: loop.direction, kind: loop.kind },
        at,
      });
    }
  });
  const fresh = many<LoopRow>(db, "SELECT * FROM loops WHERE owner_user_id = ? AND status = 'open'", [user.id]);
  for (const loop of fresh) recomputeLoop(db, loop, config, runtime.now);
}

function describePlan(plan: IngestionPlan): string {
  if (plan.skipped) return plan.filterReason || "Skipped.";
  const bits: string[] = [];
  for (const loop of plan.openLoops) {
    const who = loop.direction === "we_owe" ? "You owe" : "They owe";
    const due = loop.dueOn ? ` by ${formatCivil(loop.dueOn)}` : "";
    bits.push(`${who}: ${loop.subject}${due}.`);
  }
  for (const close of plan.closeLoops) {
    bits.push(close.reason === "replied" ? "Closed a loop because they replied." : "Closed a loop as fulfilled.");
  }
  if (plan.newAccounts[0]) bits.push(`Filed the account as ${plan.newAccounts[0].name}.`);
  if (!bits.length) bits.push("Updated the running summary. No new loop.");
  return bits.join(" ");
}

async function extractFor(runtime: Runtime, user: UserRow, source: SourceMaterial): Promise<Extraction> {
  const org = orgOf(runtime.db, user.org_id);
  const domains = many<{ domain: string | null }>(runtime.db, "SELECT domain FROM accounts WHERE org_id = ?", [user.org_id])
    .map((row) => row.domain)
    .filter((domain): domain is string => Boolean(domain));
  const today = civilDate(runtime.now, user.timezone);
  if (source.sourceType === "meeting_notes" || source.direction === "internal") {
    return runtime.llm.extractNote({ source, sellerName: user.name, today, timeZone: user.timezone });
  }
  if (source.sourceType === "calendar") {
    return runtime.llm.extractEvent({ source, sellerEmail: user.email, today, timeZone: user.timezone });
  }
  return runtime.llm.extractMessage({
    source,
    sellerEmail: user.email,
    sellerName: user.name,
    knownAccountDomains: domains,
    today,
    timeZone: org.timezone,
  });
}

export async function ingestSource(runtime: Runtime, user: UserRow, source: SourceMaterial): Promise<string> {
  const org = orgOf(runtime.db, user.org_id);
  const config = timingOf(org);
  const extraction = await extractFor(runtime, user, source);
  const known = knownState(runtime.db, user.org_id, user.id);
  const plan = planIngestion({
    ownerUserId: user.id,
    sellerEmail: user.email,
    source,
    extraction,
    accounts: known.accounts,
    contacts: known.contacts,
    loops: known.loops,
  });
  applyPlan(runtime.db, runtime, user, source, plan, config);
  return describePlan(plan);
}

export async function ingestMail(runtime: Runtime, user: UserRow, mail: NormalizedMail): Promise<string> {
  const existing = one(runtime.db, "SELECT id FROM messages WHERE user_id = ? AND external_id = ?", [user.id, mail.externalId]);
  if (existing) return "Already read.";
  const source: SourceMaterial = {
    externalId: mail.externalId,
    threadKey: mail.threadKey,
    sourceType: "email",
    direction: mail.direction,
    fromEmail: mail.fromEmail,
    fromName: mail.fromName,
    counterpartyEmails: mail.direction === "outbound" ? mail.toEmails : [mail.fromEmail],
    subject: mail.subject,
    bodyText: mail.bodyText,
    occurredAt: mail.receivedAt,
  };
  const echo = await ingestSource(runtime, user, source);
  const skipped = echo.startsWith("Personal") || echo.startsWith("Automated") || echo.startsWith("No account") || echo.startsWith("Not a");
  run(
    runtime.db,
    `INSERT INTO messages (
      id, user_id, external_id, thread_key, direction, from_email, from_name, to_json, subject, body_text, received_at, is_business, filter_reason, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      user.id,
      mail.externalId,
      mail.threadKey,
      mail.direction,
      mail.fromEmail,
      mail.fromName,
      JSON.stringify(mail.toEmails),
      mail.subject,
      mail.bodyText,
      mail.receivedAt,
      skipped ? 0 : 1,
      skipped ? echo : null,
      runtime.now.toISOString(),
    ],
  );
  return echo;
}

export async function ingestEvent(runtime: Runtime, user: UserRow, event: NormalizedEvent): Promise<string> {
  const existing = one(runtime.db, "SELECT id FROM calendar_events WHERE user_id = ? AND external_id = ?", [user.id, event.externalId]);
  if (existing) return "Already read.";
  if (event.endAt && new Date(event.endAt) > runtime.now) return "Meeting has not ended.";
  const source: SourceMaterial = {
    externalId: event.externalId,
    threadKey: event.externalId,
    sourceType: "calendar",
    direction: "internal",
    fromEmail: user.email,
    fromName: user.name,
    counterpartyEmails: event.attendeeEmails.filter((email) => email !== user.email.toLowerCase()),
    subject: event.subject,
    bodyText: event.bodyText || event.subject,
    occurredAt: event.endAt || event.startAt,
  };
  const echo = await ingestSource(runtime, user, source);
  run(
    runtime.db,
    `INSERT INTO calendar_events (id, user_id, external_id, subject, start_at, end_at, attendees_json, body_text, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      user.id,
      event.externalId,
      event.subject,
      event.startAt,
      event.endAt,
      JSON.stringify(event.attendeeEmails),
      event.bodyText,
      runtime.now.toISOString(),
    ],
  );
  return echo;
}

export interface BriefingItemView {
  id: string;
  rank: number;
  score: number;
  evidence: string;
  draft_subject: string;
  draft_body: string;
  draft_to: string | null;
  channel: string;
  status: string;
  loop_id: string;
  direction: Direction;
  kind: LoopKind;
  subject: string;
  source_excerpt: string;
  account_name: string | null;
  account_id: string | null;
  contact_name: string | null;
  motion: string | null;
  opp_name: string | null;
  value_cents: number | null;
}

export interface HeldView {
  loopId: string;
  subject: string;
  accountName: string | null;
  evidence: string;
}

export interface BriefingView {
  date: string;
  dateLabel: string;
  holiday: string | null;
  deliveredAt: string | null;
  cap: number;
  items: BriefingItemView[];
  held: HeldView[];
}

function signalsFor(db: Db, userId: string) {
  return many<{ loop_kind: string; account_id: string | null; signal: string }>(
    db,
    "SELECT loop_kind, account_id, signal FROM feedback_signals WHERE user_id = ?",
    [userId],
  ).map((row) => ({ kind: row.loop_kind, accountId: row.account_id, signal: row.signal }));
}

async function composeItem(runtime: Runtime, user: UserRow, loop: LoopRow, config: TimingConfig, score: number, parts: unknown) {
  const contact = loop.contact_id ? one<ContactRow>(runtime.db, "SELECT * FROM contacts WHERE id = ?", [loop.contact_id]) : undefined;
  const account = loop.account_id ? one<AccountRow>(runtime.db, "SELECT * FROM accounts WHERE id = ?", [loop.account_id]) : undefined;
  const timeZone = contact?.timezone || user.timezone;
  const evidence = buildEvidence({
    kind: loop.kind,
    direction: loop.direction,
    subject: loop.subject,
    nudgeStage: loop.nudge_stage,
    anchorAt: new Date(loop.source_at),
    dueOn: loop.due_on,
    dueIsStated: loop.due_stated === 1,
    timeZone,
    config,
    now: runtime.now,
  });
  const channel = loop.next_channel || "email";
  const draftInput: DraftInput = {
    sellerName: user.name,
    sellerEmail: user.email,
    voiceNotes: user.voice_notes,
    contactName: contact ? contactLabel(contact.first_name, contact.last_name) : "there",
    contactEmail: contact?.email || "",
    accountName: account?.name || "the account",
    kind: loop.kind,
    direction: loop.direction,
    subject: loop.subject,
    sourceExcerpt: loop.source_excerpt,
    evidence,
    anchorLabel: formatCivil(civilDate(new Date(loop.source_at), timeZone)),
    upcomingStage: loop.nudge_stage + 1,
    channel,
  };
  let draft = heuristicDraft(draftInput);
  try {
    draft = await runtime.llm.draft(draftInput);
  } catch {
    draft = heuristicDraft(draftInput);
  }
  const body = stripUnverifiedClaims(draft.body, draftCorpus(draftInput)) || draft.body;
  return {
    id: randomUUID(),
    score,
    parts,
    evidence,
    subject: draft.subject,
    body,
    to: contact?.email || null,
    channel,
  };
}

export async function ensureBriefing(runtime: Runtime, userId: string, options: { refresh?: boolean } = {}): Promise<BriefingView> {
  const user = getUser(runtime.db, userId);
  const org = orgOf(runtime.db, user.org_id);
  const config = timingOf(org);
  const today = civilDate(runtime.now, user.timezone);
  const context = dayContext(runtime.now, user.timezone, config);
  let briefing = one<{ id: string; delivered_at: string | null; cap: number }>(
    runtime.db,
    "SELECT * FROM briefings WHERE user_id = ? AND briefing_date = ?",
    [user.id, today],
  );
  if (!briefing) {
    const id = randomUUID();
    run(
      runtime.db,
      `INSERT INTO briefings (id, user_id, briefing_date, generated_at, cap) VALUES (?, ?, ?, ?, ?)`,
      [id, user.id, today, runtime.now.toISOString(), org.briefing_cap],
    );
    briefing = { id, delivered_at: null, cap: org.briefing_cap };
  }
  const acted = many<{ loop_id: string }>(
    runtime.db,
    "SELECT loop_id FROM briefing_items WHERE briefing_id = ? AND status != 'pending'",
    [briefing.id],
  ).map((row) => row.loop_id);
  const pendingCount = one<{ n: number }>(
    runtime.db,
    "SELECT COUNT(*) AS n FROM briefing_items WHERE briefing_id = ? AND status = 'pending'",
    [briefing.id],
  );
  if (options.refresh || (pendingCount?.n ?? 0) === 0 && acted.length === 0) {
    if (options.refresh) {
      run(runtime.db, "DELETE FROM briefing_items WHERE briefing_id = ? AND status = 'pending'", [briefing.id]);
    }
    const open = many<LoopRow>(
      runtime.db,
      "SELECT * FROM loops WHERE owner_user_id = ? AND status = 'open' AND suppressed = 0 AND next_action_at IS NOT NULL",
      [user.id],
    ).filter((loop) => isDueOnOrBefore(new Date(loop.next_action_at as string), runtime.now, user.timezone));
    const actedSet = new Set(acted);
    const candidates = open.filter((loop) => !actedSet.has(loop.id));
    const rankedInputs: (RankInput & { loop: LoopRow })[] = candidates.map((loop) => {
      const opportunity = loop.opportunity_id
        ? one<OpportunityRow>(runtime.db, "SELECT * FROM opportunities WHERE id = ?", [loop.opportunity_id])
        : undefined;
      const account = loop.account_id ? one<AccountRow>(runtime.db, "SELECT * FROM accounts WHERE id = ?", [loop.account_id]) : undefined;
      return {
        loop,
        id: loop.id,
        kind: loop.kind,
        direction: loop.direction,
        motion: opportunity?.motion || account?.motion || null,
        stage: opportunity?.stage ?? null,
        valueCents: opportunity?.value_cents ?? null,
        nudgeStage: loop.nudge_stage,
        nextAt: new Date(loop.next_action_at as string),
        accountId: loop.account_id,
      };
    });
    const { selected } = rankAndCap(rankedInputs, org.briefing_cap, runtime.now, user.timezone, config, signalsFor(runtime.db, user.id));
    let rank = acted.length;
    for (const item of selected) {
      if (actedSet.has(item.id)) continue;
      rank += 1;
      const composed = await composeItem(runtime, user, item.loop, config, item.score, item.parts);
      run(
        runtime.db,
        `INSERT INTO briefing_items (
          id, briefing_id, loop_id, rank, score, score_json, evidence, draft_subject, draft_body, draft_to, channel, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          composed.id,
          briefing.id,
          item.loop.id,
          rank,
          Math.round(item.score),
          JSON.stringify(composed.parts),
          composed.evidence,
          composed.subject,
          composed.body,
          composed.to,
          composed.channel,
          runtime.now.toISOString(),
        ],
      );
    }
  }
  if (!briefing.delivered_at) {
    const items = many<BriefingItemView>(runtime.db, briefingItemsSql(), [briefing.id]).filter((item) => item.status === "pending");
    const text = renderBriefingEmail(user, today, context.holiday, items);
    try {
      const mail = runtime.mailFor(user);
      const sent = await mail.sendMail({ to: user.email, subject: `Ledger · ${formatLongCivil(today)}`, text });
      run(runtime.db, "UPDATE briefings SET delivered_at = ?, delivery_message_id = ? WHERE id = ?", [
        runtime.now.toISOString(),
        sent.providerMessageId,
        briefing.id,
      ]);
      run(
        runtime.db,
        `INSERT INTO outbound_messages (id, user_id, kind, to_email, subject, body, sent_at, provider_message_id, status)
         VALUES (?, ?, 'briefing', ?, ?, ?, ?, ?, 'sent')`,
        [randomUUID(), user.id, user.email, `Ledger · ${formatLongCivil(today)}`, text, runtime.now.toISOString(), sent.providerMessageId],
      );
      audit(runtime.db, {
        orgId: user.org_id,
        userId: user.id,
        action: "briefing_delivered",
        entityType: "briefing",
        entityId: briefing.id,
        summary: `Delivered the morning briefing to ${user.email}. No client message was sent.`,
        at: runtime.now.toISOString(),
      });
      briefing.delivered_at = runtime.now.toISOString();
    } catch (error) {
      audit(runtime.db, {
        orgId: user.org_id,
        userId: user.id,
        action: "briefing_delivery_failed",
        entityType: "briefing",
        entityId: briefing.id,
        summary: error instanceof Error ? error.message : "Could not deliver the briefing email.",
        at: runtime.now.toISOString(),
      });
    }
  }
  return readBriefing(runtime, user, briefing.id, today, context.holiday, org.briefing_cap, config);
}

function briefingItemsSql(): string {
  return `SELECT bi.id, bi.rank, bi.score, bi.evidence, bi.draft_subject, bi.draft_body, bi.draft_to, bi.channel, bi.status,
            bi.loop_id, l.direction, l.kind, l.subject, l.source_excerpt, a.name AS account_name, a.id AS account_id,
            TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name,
            COALESCE(o.motion, a.motion) AS motion, o.name AS opp_name, o.value_cents AS value_cents
     FROM briefing_items bi
     JOIN loops l ON l.id = bi.loop_id
     LEFT JOIN accounts a ON a.id = l.account_id
     LEFT JOIN contacts c ON c.id = l.contact_id
     LEFT JOIN opportunities o ON o.id = l.opportunity_id
     WHERE bi.briefing_id = ?
     ORDER BY bi.rank`;
}

function readBriefing(
  runtime: Runtime,
  user: UserRow,
  briefingId: string,
  today: string,
  holiday: string | null,
  cap: number,
  config: TimingConfig,
): BriefingView {
  const items = many<BriefingItemView>(runtime.db, briefingItemsSql(), [briefingId]);
  const included = new Set(items.map((item) => item.loop_id));
  const delivered = one<{ delivered_at: string | null }>(runtime.db, "SELECT delivered_at FROM briefings WHERE id = ?", [briefingId]);
  const open = many<LoopRow>(
    runtime.db,
    "SELECT * FROM loops WHERE owner_user_id = ? AND status = 'open' AND suppressed = 0 AND next_action_at IS NOT NULL",
    [user.id],
  ).filter(
    (loop) =>
      !included.has(loop.id) && isDueOnOrBefore(new Date(loop.next_action_at as string), runtime.now, user.timezone),
  );
  const held: HeldView[] = open.map((loop) => {
    const account = loop.account_id
      ? one<{ name: string }>(runtime.db, "SELECT name FROM accounts WHERE id = ?", [loop.account_id])
      : undefined;
    return {
      loopId: loop.id,
      subject: loop.subject,
      accountName: account?.name ?? null,
      evidence: buildEvidence({
        kind: loop.kind,
        direction: loop.direction,
        subject: loop.subject,
        nudgeStage: loop.nudge_stage,
        anchorAt: new Date(loop.source_at),
        dueOn: loop.due_on,
        dueIsStated: loop.due_stated === 1,
        timeZone: user.timezone,
        config,
        now: runtime.now,
      }),
    };
  });
  return {
    date: today,
    dateLabel: formatLongCivil(today),
    holiday,
    deliveredAt: delivered?.delivered_at ?? null,
    cap,
    items,
    held,
  };
}

function renderBriefingEmail(user: UserRow, today: string, holiday: string | null, items: BriefingItemView[]): string {
  const lines = [
    formatLongCivil(today),
    "",
    `Good morning, ${user.name.split(" ")[0]}.`,
    holiday ? `${holiday}. New nudges move to the next business day. Anything already due is still on the list.` : "",
    "",
    items.length === 0 ? "Nothing is due." : `${items.length} ${items.length === 1 ? "thing" : "things"} worth doing.`,
    "",
  ];
  for (const item of items) {
    lines.push(
      `${item.rank}. ${item.account_name ?? "Account"} — ${item.contact_name ?? ""}`,
      item.evidence,
      "",
      item.channel === "email" ? `Draft: ${item.draft_subject}` : "This one is a call, not an email.",
      item.draft_body,
      "",
    );
  }
  lines.push("Nothing here has been sent to a client. Approve each item in Ledger.");
  return lines.filter((line) => line !== undefined).join("\n");
}

async function requirePendingItem(runtime: Runtime, userId: string, itemId: string) {
  const user = getUser(runtime.db, userId);
  const item = one<{
    id: string;
    briefing_id: string;
    loop_id: string;
    status: string;
    draft_body: string;
    draft_subject: string;
    draft_to: string | null;
    channel: string;
    evidence: string;
  }>(runtime.db, "SELECT * FROM briefing_items WHERE id = ?", [itemId]);
  if (!item) throw new ActionError("That briefing item is not on today's list.");
  const briefing = one<{ user_id: string }>(runtime.db, "SELECT user_id FROM briefings WHERE id = ?", [item.briefing_id]);
  if (!briefing || briefing.user_id !== user.id) throw new ActionError("That item belongs to another seller.");
  if (item.status !== "pending") throw new ActionError("That item was already handled.");
  const loop = loadLoop(runtime.db, item.loop_id);
  if (loop.owner_user_id !== user.id) throw new ActionError("That loop belongs to another seller.");
  return { user, item, loop };
}

async function writeCrmNote(runtime: Runtime, user: UserRow, loop: LoopRow, body: string) {
  const crm = runtime.crmFor(user);
  const connected = crm.provider !== "local";
  const decision = externalCrmWriteAllowed({
    autonomy: user.autonomy,
    hasExplicitApproval: true,
    dryRun: runtime.config.crmDryRun,
    connected,
  });
  if (!decision.write) {
    audit(runtime.db, {
      orgId: user.org_id,
      userId: user.id,
      action: "crm_skipped",
      entityType: "loop",
      entityId: loop.id,
      summary: `External CRM not written (${decision.reason}).`,
      at: runtime.now.toISOString(),
    });
    return;
  }
  if (!loop.opportunity_id) return;
  const opportunity = one<OpportunityRow>(runtime.db, "SELECT * FROM opportunities WHERE id = ?", [loop.opportunity_id]);
  if (!opportunity) return;
  let externalId = opportunity.external_crm_id;
  if (!externalId) {
    const account = opportunity.account_id
      ? one<AccountRow>(runtime.db, "SELECT * FROM accounts WHERE id = ?", [opportunity.account_id])
      : undefined;
    const created = await crm.pushOpportunity({
      name: opportunity.name,
      stage: opportunity.stage,
      valueCents: opportunity.value_cents,
      contractType: opportunity.contract_type,
      closeOn: opportunity.close_on,
      clientExternalId: account?.external_crm_id,
      clientName: account?.name,
      clientWebsite: account?.website,
      createdBy: user.crm_user_id,
    });
    if (created.externalId) {
      externalId = created.externalId;
      run(runtime.db, "UPDATE opportunities SET external_crm_id = ? WHERE id = ?", [externalId, opportunity.id]);
    }
    audit(runtime.db, {
      orgId: user.org_id,
      userId: user.id,
      action: "crm_push",
      entityType: "opportunity",
      entityId: opportunity.id,
      summary: created.ok ? `Pushed opportunity to Turb0 Partners.` : created.reason || "CRM push failed.",
      after: created.request ?? null,
      at: runtime.now.toISOString(),
    });
  }
  if (!externalId) return;
  const note = await crm.pushNote({ opportunityExternalId: externalId, body, createdBy: user.crm_user_id });
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "crm_push",
    entityType: "opportunity_note",
    entityId: opportunity.id,
    summary: note.ok ? "Added an opportunity note in Turb0 Partners." : note.reason || "Note was not written.",
    after: note.request ?? null,
    at: runtime.now.toISOString(),
  });
}

export async function approveItem(runtime: Runtime, userId: string, itemId: string, editedBody?: string): Promise<string> {
  const { user, item, loop } = await requirePendingItem(runtime, userId, itemId);
  const body = (editedBody ?? item.draft_body).trim();
  if (!body) throw new ActionError("The draft is empty.");
  const edited = body !== item.draft_body.trim();
  const org = orgOf(runtime.db, user.org_id);
  const config = timingOf(org);
  const send = customerSendAllowed({
    autonomy: user.autonomy,
    autoSendEnabled: runtime.config.autoSendEnabled,
    hasExplicitApproval: true,
  });
  if (!send.allowed) throw new ActionError("Suggest only: this message needs your approval.");
  let providerMessageId: string | null = null;
  if (item.channel === "email") {
    if (!item.draft_to) throw new ActionError("This contact has no email address, so Ledger will not invent one.");
    const mail = runtime.mailFor(user);
    const sent = await mail.sendMail({ to: item.draft_to, subject: item.draft_subject, text: body });
    providerMessageId = sent.providerMessageId;
    run(
      runtime.db,
      `INSERT INTO outbound_messages (id, user_id, loop_id, briefing_item_id, kind, to_email, subject, body, sent_at, provider_message_id, status)
       VALUES (?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?, 'sent')`,
      [randomUUID(), user.id, loop.id, item.id, item.draft_to, item.draft_subject, body, runtime.now.toISOString(), providerMessageId],
    );
    audit(runtime.db, {
      orgId: user.org_id,
      userId: user.id,
      action: "message_sent",
      entityType: "outbound_message",
      entityId: item.id,
      summary: `Sent “${item.draft_subject}” to ${item.draft_to}.`,
      after: { body },
      at: runtime.now.toISOString(),
    });
  } else {
    audit(runtime.db, {
      orgId: user.org_id,
      userId: user.id,
      action: "call_logged",
      entityType: "loop",
      entityId: loop.id,
      summary: `Logged a call for “${loop.subject}”. No email was sent.`,
      at: runtime.now.toISOString(),
    });
  }
  const at = runtime.now.toISOString();
  if (loop.direction === "we_owe" || loop.nudge_stage + 1 >= 4) {
    const reason = loop.direction === "we_owe" ? "fulfilled" : "sequence_complete";
    run(
      runtime.db,
      `UPDATE loops SET status = 'closed', closed_at = ?, closed_reason = ?, nudge_stage = ?, last_nudged_at = ?, next_action_at = NULL, updated_at = ? WHERE id = ?`,
      [at, reason, loop.nudge_stage + 1, at, at, loop.id],
    );
  } else {
    run(
      runtime.db,
      `UPDATE loops SET nudge_stage = ?, last_nudged_at = ?, snooze_until = NULL, updated_at = ? WHERE id = ?`,
      [loop.nudge_stage + 1, at, at, loop.id],
    );
    recomputeLoop(runtime.db, loadLoop(runtime.db, loop.id), config, runtime.now);
  }
  run(runtime.db, "UPDATE briefing_items SET status = ?, acted_at = ?, draft_body = ? WHERE id = ?", [
    edited ? "edited" : "approved",
    at,
    body,
    item.id,
  ]);
  run(
    runtime.db,
    `INSERT INTO feedback_signals (id, user_id, loop_kind, account_id, signal, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), user.id, loop.kind, loop.account_id, edited ? "edited" : "approved", at],
  );
  await writeCrmNote(
    runtime,
    user,
    loop,
    `[Ledger] ${item.channel === "email" ? "Sent" : "Logged"}: ${loop.subject}\n${item.evidence}\n\n${body}`,
  );
  return item.channel === "email" ? `Sent to ${item.draft_to}.` : "Logged. Nothing was emailed.";
}

export async function snoozeItem(runtime: Runtime, userId: string, itemId: string, until: string): Promise<string> {
  const { user, item, loop } = await requirePendingItem(runtime, userId, itemId);
  const org = orgOf(runtime.db, user.org_id);
  const config = timingOf(org);
  const today = civilDate(runtime.now, user.timezone);
  if (until <= today) throw new ActionError("Snooze to a later day.");
  const holidays = holidayMap(config, until);
  const rolled = holidays.has(until) || [0, 6].includes(new Date(`${until}T12:00:00Z`).getUTCDay()) ? addBusinessDays(until, 0, holidays) : until;
  const when = zonedTimeToUtc(rolled, config.sendHour, config.sendMinute, user.timezone);
  const at = runtime.now.toISOString();
  run(runtime.db, "UPDATE loops SET snooze_until = ?, updated_at = ? WHERE id = ?", [when.toISOString(), at, loop.id]);
  recomputeLoop(runtime.db, { ...loadLoop(runtime.db, loop.id), snooze_until: when.toISOString() }, config, runtime.now);
  run(runtime.db, "UPDATE briefing_items SET status = 'snoozed', acted_at = ? WHERE id = ?", [at, item.id]);
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "record_change",
    entityType: "loop",
    entityId: loop.id,
    summary: `Snoozed “${loop.subject}” until ${formatCivil(rolled)}.`,
    at,
  });
  return rolled === until ? `Snoozed until ${formatCivil(until)}.` : `That day isn't a business day. Snoozed until ${formatCivil(rolled)}.`;
}

export async function dismissItem(runtime: Runtime, userId: string, itemId: string): Promise<string> {
  const { user, item, loop } = await requirePendingItem(runtime, userId, itemId);
  const org = orgOf(runtime.db, user.org_id);
  const config = timingOf(org);
  const today = civilDate(runtime.now, user.timezone);
  const holidays = holidayMap(config, today);
  const next = addBusinessDays(today, 1, holidays);
  const when = zonedTimeToUtc(next, config.sendHour, config.sendMinute, user.timezone);
  const at = runtime.now.toISOString();
  run(runtime.db, "UPDATE loops SET snooze_until = ?, updated_at = ? WHERE id = ?", [when.toISOString(), at, loop.id]);
  recomputeLoop(runtime.db, loadLoop(runtime.db, loop.id), config, runtime.now);
  run(runtime.db, "UPDATE briefing_items SET status = 'dismissed', acted_at = ? WHERE id = ?", [at, item.id]);
  run(
    runtime.db,
    `INSERT INTO feedback_signals (id, user_id, loop_kind, account_id, signal, created_at) VALUES (?, ?, ?, ?, 'dismissed', ?)`,
    [randomUUID(), user.id, loop.kind, loop.account_id, at],
  );
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "record_change",
    entityType: "loop",
    entityId: loop.id,
    summary: `Dismissed “${loop.subject}” for today. It can return on ${formatCivil(next)}.`,
    at,
  });
  return `Dismissed for today. It can come back on ${formatCivil(next)}.`;
}

export async function notRelevantItem(runtime: Runtime, userId: string, itemId: string): Promise<string> {
  const { user, item, loop } = await requirePendingItem(runtime, userId, itemId);
  const at = runtime.now.toISOString();
  run(runtime.db, "UPDATE loops SET suppressed = 1, next_action_at = NULL, updated_at = ? WHERE id = ?", [at, loop.id]);
  run(runtime.db, "UPDATE briefing_items SET status = 'not_relevant', acted_at = ? WHERE id = ?", [at, item.id]);
  run(
    runtime.db,
    `INSERT INTO feedback_signals (id, user_id, loop_kind, account_id, signal, created_at) VALUES (?, ?, ?, ?, 'not_relevant', ?)`,
    [randomUUID(), user.id, loop.kind, loop.account_id, at],
  );
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "record_change",
    entityType: "loop",
    entityId: loop.id,
    summary: `Marked “${loop.subject}” not relevant. It leaves the briefing.`,
    at,
  });
  return "Marked not relevant. Ranking will treat similar items more skeptically.";
}

export async function runCommand(runtime: Runtime, userId: string, text: string): Promise<string> {
  const user = getUser(runtime.db, userId);
  const today = civilDate(runtime.now, user.timezone);
  const parsed = parseBriefingCommand(text, today);
  if (!parsed.ok) throw new ActionError(parsed.error);
  const view = await ensureBriefing(runtime, userId);
  const pending = view.items.filter((item) => item.status === "pending");
  const notes: string[] = [];
  for (const command of parsed.actions) {
    const targets = command.index === 0 ? pending : [pending[command.index - 1]].filter(Boolean);
    if (targets.length === 0) throw new ActionError(`There is no item ${command.index} on the list.`);
    for (const target of targets) notes.push(await applyCommand(runtime, userId, command, target.id));
  }
  return notes.join(" ");
}

async function applyCommand(runtime: Runtime, userId: string, command: ParsedCommand, itemId: string): Promise<string> {
  if (command.type === "approve") return approveItem(runtime, userId, itemId);
  if (command.type === "dismiss") return dismissItem(runtime, userId, itemId);
  if (command.type === "not_relevant") return notRelevantItem(runtime, userId, itemId);
  if (!command.until) throw new ActionError("Snooze needs a date.");
  return snoozeItem(runtime, userId, itemId, command.until);
}

export async function syncMailbox(runtime: Runtime, userId: string): Promise<string> {
  const user = getUser(runtime.db, userId);
  const mail = runtime.mailFor(user);
  const messages = await mail.listMessages();
  const events = await mail.listEvents();
  let read = 0;
  const notes: string[] = [];
  for (const message of messages) {
    const before = one(runtime.db, "SELECT id FROM messages WHERE user_id = ? AND external_id = ?", [user.id, message.externalId]);
    if (before) continue;
    notes.push(await ingestMail(runtime, user, message));
    read += 1;
  }
  for (const event of events) {
    const before = one(runtime.db, "SELECT id FROM calendar_events WHERE user_id = ? AND external_id = ?", [user.id, event.externalId]);
    if (before) continue;
    notes.push(await ingestEvent(runtime, user, event));
    read += 1;
  }
  await ensureBriefing(runtime, userId, { refresh: true });
  return read === 0 ? "Nothing new in the mailbox." : `Read ${read} new item${read === 1 ? "" : "s"}. ${notes.filter(Boolean).slice(0, 3).join(" ")}`;
}

export async function ingestNote(runtime: Runtime, userId: string, title: string, body: string): Promise<string> {
  const user = getUser(runtime.db, userId);
  const source: SourceMaterial = {
    externalId: randomUUID(),
    threadKey: null,
    sourceType: "meeting_notes",
    direction: "internal",
    fromEmail: user.email,
    fromName: user.name,
    counterpartyEmails: [],
    subject: title || "Note",
    bodyText: body,
    occurredAt: runtime.now.toISOString(),
  };
  const echo = await ingestSource(runtime, user, source);
  run(
    runtime.db,
    `INSERT INTO meeting_notes (id, user_id, title, body, occurred_at, source, echo, created_at) VALUES (?, ?, ?, ?, ?, 'paste', ?, ?)`,
    [randomUUID(), user.id, title || "Note", body, runtime.now.toISOString(), echo, runtime.now.toISOString()],
  );
  await ensureBriefing(runtime, userId, { refresh: true });
  return echo;
}

export function closeLoop(runtime: Runtime, userId: string, loopId: string): string {
  const user = getUser(runtime.db, userId);
  const loop = loadLoop(runtime.db, loopId);
  if (loop.owner_user_id !== user.id) throw new ActionError("That loop belongs to another seller.");
  const at = runtime.now.toISOString();
  run(
    runtime.db,
    `UPDATE loops SET status = 'closed', closed_at = ?, closed_reason = 'manual', next_action_at = NULL, updated_at = ? WHERE id = ?`,
    [at, at, loop.id],
  );
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "loop_closed",
    entityType: "loop",
    entityId: loop.id,
    summary: `Closed “${loop.subject}” by hand.`,
    at,
  });
  return "Loop closed.";
}

export function restoreLoop(runtime: Runtime, userId: string, loopId: string): string {
  const user = getUser(runtime.db, userId);
  const loop = loadLoop(runtime.db, loopId);
  if (loop.owner_user_id !== user.id) throw new ActionError("That loop belongs to another seller.");
  const org = orgOf(runtime.db, user.org_id);
  const at = runtime.now.toISOString();
  run(runtime.db, "UPDATE loops SET suppressed = 0, status = 'open', updated_at = ? WHERE id = ?", [at, loop.id]);
  recomputeLoop(runtime.db, loadLoop(runtime.db, loop.id), timingOf(org), runtime.now);
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "record_change",
    entityType: "loop",
    entityId: loop.id,
    summary: `Restored “${loop.subject}” to the briefing.`,
    at,
  });
  return "Restored.";
}

export function confirmRole(runtime: Runtime, userId: string, contactId: string): string {
  const user = getUser(runtime.db, userId);
  const contact = one<ContactRow & { org_id: string }>(runtime.db, "SELECT * FROM contacts WHERE id = ?", [contactId]);
  if (!contact || contact.org_id !== user.org_id) throw new ActionError("That contact is not in your firm.");
  const at = runtime.now.toISOString();
  run(runtime.db, "UPDATE contacts SET role_confirmed = 1, updated_at = ? WHERE id = ?", [at, contactId]);
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "record_change",
    entityType: "contact",
    entityId: contactId,
    summary: `Confirmed ${contactLabel(contact.first_name, contact.last_name)} as ${contact.role.replaceAll("_", " ")}.`,
    at,
  });
  return "Role confirmed.";
}

export function addManualLoop(
  runtime: Runtime,
  userId: string,
  input: { accountId: string; contactId?: string; direction: Direction; kind: LoopKind; subject: string; excerpt: string; dueOn?: string },
): string {
  const user = getUser(runtime.db, userId);
  const account = one<AccountRow>(runtime.db, "SELECT * FROM accounts WHERE id = ?", [input.accountId]);
  if (!account || account.org_id !== user.org_id) throw new ActionError("Pick an account in your firm.");
  const at = runtime.now.toISOString();
  const id = randomUUID();
  run(
    runtime.db,
    `INSERT INTO loops (
      id, org_id, owner_user_id, account_id, contact_id, direction, kind, subject, detail, status, due_on, due_stated,
      source_type, source_ref, source_excerpt, source_at, nudge_stage, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 'manual', ?, ?, ?, 0, ?, ?)`,
    [
      id,
      user.org_id,
      user.id,
      account.id,
      input.contactId || null,
      input.direction,
      input.kind,
      input.subject,
      input.excerpt,
      input.dueOn || null,
      input.dueOn ? 1 : 0,
      `manual-${id}`,
      input.excerpt,
      at,
      at,
      at,
    ],
  );
  recomputeLoop(runtime.db, loadLoop(runtime.db, id), timingOf(orgOf(runtime.db, user.org_id)), runtime.now);
  audit(runtime.db, {
    orgId: user.org_id,
    userId: user.id,
    action: "loop_opened",
    entityType: "loop",
    entityId: id,
    summary: `Opened “${input.subject}” from a note you typed.`,
    at,
  });
  return id;
}

export function saveSettings(
  runtime: Runtime,
  userId: string,
  input: {
    timezone: string;
    voiceNotes: string;
    autonomy: UserRow["autonomy"];
    briefingHour: number;
    cap: number;
    meetingDays: number;
    proposalMin: number;
    proposalMax: number;
    voicemailDays: number;
    extraHolidays: string;
  },
): string {
  const user = getUser(runtime.db, userId);
  const org = orgOf(runtime.db, user.org_id);
  if (!["suggest_only", "auto_log", "auto_send"].includes(input.autonomy)) throw new ActionError("Unknown autonomy level.");
  const autonomy = input.autonomy === "auto_send" && !runtime.config.autoSendEnabled ? "suggest_only" : input.autonomy;
  const holidays = input.extraHolidays
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  let timing = parseTimingConfig(JSON.parse(org.timing_json));
  timing = parseTimingConfig({
    ...timing,
    extraHolidays: holidays,
    kinds: {
      ...timing.kinds,
      meeting_request: {
        ...timing.kinds.meeting_request,
        stages: timing.kinds.meeting_request.stages.map((stage) =>
          stage.stage === 1 ? { ...stage, offsetBusinessDays: input.meetingDays } : stage,
        ),
      },
      voicemail: {
        ...timing.kinds.voicemail,
        stages: timing.kinds.voicemail.stages.map((stage) =>
          stage.stage === 1 ? { ...stage, offsetBusinessDays: input.voicemailDays } : stage,
        ),
      },
    },
  });
  timing = setProposalWindow(timing, input.proposalMin, input.proposalMax);
  const at = runtime.now.toISOString();
  run(runtime.db, "UPDATE users SET timezone = ?, voice_notes = ?, autonomy = ?, briefing_hour = ? WHERE id = ?", [
    input.timezone,
    input.voiceNotes,
    autonomy,
    input.briefingHour,
    user.id,
  ]);
  run(runtime.db, "UPDATE organizations SET timing_json = ?, briefing_cap = ? WHERE id = ?", [
    JSON.stringify(timing),
    Math.max(1, Math.min(12, input.cap)),
    org.id,
  ]);
  const loops = many<LoopRow>(runtime.db, "SELECT * FROM loops WHERE org_id = ? AND status = 'open'", [org.id]);
  for (const loop of loops) recomputeLoop(runtime.db, loop, timing, runtime.now);
  audit(runtime.db, {
    orgId: org.id,
    userId: user.id,
    action: "record_change",
    entityType: "organization",
    entityId: org.id,
    summary: "Updated timing defaults and personal settings.",
    at,
  });
  return autonomy === input.autonomy
    ? "Settings saved. Open loops were rescheduled."
    : "Auto-send stays off until AUTO_SEND_ENABLED is set. Everything else was saved.";
}

export async function customerSendSweep(runtime: Runtime, userId: string): Promise<{ sent: number; reason: string }> {
  const user = getUser(runtime.db, userId);
  const decision = customerSendAllowed({
    autonomy: user.autonomy,
    autoSendEnabled: runtime.config.autoSendEnabled,
    hasExplicitApproval: false,
  });
  if (!decision.allowed) return { sent: 0, reason: decision.reason };
  return { sent: 0, reason: "auto_send_not_implemented_in_phase_1" };
}

export function listAccounts(db: Db, orgId: string): AccountRow[] {
  return many<AccountRow>(db, "SELECT * FROM accounts WHERE org_id = ? ORDER BY name", [orgId]);
}

export function listContacts(db: Db, orgId: string): (ContactRow & { org_id: string })[] {
  return many(db, "SELECT * FROM contacts WHERE org_id = ? ORDER BY first_name", [orgId]);
}

export function listOpportunities(db: Db, orgId: string): (OpportunityRow & { owner_user_id: string; origination_path: string })[] {
  return many(db, "SELECT * FROM opportunities WHERE org_id = ? ORDER BY name", [orgId]);
}

export function listLoops(db: Db, userId: string): LoopRow[] {
  return many<LoopRow>(db, "SELECT * FROM loops WHERE owner_user_id = ? ORDER BY created_at DESC", [userId]);
}

export function listMessages(db: Db, userId: string) {
  return many<{
    id: string;
    subject: string;
    from_email: string | null;
    from_name: string | null;
    received_at: string;
    is_business: number;
    filter_reason: string | null;
    direction: string;
  }>(db, "SELECT * FROM messages WHERE user_id = ? ORDER BY received_at DESC", [userId]);
}

export function listNotes(db: Db, userId: string) {
  return many<{ id: string; title: string; body: string; echo: string; created_at: string }>(
    db,
    "SELECT * FROM meeting_notes WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
}

export function listAudit(db: Db, orgId: string, userId: string) {
  return many<{ id: string; action: string; summary: string; created_at: string; entity_type: string }>(
    db,
    "SELECT * FROM audit_log WHERE org_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC LIMIT 80",
    [orgId, userId],
  );
}

export function listOutbound(db: Db, userId: string) {
  return many<{ id: string; kind: string; to_email: string; subject: string; body: string; sent_at: string; status: string }>(
    db,
    "SELECT * FROM outbound_messages WHERE user_id = ? ORDER BY sent_at DESC",
    [userId],
  );
}

export function getAccount(db: Db, id: string): AccountRow | undefined {
  return one<AccountRow>(db, "SELECT * FROM accounts WHERE id = ?", [id]);
}

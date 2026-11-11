import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import { run } from "@/lib/db";
import type { LoopKind, Direction } from "@/lib/domain/types";
import {
  DEFAULT_TIMING,
  civilDate,
  holidayMap,
  mondayAfterThanksgiving,
  scheduleNext,
  subtractBusinessDays,
  zonedTimeToUtc,
} from "@/lib/domain/timing";

const TZ = "America/New_York";

function at(isoDate: string, hour = 10): string {
  return zonedTimeToUtc(isoDate, hour, 0, TZ).toISOString();
}

export function seedDemo(db: Db, now: Date): void {
  const today = civilDate(now, TZ);
  const holidays = holidayMap(DEFAULT_TIMING, today);
  const back = (days: number) => subtractBusinessDays(today, days, holidays);
  const created = now.toISOString();

  run(
    db,
    `INSERT INTO organizations (id, name, domain, timezone, timing_json, briefing_cap, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["org_turb0", "Turb0", "turb0.ai", TZ, JSON.stringify(DEFAULT_TIMING), 5, created],
  );

  const users = [
    ["user_johnny", "johnny@turb0.ai", "Johnny Ramondino", "Short sentences. Warm and direct. No exclamation marks. Sign off as Johnny. Do not use the phrase circle back."],
    ["user_karimy", "karimy@turb0.ai", "Karimy", "Complete sentences. Slightly formal. Sign off as Karimy."],
  ] as const;
  for (const [id, email, name, voice] of users) {
    run(
      db,
      `INSERT INTO users (id, org_id, email, name, timezone, autonomy, voice_notes, briefing_hour, crm_provider, created_at)
       VALUES (?, 'org_turb0', ?, ?, ?, 'suggest_only', ?, 7, 'local', ?)`,
      [id, email, name, TZ, voice, created],
    );
  }

  run(
    db,
    `INSERT INTO partners (id, org_id, name, email, company, created_at) VALUES (?, 'org_turb0', ?, ?, ?, ?)`,
    ["partner_harbor", "Harbor Referral Group", "hello@harborreferral.com", "Harbor Referral Group", created],
  );

  const accounts: [string, string, string, string, string, string, number][] = [
    ["acct_helios", "Helios Logistics", "helioslogistics.com", "https://helioslogistics.com", "Logistics", "land", 1],
    ["acct_northline", "Northline Retail", "northline.com", "https://northline.com", "Retail", "land", 1],
    ["acct_meridian", "Meridian Financial", "meridianfg.com", "https://meridianfg.com", "Financial services", "grow", 0],
    ["acct_brightpath", "Brightpath Insurance", "brightpath.com", "https://brightpath.com", "Insurance", "land", 1],
    ["acct_larkspur", "Larkspur Health", "larkspurhealth.com", "https://larkspurhealth.com", "Healthcare", "land", 1],
    ["acct_plover", "Plover Civic", "plovercivic.org", "https://plovercivic.org", "Public sector", "land", 1],
    ["acct_vesper", "Vesper Health", "vesperhealth.com", "https://vesperhealth.com", "Healthcare", "grow", 0],
    ["acct_alto", "Alto Municipal Advisors", "altomuni.com", "https://altomuni.com", "Advisory", "land", 1],
  ];
  const summaries: Record<string, string> = {
    acct_helios:
      "Dana Okonkwo, CFO, met Johnny at the Atlanta CFO summit. Helios grew the network faster than the close process, and she is looking at a finance transformation. The introduction came through Samir Haddad at Harbor Referral Group. Johnny offered three meeting times and has not heard back.",
    acct_northline:
      "Marcus Chen, VP Operations, has the store-ops proposal. The work would reshape how Northline runs labor and inventory across the fleet. The proposal went out and the reply window is open.",
    acct_meridian:
      "Existing client. Operating-model phase 2 is in contracting with Priya Shah, the COO. She asked Johnny for the case study before the steering committee. Karimy is in discovery with Helen Cho, treasurer, on a separate treasury analytics scope.",
    acct_brightpath:
      "Elena Vasquez has not called back after a voicemail about a claims diagnostic. The opportunity is still early.",
    acct_larkspur:
      "Nina Alvarez and Johnny met at the Atlanta CFO summit and talked about a service-line review. A first note went out. This is the second nudge.",
    acct_plover: "A small inbound from Jordan Pell about the budget office. Worth a short reply, not a full pursuit this week.",
    acct_vesper:
      "Karimy sent the clinical-ops proposal covering two regional clinics. Andre Silva, CFO, is the buyer. The relationship is an expansion of work already underway.",
    acct_alto: "Ruth Adelayo asked for times to talk about a board-effectiveness intro. Karimy sent options and is waiting.",
  };
  for (const [id, name, domain, website, industry, motion, prospect] of accounts) {
    run(
      db,
      `INSERT INTO accounts (id, org_id, name, domain, website, industry, motion, summary, is_prospect, created_by_user_id, created_at, updated_at)
       VALUES (?, 'org_turb0', ?, ?, ?, ?, ?, ?, ?, 'user_johnny', ?, ?)`,
      [id, name, domain, website, industry, motion, summaries[id] ?? "", prospect, created, created],
    );
  }

  const contacts: [string, string, string, string, string, string, string, string, string, number, number, string][] = [
    ["ct_dana", "acct_helios", "", "client", "Dana", "Okonkwo", "dana.okonkwo@helioslogistics.com", "CFO", "decision_maker", 0.92, 1, "Asked for a working session after the Atlanta summit. Has not picked a time."],
    ["ct_marcus", "acct_northline", "", "client", "Marcus", "Chen", "marcus.chen@northline.com", "VP Operations", "influencer", 0.62, 0, "Has the store-ops proposal. Role is still a proposal, not confirmed."],
    ["ct_priya", "acct_meridian", "", "client", "Priya", "Shah", "priya.shah@meridianfg.com", "COO", "champion", 0.88, 1, "Sponsoring operating-model phase 2. Waiting on the case study."],
    ["ct_helen", "acct_meridian", "", "client", "Helen", "Cho", "helen.cho@meridianfg.com", "Treasurer", "gatekeeper", 0.74, 0, "Controls access to the CFO for the treasury conversation. Role not confirmed."],
    ["ct_elena", "acct_brightpath", "", "client", "Elena", "Vasquez", "elena.vasquez@brightpath.com", "Director of Claims", "unknown", 0.4, 0, "Voicemail left. No callback yet."],
    ["ct_nina", "acct_larkspur", "", "client", "Nina", "Alvarez", "nina.alvarez@larkspurhealth.com", "VP Strategy", "influencer", 0.6, 0, "Met at the Atlanta CFO summit."],
    ["ct_jordan", "acct_plover", "", "client", "Jordan", "Pell", "jordan.pell@plovercivic.org", "Budget Director", "decision_maker", 0.55, 0, "Inbound note about the budget office."],
    ["ct_andre", "acct_vesper", "", "client", "Andre", "Silva", "andre.silva@vesperhealth.com", "CFO", "decision_maker", 0.86, 1, "Buyer on the clinical-ops expansion."],
    ["ct_ruth", "acct_alto", "", "client", "Ruth", "Adelayo", "ruth.adelayo@altomuni.com", "Managing Director", "decision_maker", 0.7, 0, "Asked for times for an intro."],
    ["ct_samir", "", "partner_harbor", "partner", "Samir", "Haddad", "samir.haddad@harborreferral.com", "Principal", "champion", 0.8, 1, "Referred Dana Okonkwo and Helios."],
  ];
  for (const [id, accountId, partnerId, kind, first, last, email, title, role, confidence, confirmed, summary] of contacts) {
    run(
      db,
      `INSERT INTO contacts (
        id, org_id, account_id, partner_id, kind, first_name, last_name, email, title, role, role_confidence, role_confirmed, timezone, summary, created_at, updated_at
      ) VALUES (?, 'org_turb0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId || null,
        partnerId || null,
        kind,
        first,
        last,
        email,
        title,
        role,
        confidence,
        confirmed,
        TZ,
        summary,
        created,
        created,
      ],
    );
  }

  const opportunities: [string, string, string, string, string, string, number, string, string, string][] = [
    ["opp_helios", "acct_helios", "user_johnny", "partner_harbor", "Helios finance transformation", "proposal", 42_000_000, "land", "referral", "subscription"],
    ["opp_northline", "acct_northline", "user_johnny", "", "Northline store operations redesign", "proposal", 78_000_000, "land", "in_person", "subscription"],
    ["opp_meridian", "acct_meridian", "user_johnny", "", "Meridian operating model, phase 2", "contracting", 31_000_000, "grow", "expansion", "subscription"],
    ["opp_treasury", "acct_meridian", "user_karimy", "", "Meridian treasury analytics", "discovery", 19_000_000, "grow", "expansion", "subscription"],
    ["opp_vesper", "acct_vesper", "user_karimy", "", "Vesper clinical operations expansion", "proposal", 54_000_000, "grow", "expansion", "subscription"],
    ["opp_alto", "acct_alto", "user_karimy", "", "Alto board effectiveness", "qualifying", 15_000_000, "land", "in_person", "one_time"],
    ["opp_larkspur", "acct_larkspur", "user_johnny", "", "Larkspur service-line review", "qualifying", 16_000_000, "land", "in_person", "subscription"],
    ["opp_plover", "acct_plover", "user_johnny", "", "Plover budget office", "new", 4_500_000, "land", "inbound", "one_time"],
    ["opp_brightpath", "acct_brightpath", "user_johnny", "", "Brightpath claims diagnostic", "qualifying", 22_000_000, "land", "campaign_reply", "one_time"],
  ];
  for (const [id, accountId, owner, partnerId, name, stage, value, motion, path, contract] of opportunities) {
    run(
      db,
      `INSERT INTO opportunities (
        id, org_id, account_id, owner_user_id, partner_id, name, stage, value_cents, motion, close_on, origination_path, contract_type, summary, created_at, updated_at
      ) VALUES (?, 'org_turb0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      [id, accountId, owner, partnerId || null, name, stage, value, motion, null, path, contract, created, created],
    );
  }

  const insertLoop = (input: {
    id: string;
    owner: string;
    accountId: string;
    contactId: string;
    opportunityId: string;
    direction: Direction;
    kind: LoopKind;
    subject: string;
    excerpt: string;
    anchor: string;
    dueOn?: string | null;
    dueStated?: boolean;
    nudgeStage?: number;
    lastNudgedAt?: string | null;
    threadKey?: string;
    status?: "open" | "closed";
    closedReason?: string;
  }) => {
    const schedule = scheduleNext({
      kind: input.kind,
      anchorAt: new Date(input.anchor),
      dueOn: input.dueOn,
      dueIsStated: input.dueStated,
      nudgeStage: input.nudgeStage ?? 0,
      lastNudgedAt: input.lastNudgedAt ? new Date(input.lastNudgedAt) : null,
      status: input.status ?? "open",
      timeZone: TZ,
      config: DEFAULT_TIMING,
    });
    run(
      db,
      `INSERT INTO loops (
        id, org_id, owner_user_id, account_id, contact_id, opportunity_id, direction, kind, subject, detail, status,
        due_on, due_stated, source_type, source_ref, source_excerpt, source_at, thread_key, nudge_stage, last_nudged_at,
        next_action_at, next_channel, suppressed, closed_at, closed_reason, created_at, updated_at
      ) VALUES (?, 'org_turb0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        input.id,
        input.owner,
        input.accountId,
        input.contactId,
        input.opportunityId,
        input.direction,
        input.kind,
        input.subject,
        input.excerpt,
        input.status ?? "open",
        input.dueOn ?? null,
        input.dueStated ? 1 : 0,
        `seed-${input.id}`,
        input.excerpt,
        input.anchor,
        input.threadKey ?? null,
        input.nudgeStage ?? 0,
        input.lastNudgedAt ?? null,
        schedule.nextAt?.toISOString() ?? null,
        schedule.nextStage?.channel ?? null,
        input.status === "closed" ? input.anchor : null,
        input.closedReason ?? null,
        input.anchor,
        created,
      ],
    );
    run(
      db,
      `INSERT INTO loop_events (id, loop_id, user_id, type, payload_json, created_at) VALUES (?, ?, ?, 'opened', ?, ?)`,
      [randomUUID(), input.id, input.owner, JSON.stringify({ subject: input.subject }), input.anchor],
    );
    run(
      db,
      `INSERT INTO audit_log (id, org_id, user_id, action, entity_type, entity_id, summary, created_at)
       VALUES (?, 'org_turb0', ?, 'loop_opened', 'loop', ?, ?, ?)`,
      [randomUUID(), input.owner, input.id, `Opened “${input.subject}”.`, input.anchor],
    );
  };

  insertLoop({
    id: "loop_helios_times",
    owner: "user_johnny",
    accountId: "acct_helios",
    contactId: "ct_dana",
    opportunityId: "opp_helios",
    direction: "they_owe",
    kind: "meeting_request",
    subject: "Awaiting reply on meeting times",
    excerpt: "Would any of these work for a working session? Tue 10:00, Wed 2:00, or Thu 9:30 ET.",
    anchor: at(back(6)),
    threadKey: "thread-helios-times",
  });
  insertLoop({
    id: "loop_case_study",
    owner: "user_johnny",
    accountId: "acct_meridian",
    contactId: "ct_priya",
    opportunityId: "opp_meridian",
    direction: "we_owe",
    kind: "commitment",
    subject: "Send the case study",
    excerpt: "Priya asked for the operating-model case study before the steering committee.",
    anchor: at(back(3)),
    dueOn: back(1),
    dueStated: true,
    threadKey: "thread-meridian-case",
  });
  insertLoop({
    id: "loop_northline",
    owner: "user_johnny",
    accountId: "acct_northline",
    contactId: "ct_marcus",
    opportunityId: "opp_northline",
    direction: "they_owe",
    kind: "proposal",
    subject: "Northline store-ops proposal",
    excerpt: "Attached the store-ops proposal. Happy to walk Marcus through the phasing.",
    anchor: at(back(4)),
    threadKey: "thread-northline-proposal",
  });
  insertLoop({
    id: "loop_brightpath",
    owner: "user_johnny",
    accountId: "acct_brightpath",
    contactId: "ct_elena",
    opportunityId: "opp_brightpath",
    direction: "they_owe",
    kind: "voicemail",
    subject: "Callback after voicemail",
    excerpt: "Left a voicemail about the claims diagnostic and asked Elena to call back.",
    anchor: at(back(4)),
    threadKey: "thread-brightpath-vm",
  });
  insertLoop({
    id: "loop_larkspur",
    owner: "user_johnny",
    accountId: "acct_larkspur",
    contactId: "ct_nina",
    opportunityId: "opp_larkspur",
    direction: "they_owe",
    kind: "intro",
    subject: "Reply after the Atlanta CFO summit",
    excerpt: "We met at the Atlanta CFO summit and talked about a service-line review.",
    anchor: at(back(8)),
    nudgeStage: 1,
    lastNudgedAt: at(back(3)),
    threadKey: "thread-larkspur-summit",
  });
  insertLoop({
    id: "loop_plover",
    owner: "user_johnny",
    accountId: "acct_plover",
    contactId: "ct_jordan",
    opportunityId: "opp_plover",
    direction: "they_owe",
    kind: "meeting_request",
    subject: "Awaiting reply on a short intro",
    excerpt: "Offered Jordan two times next week for a short intro on the budget office.",
    anchor: at(back(3)),
    threadKey: "thread-plover",
  });
  insertLoop({
    id: "loop_thanksgiving",
    owner: "user_johnny",
    accountId: "acct_helios",
    contactId: "ct_dana",
    opportunityId: "opp_helios",
    direction: "we_owe",
    kind: "check_in",
    subject: "Regroup after Thanksgiving",
    excerpt: "Dana asked to regroup after Thanksgiving, once the peak-season plan is locked.",
    anchor: at(back(6)),
    dueOn: mondayAfterThanksgiving(today),
    dueStated: true,
    threadKey: "thread-helios-thanks",
  });
  insertLoop({
    id: "loop_closed_reply",
    owner: "user_johnny",
    accountId: "acct_northline",
    contactId: "ct_marcus",
    opportunityId: "opp_northline",
    direction: "they_owe",
    kind: "intro",
    subject: "Intro times, already answered",
    excerpt: "Marcus replied and took Tuesday.",
    anchor: at(back(10)),
    status: "closed",
    closedReason: "replied",
    threadKey: "thread-northline-old",
  });

  insertLoop({
    id: "loop_vesper",
    owner: "user_karimy",
    accountId: "acct_vesper",
    contactId: "ct_andre",
    opportunityId: "opp_vesper",
    direction: "they_owe",
    kind: "proposal",
    subject: "Vesper clinical-ops proposal",
    excerpt: "Sent the clinical-ops proposal covering the two regional clinics.",
    anchor: at(back(4)),
    threadKey: "thread-vesper-proposal",
  });
  insertLoop({
    id: "loop_alto",
    owner: "user_karimy",
    accountId: "acct_alto",
    contactId: "ct_ruth",
    opportunityId: "opp_alto",
    direction: "they_owe",
    kind: "meeting_request",
    subject: "Awaiting reply on meeting times",
    excerpt: "Would Thursday or Friday morning work for a board-effectiveness intro?",
    anchor: at(back(6)),
    threadKey: "thread-alto-times",
  });
  insertLoop({
    id: "loop_treasury",
    owner: "user_karimy",
    accountId: "acct_meridian",
    contactId: "ct_helen",
    opportunityId: "opp_treasury",
    direction: "we_owe",
    kind: "commitment",
    subject: "Send the treasury one-pager",
    excerpt: "Helen asked for a one-page view of the treasury analytics scope.",
    anchor: at(back(2)),
    dueOn: back(1),
    dueStated: true,
    threadKey: "thread-meridian-treasury",
  });

  const messages: [string, string, string, string, string, string, string, string, number, string | null][] = [
    [
      "user_johnny",
      "seed-mail-helios",
      "thread-helios-times",
      "outbound",
      "johnny@turb0.ai",
      "Johnny Ramondino",
      "Times for a working session",
      "Would any of these work for a working session? Tue 10:00, Wed 2:00, or Thu 9:30 ET.",
      1,
      null,
    ],
    [
      "user_johnny",
      "seed-mail-soccer",
      "thread-soccer",
      "inbound",
      "maya@gmail.com",
      "Maya",
      "Saturday soccer",
      "Can you bring oranges for the game? School pickup is at 4.",
      0,
      "Personal mail, not tied to an account.",
    ],
    [
      "user_karimy",
      "seed-mail-vesper",
      "thread-vesper-proposal",
      "outbound",
      "karimy@turb0.ai",
      "Karimy",
      "Clinical ops proposal",
      "Sent the clinical-ops proposal covering the two regional clinics.",
      1,
      null,
    ],
  ];
  for (const [userId, externalId, thread, direction, fromEmail, fromName, subject, body, business, reason] of messages) {
    run(
      db,
      `INSERT INTO messages (
        id, user_id, external_id, thread_key, direction, from_email, from_name, to_json, subject, body_text, received_at, is_business, filter_reason, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), userId, externalId, thread, direction, fromEmail, fromName, subject, body, at(back(4)), business, reason, created],
    );
  }
}

export function ensureOrganization(db: Db, now: Date): void {
  const existing = db.prepare("SELECT id FROM organizations LIMIT 1").get();
  if (existing) return;
  const created = now.toISOString();
  run(
    db,
    `INSERT INTO organizations (id, name, domain, timezone, timing_json, briefing_cap, created_at)
     VALUES ('org_turb0', 'Turb0', 'turb0.ai', ?, ?, 5, ?)`,
    [TZ, JSON.stringify(DEFAULT_TIMING), created],
  );
}

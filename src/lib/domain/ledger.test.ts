import { describe, expect, it } from "vitest";
import { customerSendAllowed, externalCrmWriteAllowed } from "./autonomy";
import { parseBriefingCommand } from "./commands";
import { parseStatedDue } from "./due";
import { buildEvidence } from "./evidence";
import { planIngestion } from "./ingest";
import { feedbackAdjustment, rankAndCap, type RankInput } from "./ranking";
import { DEFAULT_TIMING } from "./timing";
import { emptyExtraction, type KnownLoop, type SourceMaterial } from "./types";
import { HeuristicLlm } from "@/lib/adapters/llm/heuristic";
import { OpenAiLlm } from "@/lib/adapters/llm/openai";
import { heuristicDraft, stripUnverifiedClaims } from "./draft";

const llm = new HeuristicLlm();

function source(partial: Partial<SourceMaterial> & Pick<SourceMaterial, "externalId" | "bodyText">): SourceMaterial {
  return {
    threadKey: "thread-1",
    sourceType: "email",
    direction: "inbound",
    fromEmail: null,
    fromName: null,
    counterpartyEmails: [],
    subject: "",
    occurredAt: "2026-11-11T15:00:00.000Z",
    ...partial,
  };
}

describe("evidence", () => {
  it("explains a meeting request with the configured business-day rule", () => {
    const line = buildEvidence({
      kind: "meeting_request",
      direction: "they_owe",
      subject: "Awaiting reply on meeting times",
      nudgeStage: 0,
      anchorAt: new Date("2026-11-03T15:00:00.000Z"),
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
      now: new Date("2026-11-11T15:00:00.000Z"),
    });
    expect(line).toBe("You offered times on Nov 3; no reply after 2 business days.");
  });

  it("quotes the proposal window and a stated commitment", () => {
    expect(
      buildEvidence({
        kind: "proposal",
        direction: "they_owe",
        subject: "Proposal",
        nudgeStage: 0,
        anchorAt: new Date("2026-11-06T15:00:00.000Z"),
        timeZone: "America/New_York",
        config: DEFAULT_TIMING,
        now: new Date("2026-11-11T15:00:00.000Z"),
      }),
    ).toBe("You sent the proposal on Nov 6; no reply in the 3–5 business day window.");

    expect(
      buildEvidence({
        kind: "commitment",
        direction: "we_owe",
        subject: "Send the case study",
        nudgeStage: 0,
        anchorAt: new Date("2026-11-06T15:00:00.000Z"),
        dueOn: "2026-11-10",
        dueIsStated: true,
        timeZone: "America/New_York",
        config: DEFAULT_TIMING,
        now: new Date("2026-11-11T15:00:00.000Z"),
      }),
    ).toBe("You committed to send the case study by Nov 10. That date has passed.");
  });
});

describe("ranking", () => {
  const now = new Date("2026-11-11T15:00:00.000Z");
  const base = (partial: Partial<RankInput> & Pick<RankInput, "id">): RankInput => ({
    kind: "check_in",
    direction: "they_owe",
    motion: "land",
    stage: "qualifying",
    valueCents: 100_000_00,
    nudgeStage: 0,
    nextAt: now,
    accountId: "a1",
    ...partial,
  });

  it("caps the list and ranks overdue and higher-value work first", () => {
    const items = [
      base({ id: "low", valueCents: 80_000_00, nextAt: now }),
      base({ id: "overdue", valueCents: 80_000_00, nextAt: new Date("2026-11-06T14:00:00.000Z") }),
      base({ id: "big", valueCents: 900_000_00, nextAt: now, stage: "proposal" }),
    ];
    const { selected, held } = rankAndCap(items, 2, now, "America/New_York", DEFAULT_TIMING, []);
    expect(selected.map((item) => item.id)).toEqual(["big", "overdue"]);
    expect(held.map((item) => item.id)).toEqual(["low"]);
    const equalValue = rankAndCap(
      [
        base({ id: "today", valueCents: 200_000_00, nextAt: now }),
        base({ id: "late", valueCents: 200_000_00, nextAt: new Date("2026-11-04T14:00:00.000Z") }),
      ],
      2,
      now,
      "America/New_York",
      DEFAULT_TIMING,
      [],
    );
    expect(equalValue.selected.map((item) => item.id)).toEqual(["late", "today"]);
  });

  it("lets not-relevant feedback push a kind down the list", () => {
    const items = [
      base({ id: "voice", kind: "voicemail", valueCents: 200_000_00 }),
      base({ id: "meet", kind: "meeting_request", valueCents: 200_000_00 }),
    ];
    const signals = [{ kind: "voicemail", accountId: "a1", signal: "not_relevant" as const }];
    const { selected } = rankAndCap(items, 2, now, "America/New_York", DEFAULT_TIMING, signals);
    expect(selected[0].id).toBe("meet");
    expect(feedbackAdjustment(signals, { kind: "voicemail", accountId: "a1" })).toBeLessThan(-18);
  });
});

describe("briefing commands", () => {
  it("parses a mixed instruction", () => {
    const parsed = parseBriefingCommand("approve 1 and 3, snooze 2 until Friday", "2026-11-11");
    expect(parsed).toEqual({
      ok: true,
      actions: [
        { type: "approve", index: 1 },
        { type: "approve", index: 3 },
        { type: "snooze", index: 2, until: "2026-11-13" },
      ],
    });
  });

  it("rejects instructions it cannot apply", () => {
    const parsed = parseBriefingCommand("delete everything", "2026-11-11");
    expect(parsed.ok).toBe(false);
  });
});

describe("stated dates", () => {
  it("reads Thanksgiving and weekdays from the spec's kind of note", () => {
    expect(parseStatedDue("Follow up after Thanksgiving.", "2026-11-11")).toBe("2026-11-30");
    expect(parseStatedDue("by Friday", "2026-11-11")).toBe("2026-11-13");
  });
});

describe("ingestion plan", () => {
  const loops: KnownLoop[] = [
    {
      id: "loop-1",
      ownerUserId: "user_johnny",
      accountId: "acct_helios",
      contactId: "contact_dana",
      contactEmail: "dana.okonkwo@helioslogistics.com",
      threadKey: "thread-dana",
      sourceRef: "msg-old:meeting_request:they_owe",
      direction: "they_owe",
      kind: "meeting_request",
      status: "open",
      suppressed: false,
      subject: "Awaiting reply on meeting times",
      sourceAt: "2026-11-03T15:00:00.000Z",
    },
  ];

  it("filters personal mail and does not open a loop", async () => {
    const message = source({
      externalId: "personal-1",
      direction: "inbound",
      fromEmail: "maya@gmail.com",
      fromName: "Maya",
      subject: "Saturday soccer",
      bodyText: "Can you bring oranges for the game?",
    });
    const extraction = await llm.extractMessage({
      source: message,
      sellerEmail: "johnny@turb0.ai",
      sellerName: "Johnny Ramondino",
      knownAccountDomains: ["helioslogistics.com"],
      today: "2026-11-11",
      timeZone: "America/New_York",
    });
    expect(extraction.isBusiness).toBe(false);
    const plan = planIngestion({
      ownerUserId: "user_johnny",
      sellerEmail: "johnny@turb0.ai",
      source: message,
      extraction,
      accounts: [],
      contacts: [],
      loops: [],
    });
    expect(plan.skipped).toBe(true);
    expect(plan.openLoops).toHaveLength(0);
  });

  it("captures both sides of a promise and closes the loop when the contact replies on the thread", async () => {
    const offer = source({
      externalId: "offer-1",
      direction: "outbound",
      fromEmail: "johnny@turb0.ai",
      counterpartyEmails: ["dana.okonkwo@helioslogistics.com"],
      threadKey: "thread-new",
      subject: "Times for a working session",
      bodyText: "Would any of these work? Tue 10:00, Wed 2:00, or Thu 9:30 ET.",
      occurredAt: "2026-11-03T15:00:00.000Z",
    });
    const extraction = await llm.extractMessage({
      source: offer,
      sellerEmail: "johnny@turb0.ai",
      sellerName: "Johnny Ramondino",
      knownAccountDomains: ["helioslogistics.com"],
      today: "2026-11-03",
      timeZone: "America/New_York",
    });
    const plan = planIngestion({
      ownerUserId: "user_johnny",
      sellerEmail: "johnny@turb0.ai",
      source: offer,
      extraction,
      accounts: [{ id: "acct_helios", name: "Helios Logistics", domain: "helioslogistics.com" }],
      contacts: [],
      loops: [],
    });
    expect(plan.openLoops.map((loop) => loop.kind)).toContain("meeting_request");
    expect(plan.openLoops[0].direction).toBe("they_owe");
    expect(plan.newContacts[0]?.email).toBe("dana.okonkwo@helioslogistics.com");

    const reply = source({
      externalId: "reply-1",
      direction: "inbound",
      fromEmail: "dana.okonkwo@helioslogistics.com",
      fromName: "Dana Okonkwo",
      threadKey: "thread-dana",
      subject: "Re: Times",
      bodyText: "Tuesday at 10 works for me.",
      occurredAt: "2026-11-11T15:00:00.000Z",
    });
    const replyPlan = planIngestion({
      ownerUserId: "user_johnny",
      sellerEmail: "johnny@turb0.ai",
      source: reply,
      extraction: emptyExtraction({ isBusiness: true, close: { replied: true, fulfilled: false } }),
      accounts: [{ id: "acct_helios", name: "Helios Logistics", domain: "helioslogistics.com" }],
      contacts: [
        {
          id: "contact_dana",
          email: "dana.okonkwo@helioslogistics.com",
          name: "Dana Okonkwo",
          accountId: "acct_helios",
          kind: "client",
          roleConfirmed: true,
        },
      ],
      loops,
    });
    expect(replyPlan.closeLoops).toEqual([{ loopId: "loop-1", reason: "replied" }]);
    expect(replyPlan.openLoops).toHaveLength(0);
  });

  it("does not let one seller's reply close another seller's loop", () => {
    const reply = source({
      externalId: "reply-2",
      direction: "inbound",
      fromEmail: "dana.okonkwo@helioslogistics.com",
      threadKey: "thread-dana",
      subject: "Re: Times",
      bodyText: "Tuesday works.",
    });
    const plan = planIngestion({
      ownerUserId: "user_karimy",
      sellerEmail: "karimy@turb0.ai",
      source: reply,
      extraction: emptyExtraction({ isBusiness: true, close: { replied: true, fulfilled: false } }),
      accounts: [],
      contacts: [],
      loops,
    });
    expect(plan.closeLoops).toHaveLength(0);
  });

  it("reads the spec's plain-English note into a stated follow-up", async () => {
    const note = source({
      externalId: "note-1",
      sourceType: "meeting_notes",
      direction: "internal",
      subject: "Atlanta CFO summit",
      bodyText:
        "Met Dana Lee at the Atlanta CFO summit. She wants a proposal on finance transformation. Follow up after Thanksgiving.",
      occurredAt: "2026-11-11T18:00:00.000Z",
    });
    const extraction = await llm.extractNote({
      source: note,
      sellerName: "Johnny Ramondino",
      today: "2026-11-11",
      timeZone: "America/New_York",
    });
    expect(extraction.isBusiness).toBe(true);
    expect(extraction.contactName).toBe("Dana Lee");
    const plan = planIngestion({
      ownerUserId: "user_johnny",
      sellerEmail: "johnny@turb0.ai",
      source: note,
      extraction,
      accounts: [],
      contacts: [],
      loops: [],
    });
    expect(plan.openLoops[0]).toMatchObject({
      direction: "we_owe",
      kind: "proposal",
      dueOn: "2026-11-30",
      dueIsStated: true,
    });
  });
});

describe("drafts and autonomy", () => {
  it("keeps invented figures out of a draft and does not send without approval", () => {
    const draft = heuristicDraft({
      sellerName: "Johnny Ramondino",
      sellerEmail: "johnny@turb0.ai",
      voiceNotes: "Short sentences. No exclamation marks. Sign off as Johnny. Do not use the word circle back.",
      contactName: "Dana Okonkwo",
      contactEmail: "dana.okonkwo@helioslogistics.com",
      accountName: "Helios Logistics",
      kind: "meeting_request",
      direction: "they_owe",
      subject: "Awaiting reply on meeting times",
      sourceExcerpt: "Would any of these work? Tue 10:00, Wed 2:00, or Thu 9:30 ET.",
      evidence: "You offered times on Nov 3; no reply after 2 business days.",
      anchorLabel: "Nov 3",
      upcomingStage: 1,
      channel: "email",
    });
    expect(draft.body).toContain("Johnny");
    expect(draft.body).not.toMatch(/!/);
    expect(draft.body.toLowerCase()).not.toContain("circle back");
    expect(stripUnverifiedClaims("Revenue grew 40% last quarter. I sent times on Nov 3.", draft.body + "\nNov 3")).not.toContain(
      "40%",
    );
    expect(customerSendAllowed({ autonomy: "suggest_only", autoSendEnabled: false, hasExplicitApproval: false })).toEqual({
      allowed: false,
      reason: "suggest_only",
    });
    expect(customerSendAllowed({ autonomy: "suggest_only", autoSendEnabled: false, hasExplicitApproval: true }).allowed).toBe(
      true,
    );
    expect(customerSendAllowed({ autonomy: "auto_send", autoSendEnabled: false, hasExplicitApproval: false }).reason).toBe(
      "auto_send_disabled",
    );
    expect(externalCrmWriteAllowed({ autonomy: "suggest_only", hasExplicitApproval: false, dryRun: true, connected: true }).reason).toBe(
      "dry_run",
    );
  });
});

describe("openai provider", () => {
  it("parses a JSON extraction and strips unverifiable draft claims without calling a real model", async () => {
    const calls: string[] = [];
    const provider = new OpenAiLlm({
      apiKey: "test",
      model: "gpt-test",
      baseUrl: "http://llm.test/v1",
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body));
        const system = body.messages[0].content as string;
        const content = system.includes("seller's voice")
          ? JSON.stringify({
              subject: "Times",
              body: "Dana — pipeline is up 40%. I sent times on Nov 3.",
            })
          : JSON.stringify({
              isBusiness: true,
              openLoops: [
                {
                  direction: "they_owe",
                  kind: "meeting_request",
                  subject: "Awaiting reply on meeting times",
                  detail: "Waiting.",
                  dueOn: null,
                  dueIsStated: false,
                  excerpt: "Tue 10:00",
                },
              ],
              close: { replied: false, fulfilled: false },
            });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      },
    });
    const extraction = await provider.extractMessage({
      source: source({
        externalId: "x",
        bodyText: "Tue 10:00",
        direction: "outbound",
        fromEmail: "johnny@turb0.ai",
      }),
      sellerEmail: "johnny@turb0.ai",
      sellerName: "Johnny",
      knownAccountDomains: [],
      today: "2026-11-11",
      timeZone: "America/New_York",
    });
    expect(extraction.openLoops[0].kind).toBe("meeting_request");
    const draft = await provider.draft({
      sellerName: "Johnny Ramondino",
      sellerEmail: "johnny@turb0.ai",
      voiceNotes: "Sign off as Johnny.",
      contactName: "Dana Okonkwo",
      contactEmail: "dana@helioslogistics.com",
      accountName: "Helios Logistics",
      kind: "meeting_request",
      direction: "they_owe",
      subject: "Times",
      sourceExcerpt: "Tue 10:00",
      evidence: "You offered times on Nov 3; no reply after 2 business days.",
      anchorLabel: "Nov 3",
      upcomingStage: 1,
      channel: "email",
    });
    expect(draft.body).not.toContain("40%");
    expect(draft.body).toContain("Nov 3");
    expect(calls.every((url) => url.startsWith("http://llm.test/"))).toBe(true);
  });
});

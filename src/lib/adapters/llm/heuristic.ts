import { parseStatedDue } from "@/lib/domain/due";
import { draftCorpus, heuristicDraft, stripUnverifiedClaims } from "@/lib/domain/draft";
import type { DraftInput, DraftOutput } from "@/lib/domain/draft";
import { addBusinessDays, holidayMap, DEFAULT_TIMING } from "@/lib/domain/timing";
import { emailDomain, isFreemail } from "@/lib/domain/ingest";
import {
  emptyExtraction,
  type ContactRole,
  type Extraction,
  type ExtractionLoop,
  type SourceMaterial,
} from "@/lib/domain/types";
import type { LlmProvider } from "./types";

const PERSONAL =
  /\b(soccer|dentist|pediatric|school pickup|birthday party|love you|your mom|game night|reservation for two|oranges for the game)\b/i;
const AUTOMATED = /\b(unsubscribe|noreply|no-reply|do not reply|mailer-daemon|newsletter)\b/i;
const BUSINESS =
  /\b(proposal|meeting|times|contract|statement of work|follow up|follow-up|voicemail|introduction|deck|case study|scoping|working session|steering committee)\b/i;

function roleFromText(text: string): { role: ContactRole; confidence: number } | null {
  if (/\bgatekeeper\b/i.test(text)) return { role: "gatekeeper", confidence: 0.82 };
  if (/\bchampion\b/i.test(text)) return { role: "champion", confidence: 0.8 };
  if (/\binfluencer\b/i.test(text)) return { role: "influencer", confidence: 0.7 };
  if (/\b(cfo|ceo|coo|chief|president|founder)\b/i.test(text)) return { role: "decision_maker", confidence: 0.7 };
  if (/\b(vp|vice president|head of)\b/i.test(text)) return { role: "influencer", confidence: 0.58 };
  return null;
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("\n", index), text.lastIndexOf("!", index)) + 1;
  const ends = [text.indexOf(".", index), text.indexOf("\n", index), text.indexOf("!", index)].filter((value) => value >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  return text.slice(start, end + 1);
}

function clip(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function loop(partial: ExtractionLoop): ExtractionLoop {
  return partial;
}

function extractLoopsFromText(input: {
  text: string;
  subject: string;
  direction: SourceMaterial["direction"];
  today: string;
  timeZone: string;
}): { loops: ExtractionLoop[]; close: Extraction["close"] } {
  const text = `${input.subject}\n${input.text}`;
  const loops: ExtractionLoop[] = [];
  const close = { replied: false, fulfilled: false };
  const dueFor = (snippet: string) => parseStatedDue(snippet, input.today) ?? parseStatedDue(text, input.today);
  const holidays = holidayMap(DEFAULT_TIMING, input.today);

  if (input.direction === "inbound" && /\b(thanks|got it|this works|works for me|received the proposal|tuesday works|that time works)\b/i.test(text)) {
    close.replied = true;
  }
  if (/\b(attached|as promised|here is the|here's the)\b/i.test(text) && input.direction !== "outbound") {
    close.fulfilled = true;
  }

  const sendMatch = text.match(/I(?:'ll| will)\s+send\s+([^.!\n]+)/i);
  if (sendMatch) {
    const thing = sendMatch[1].trim().replace(/\s+\b(?:by|on|before|after)\b[\s\S]*$/i, "").trim();
    const sellerWrote = input.direction === "outbound" || input.direction === "internal";
    const snippet = sentenceAround(text, sendMatch.index ?? 0);
    const due = dueFor(snippet);
    loops.push(
      loop({
        direction: sellerWrote ? "we_owe" : "they_owe",
        kind: "commitment",
        subject: `Send ${thing}`.replace(/^Send send /i, "Send "),
        detail: clip(snippet),
        dueOn: due,
        dueIsStated: Boolean(parseStatedDue(snippet, input.today)),
        excerpt: clip(snippet),
      }),
    );
  }

  const ask = text.match(/\b(can you send|could you send|please send|send me|send two times|send a few times)\b/i);
  if (ask && input.direction !== "outbound") {
    const snippet = sentenceAround(text, ask.index ?? 0);
    const due = parseStatedDue(snippet, input.today);
    loops.push(
      loop({
        direction: "we_owe",
        kind: /times/i.test(snippet) ? "meeting_request" : "commitment",
        subject: /times/i.test(snippet) ? "Send meeting times" : "Send what they asked for",
        detail: clip(snippet),
        dueOn: due ?? addBusinessDays(input.today, 1, holidays),
        dueIsStated: Boolean(due),
        excerpt: clip(snippet),
      }),
    );
  }

  if (
    input.direction === "outbound" &&
    /\b(would any of these work|here are a few times|a few times|these times)\b/i.test(text)
  ) {
    loops.push(
      loop({
        direction: "they_owe",
        kind: "meeting_request",
        subject: "Awaiting reply on meeting times",
        detail: "Waiting on a reply to offered meeting times.",
        dueOn: null,
        dueIsStated: false,
        excerpt: clip(text),
      }),
    );
  }

  const proposal = text.match(/\b(proposal attached|attached the proposal|sending the proposal|wants a proposal on)\b/i);
  if (proposal) {
    const topic = text.match(/proposal on ([^.!\n]+)/i)?.[1]?.trim();
    const sellerOwes = input.direction !== "outbound" && /wants a proposal/i.test(text);
    const snippet = sentenceAround(text, proposal.index ?? 0);
    const due = sellerOwes ? dueFor(snippet) : null;
    loops.push(
      loop({
        direction: sellerOwes ? "we_owe" : "they_owe",
        kind: "proposal",
        subject: topic ? `Proposal on ${topic}` : "Proposal",
        detail: sellerOwes ? "They asked for a proposal." : "Proposal sent. Waiting on a reply.",
        dueOn: due,
        dueIsStated: Boolean(sellerOwes && due),
        excerpt: clip(snippet),
      }),
    );
  }

  if (/\bvoicemail\b/i.test(text) && input.direction === "outbound") {
    loops.push(
      loop({
        direction: "they_owe",
        kind: "voicemail",
        subject: "Callback after voicemail",
        detail: "Voicemail left. Waiting on a callback.",
        dueOn: null,
        dueIsStated: false,
        excerpt: clip(text),
      }),
    );
  }

  if (input.direction === "internal" && /\bfollow up after thanksgiving\b/i.test(text) && !loops.some((item) => item.dueIsStated)) {
    const due = parseStatedDue(text, input.today);
    loops.push(
      loop({
        direction: "we_owe",
        kind: "check_in",
        subject: "Follow up after Thanksgiving",
        detail: "Seller asked to follow up after Thanksgiving.",
        dueOn: due,
        dueIsStated: Boolean(due),
        excerpt: clip(text),
      }),
    );
  }

  return { loops, close };
}

function classifyMessage(input: {
  source: SourceMaterial;
  sellerEmail: string;
  knownAccountDomains: string[];
}): { isBusiness: boolean; filterReason?: string } {
  const text = `${input.source.subject}\n${input.source.bodyText}`;
  const party =
    input.source.direction === "outbound"
      ? input.source.counterpartyEmails[0]
      : input.source.fromEmail;
  const domain = emailDomain(party);
  const known = Boolean(domain && input.knownAccountDomains.some((item) => item.toLowerCase() === domain));
  if (AUTOMATED.test(text) && !known) {
    return { isBusiness: false, filterReason: "Automated or bulk mail." };
  }
  if (PERSONAL.test(text) && (isFreemail(party) || !domain) && !known) {
    return { isBusiness: false, filterReason: "Personal mail, not tied to an account." };
  }
  if (known || (domain && BUSINESS.test(text)) || BUSINESS.test(text)) {
    return { isBusiness: true };
  }
  if (domain) return { isBusiness: true };
  return { isBusiness: false, filterReason: "No account match and no business commitment." };
}

function summaryFor(source: SourceMaterial, today: string): Extraction["summary"] {
  const sentence = clip(source.bodyText, 180);
  const line = `${today}: ${source.subject}. ${sentence}`;
  return { account: line, contact: line };
}

function contactNameFrom(source: SourceMaterial, text: string): string | null {
  const met = text.match(/\b[Mm]et\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (met) return met[1];
  if (source.fromName && source.direction !== "internal") return source.fromName;
  return null;
}

export class HeuristicLlm implements LlmProvider {
  readonly name = "heuristic";

  async extractMessage(input: {
    source: SourceMaterial;
    sellerEmail: string;
    sellerName: string;
    knownAccountDomains: string[];
    today: string;
    timeZone: string;
  }): Promise<Extraction> {
    const verdict = classifyMessage(input);
    if (!verdict.isBusiness) return emptyExtraction({ isBusiness: false, filterReason: verdict.filterReason });
    const text = input.source.bodyText;
    const found = extractLoopsFromText({
      text,
      subject: input.source.subject,
      direction: input.source.direction,
      today: input.today,
      timeZone: input.timeZone,
    });
    const domain = emailDomain(
      input.source.direction === "outbound" ? input.source.counterpartyEmails[0] : input.source.fromEmail,
    );
    return emptyExtraction({
      isBusiness: true,
      accountDomain: domain,
      contactName: contactNameFrom(input.source, text),
      contactEmail:
        input.source.direction === "outbound" ? input.source.counterpartyEmails[0] : input.source.fromEmail,
      proposedRole: roleFromText(`${input.source.subject}\n${text}`),
      summary: summaryFor(input.source, input.today),
      openLoops: found.loops,
      close: found.close,
    });
  }

  async extractNote(input: { source: SourceMaterial; sellerName: string; today: string; timeZone: string }): Promise<Extraction> {
    const text = `${input.source.subject}\n${input.source.bodyText}`;
    if (PERSONAL.test(text) && !BUSINESS.test(text)) {
      return emptyExtraction({ isBusiness: false, filterReason: "The note does not look like a client conversation." });
    }
    const found = extractLoopsFromText({
      text: input.source.bodyText,
      subject: input.source.subject,
      direction: "internal",
      today: input.today,
      timeZone: input.timeZone,
    });
    const company = text.match(/\bat\s+([A-Z][\w&]+(?:\s+[A-Z][\w&]+){0,3})/);
    const companyName = company && !/the /i.test(company[1]) ? company[1] : null;
    return emptyExtraction({
      isBusiness: true,
      accountName: companyName,
      contactName: contactNameFrom(input.source, text),
      proposedRole: roleFromText(text),
      summary: summaryFor(input.source, input.today),
      openLoops: found.loops,
      close: found.close,
    });
  }

  async extractEvent(input: { source: SourceMaterial; sellerEmail: string; today: string; timeZone: string }): Promise<Extraction> {
    const external = input.source.counterpartyEmails.filter((email) => email.toLowerCase() !== input.sellerEmail.toLowerCase());
    const corporate = external.filter((email) => emailDomain(email));
    if (corporate.length === 0 && external.every((email) => isFreemail(email))) {
      return emptyExtraction({ isBusiness: false, filterReason: "Calendar event has no external business attendee." });
    }
    const domain = emailDomain(corporate[0] || external[0]);
    const holidays = holidayMap(DEFAULT_TIMING, input.today);
    return emptyExtraction({
      isBusiness: true,
      accountDomain: domain,
      contactEmail: corporate[0] || external[0] || null,
      summary: { account: `${input.today}: Meeting "${input.source.subject}".`, contact: input.source.subject },
      openLoops: [
        {
          direction: "we_owe",
          kind: "intro",
          subject: `Send a follow-up after ${input.source.subject}`,
          detail: "Meeting ended without a follow-up note.",
          dueOn: addBusinessDays(input.today, 1, holidays),
          dueIsStated: false,
          excerpt: input.source.bodyText || input.source.subject,
        },
      ],
      close: { replied: false, fulfilled: false },
    });
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    const raw = heuristicDraft(input);
    const body = stripUnverifiedClaims(raw.body, draftCorpus(input));
    return { ...raw, body: body || raw.body };
  }
}

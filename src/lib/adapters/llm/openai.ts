import { draftCorpus, heuristicDraft, stripUnverifiedClaims } from "@/lib/domain/draft";
import type { DraftInput, DraftOutput } from "@/lib/domain/draft";
import { emptyExtraction, type Extraction, type SourceMaterial } from "@/lib/domain/types";
import { z } from "zod";
import { HeuristicLlm } from "./heuristic";
import type { LlmProvider } from "./types";

const LoopSchema = z.object({
  direction: z.enum(["we_owe", "they_owe"]),
  kind: z.enum(["meeting_request", "proposal", "voicemail", "commitment", "intro", "check_in", "other"]),
  subject: z.string().min(1),
  detail: z.string().default(""),
  dueOn: z.string().nullable().optional(),
  dueIsStated: z.boolean().default(false),
  excerpt: z.string().default(""),
});

const ExtractionSchema = z.object({
  isBusiness: z.boolean(),
  filterReason: z.string().optional(),
  accountName: z.string().nullable().optional(),
  accountDomain: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  proposedRole: z
    .object({
      role: z.enum(["decision_maker", "influencer", "champion", "gatekeeper", "unknown"]),
      confidence: z.number(),
    })
    .nullable()
    .optional(),
  summary: z
    .object({
      account: z.string().optional(),
      contact: z.string().optional(),
    })
    .nullable()
    .optional(),
  openLoops: z.array(LoopSchema).default([]),
  close: z
    .object({
      replied: z.boolean().default(false),
      fulfilled: z.boolean().default(false),
    })
    .optional(),
});

const DraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

const EXTRACT_SYSTEM = `You extract sales follow-ups from a seller's email, calendar, or notes.
Return JSON only.
Rules:
- Ignore personal and non-business mail. Set isBusiness false and filterReason.
- A loop is a promise or a pending reply. direction is "we_owe" if the seller must act, "they_owe" if the contact must reply.
- kind is one of meeting_request, proposal, voicemail, commitment, intro, check_in, other.
- dueOn is YYYY-MM-DD only when a date was stated. Set dueIsStated true only then.
- excerpt must be a short quote from the source, not a paraphrase that adds facts.
- Do not invent companies, numbers, or promises that are not in the source.
- close.replied is true when the contact's message answers an open question. close.fulfilled is true when the promised thing was actually delivered.
- proposedRole is decision_maker, influencer, champion, gatekeeper, or unknown, with confidence from 0 to 1.`;

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiLlm implements LlmProvider {
  readonly name = "openai";
  constructor(private readonly config: OpenAiConfig) {}

  private async complete(system: string, user: string): Promise<string> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned an empty response.");
    return content;
  }

  private async extract(source: SourceMaterial, extra: Record<string, unknown>): Promise<Extraction> {
    const content = await this.complete(EXTRACT_SYSTEM, JSON.stringify({ source, ...extra }));
    const parsed = ExtractionSchema.parse(JSON.parse(content));
    return emptyExtraction({
      isBusiness: parsed.isBusiness,
      filterReason: parsed.filterReason,
      accountName: parsed.accountName,
      accountDomain: parsed.accountDomain,
      contactName: parsed.contactName,
      contactEmail: parsed.contactEmail,
      proposedRole: parsed.proposedRole,
      summary: parsed.summary,
      openLoops: parsed.openLoops.map((loop) => ({
        ...loop,
        dueOn: loop.dueOn ?? null,
      })),
      close: {
        replied: parsed.close?.replied ?? false,
        fulfilled: parsed.close?.fulfilled ?? false,
      },
    });
  }

  async extractMessage(input: {
    source: SourceMaterial;
    sellerEmail: string;
    sellerName: string;
    knownAccountDomains: string[];
    today: string;
    timeZone: string;
  }): Promise<Extraction> {
    return this.extract(input.source, input);
  }

  async extractNote(input: {
    source: SourceMaterial;
    sellerName: string;
    today: string;
    timeZone: string;
  }): Promise<Extraction> {
    return this.extract(input.source, input);
  }

  async extractEvent(input: {
    source: SourceMaterial;
    sellerEmail: string;
    today: string;
    timeZone: string;
  }): Promise<Extraction> {
    return this.extract(input.source, input);
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    const content = await this.complete(
      `Write a short follow-up in the seller's voice. Return JSON {subject, body}.
Use only facts present in the source excerpt, evidence, and names. Do not invent metrics, news, or meetings.
No exclamation marks if the voice notes forbid them. Plain text, not HTML.`,
      JSON.stringify(input),
    );
    const parsed = DraftSchema.parse(JSON.parse(content));
    const body = stripUnverifiedClaims(parsed.body, draftCorpus(input));
    if (!body) return heuristicDraft(input);
    return { subject: parsed.subject, body, channel: input.channel };
  }
}

export function createLlmProvider(input: {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  if (input.provider === "openai") {
    if (!input.apiKey) throw new Error("LLM_API_KEY is required when LLM_PROVIDER=openai.");
    return new OpenAiLlm({
      apiKey: input.apiKey,
      model: input.model || "gpt-4o-mini",
      baseUrl: input.baseUrl || "https://api.openai.com/v1",
      fetchImpl: input.fetchImpl,
    });
  }
  return new HeuristicLlm();
}

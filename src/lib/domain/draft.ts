import type { Direction, LoopKind } from "./types";

export interface DraftInput {
  sellerName: string;
  sellerEmail: string;
  voiceNotes: string;
  contactName: string;
  contactEmail: string;
  accountName: string;
  kind: LoopKind;
  direction: Direction;
  subject: string;
  sourceExcerpt: string;
  evidence: string;
  anchorLabel: string;
  upcomingStage: number;
  channel: "email" | "phone" | "other";
}

export interface DraftOutput {
  subject: string;
  body: string;
  channel: "email" | "phone" | "other";
}

export function signoffName(sellerName: string, voiceNotes: string): string {
  const match = voiceNotes.match(/sign off as ([A-Za-z]+)/i);
  if (match) return match[1];
  return sellerName.split(/\s+/)[0] || sellerName;
}

export function isFormalVoice(voiceNotes: string): boolean {
  return /formal/i.test(voiceNotes);
}

export function stripUnverifiedClaims(body: string, corpus: string): string {
  const allowed = new Set((corpus.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => value.replace(/,/g, "")));
  const lines = body.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    return sentences
      .filter((sentence) => {
        const numbers = sentence.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
        return numbers.every((value) => allowed.has(value.replace(/,/g, "")));
      })
      .join(" ");
  });
  return lines.filter((line) => line.trim().length > 0).join("\n").trim();
}

export function heuristicDraft(input: DraftInput): DraftOutput {
  const contact = input.contactName.split(/\s+/)[0] || input.contactName;
  const sign = signoffName(input.sellerName, input.voiceNotes);
  const formal = isFormalVoice(input.voiceNotes);
  const excerpt = input.sourceExcerpt.trim();
  const hello = formal ? `${contact},` : `${contact} —`;

  if (input.channel !== "email") {
    return {
      channel: input.channel,
      subject: `Call ${input.contactName}`,
      body: [
        `Call ${input.contactName} at ${input.accountName}.`,
        "",
        input.evidence,
        excerpt ? `Refer to: ${excerpt}` : "",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    };
  }

  if (input.direction === "we_owe") {
    return {
      channel: "email",
      subject: input.subject,
      body: [hello, "", excerpt || input.subject, "", sign].join("\n"),
    };
  }

  if (input.upcomingStage >= 4) {
    return {
      channel: "email",
      subject: `Closing the loop on ${input.accountName}`,
      body: [
        hello,
        "",
        `I have not heard back since ${input.anchorLabel}, so I am closing this on my side. If it is still useful, reply and I will reopen it.`,
        excerpt ? "" : "",
        excerpt ? excerpt : "",
        "",
        sign,
      ]
        .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
        .join("\n"),
    };
  }

  if (input.kind === "meeting_request") {
    return {
      channel: "email",
      subject: input.upcomingStage >= 2 ? `Re: times for ${input.accountName}` : `Times for ${input.accountName}`,
      body: [
        hello,
        "",
        input.upcomingStage >= 2
          ? `I wrote on ${input.anchorLabel} and have not heard back.`
          : `I sent times on ${input.anchorLabel} and have not heard back.`,
        excerpt,
        "",
        "If none of those work, send a time that does.",
        "",
        sign,
      ].join("\n"),
    };
  }

  if (input.kind === "proposal") {
    return {
      channel: "email",
      subject: `Re: ${input.subject}`,
      body: [
        hello,
        "",
        `I am following up on the proposal I sent on ${input.anchorLabel}. I have not heard back, and I want to be sure it reached you.`,
        excerpt ? `The note I sent: ${excerpt}` : "",
        "",
        sign,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (input.kind === "voicemail") {
    return {
      channel: "email",
      subject: `Following up on my voicemail`,
      body: [hello, "", `I left a voicemail on ${input.anchorLabel}.`, excerpt, "", sign].filter(Boolean).join("\n"),
    };
  }

  return {
    channel: "email",
    subject: input.subject,
    body: [hello, "", input.evidence, excerpt, "", sign].filter(Boolean).join("\n"),
  };
}

export function draftCorpus(input: DraftInput): string {
  return [input.sourceExcerpt, input.subject, input.evidence, input.contactName, input.accountName, input.sellerName, input.anchorLabel].join(
    "\n",
  );
}

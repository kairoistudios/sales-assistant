import type { MailCalendarAdapter, NormalizedEvent, NormalizedMail, OutboundDraft } from "./types";

const JOHNNY = "johnny@turb0.ai";
const KARIMY = "karimy@turb0.ai";

export function demoMessages(email: string, now: Date): NormalizedMail[] {
  const received = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  if (email === JOHNNY) {
    return [
      {
        externalId: "demo-fieldstone-1",
        threadKey: "thread-fieldstone",
        direction: "inbound",
        fromEmail: "leah.okada@fieldstone.co",
        fromName: "Leah Okada",
        toEmails: [JOHNNY],
        subject: "Working session on procurement",
        bodyText:
          "Johnny — thanks for the intro. I'll send the current-state process map by Friday. Can you send two times next week for a scoping call?",
        receivedAt: received,
      },
      {
        externalId: "demo-personal-dentist",
        threadKey: "thread-personal-dentist",
        direction: "inbound",
        fromEmail: "maya@gmail.com",
        fromName: "Maya",
        toEmails: [JOHNNY],
        subject: "Dentist Thursday",
        bodyText: "Reminder: dentist Thursday at 8. Can you do school pickup after soccer?",
        receivedAt: received,
      },
    ];
  }
  if (email === KARIMY) {
    return [
      {
        externalId: "demo-vesper-reply",
        threadKey: "thread-vesper-proposal",
        direction: "inbound",
        fromEmail: "andre.silva@vesperhealth.com",
        fromName: "Andre Silva",
        toEmails: [KARIMY],
        subject: "Re: Clinical ops proposal",
        bodyText: "Thanks, this works. I received the proposal and Thursday morning is fine to review it.",
        receivedAt: received,
      },
    ];
  }
  return [];
}

export function demoEvents(email: string, now: Date): NormalizedEvent[] {
  if (email !== KARIMY) return [];
  const end = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 45 * 60 * 1000);
  return [
    {
      externalId: "demo-cal-bramble",
      subject: "Coffee with Noah Pell",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      attendeeEmails: [KARIMY, "noah.pell@bramblecivic.org"],
      bodyText: "Intro coffee. Noah is the new CFO at Bramble Civic.",
    },
  ];
}

export class DemoMail implements MailCalendarAdapter {
  readonly provider = "demo" as const;
  constructor(
    private readonly email: string,
    private readonly now: Date,
  ) {}

  async listMessages(): Promise<NormalizedMail[]> {
    return demoMessages(this.email, this.now);
  }

  async listEvents(): Promise<NormalizedEvent[]> {
    return demoEvents(this.email, this.now);
  }

  async sendMail(input: OutboundDraft): Promise<{ providerMessageId: string }> {
    return { providerMessageId: `demo-${Buffer.from(input.to).toString("base64url").slice(0, 12)}-${input.subject.length}` };
  }
}

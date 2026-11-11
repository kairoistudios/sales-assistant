export interface NormalizedMail {
  externalId: string;
  threadKey: string | null;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string;
  toEmails: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
}

export interface NormalizedEvent {
  externalId: string;
  subject: string;
  startAt: string;
  endAt: string;
  attendeeEmails: string[];
  bodyText: string;
}

export interface OutboundDraft {
  to: string;
  subject: string;
  text: string;
}

export interface MailCalendarAdapter {
  readonly provider: "demo" | "microsoft";
  listMessages(): Promise<NormalizedMail[]>;
  listEvents(): Promise<NormalizedEvent[]>;
  sendMail(input: OutboundDraft): Promise<{ providerMessageId: string }>;
}

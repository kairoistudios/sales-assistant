import { htmlToText, plainToHtml } from "@/lib/format";
import type { MailCalendarAdapter, NormalizedEvent, NormalizedMail, OutboundDraft } from "./types";

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isDraft?: boolean;
}

interface GraphEvent {
  id: string;
  subject?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { emailAddress?: { address?: string } }[];
  bodyPreview?: string;
  isCancelled?: boolean;
  organizer?: { emailAddress?: { address?: string } };
}

function graphTime(value?: string): string {
  if (!value) return "";
  if (value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value)) return new Date(value).toISOString();
  return new Date(`${value}Z`).toISOString();
}

function mapMessage(message: GraphMessage, direction: "inbound" | "outbound"): NormalizedMail | null {
  if (message.isDraft) return null;
  const fromEmail = message.from?.emailAddress?.address?.toLowerCase();
  if (!fromEmail) return null;
  const toEmails = [...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]
    .map((recipient) => recipient.emailAddress?.address?.toLowerCase())
    .filter((address): address is string => Boolean(address));
  const html = message.body?.contentType === "html" ? message.body.content ?? "" : "";
  const bodyText = html ? htmlToText(html) : message.body?.content || message.bodyPreview || "";
  return {
    externalId: message.id,
    threadKey: message.conversationId ?? null,
    direction,
    fromEmail,
    fromName: message.from?.emailAddress?.name || fromEmail,
    toEmails,
    subject: message.subject || "(no subject)",
    bodyText,
    receivedAt: message.receivedDateTime || message.sentDateTime || new Date().toISOString(),
  };
}

async function graphGet<T>(url: string, token: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Microsoft Graph ${response.status}: ${detail.slice(0, 280)}`);
  }
  return (await response.json()) as T;
}

export class MicrosoftMail implements MailCalendarAdapter {
  readonly provider = "microsoft" as const;

  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async listFolder(url: string, direction: "inbound" | "outbound"): Promise<NormalizedMail[]> {
    const token = await this.getToken();
    const collected: NormalizedMail[] = [];
    let next: string | null = url;
    for (let page = 0; page < 3 && next; page += 1) {
      const payload: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await graphGet(next, token, this.fetchImpl);
      for (const message of payload.value ?? []) {
        const mapped = mapMessage(message, direction);
        if (mapped) collected.push(mapped);
      }
      next = payload["@odata.nextLink"] ?? null;
    }
    return collected;
  }

  async listMessages(): Promise<NormalizedMail[]> {
    const select = "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft";
    const inbox = await this.listFolder(
      `https://graph.microsoft.com/v1.0/me/messages?$top=40&$orderby=receivedDateTime desc&$select=${select}`,
      "inbound",
    );
    const sent = await this.listFolder(
      `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=20&$orderby=sentDateTime desc&$select=${select}`,
      "outbound",
    );
    return [...inbox, ...sent];
  }

  async listEvents(): Promise<NormalizedEvent[]> {
    const token = await this.getToken();
    const end = new Date();
    const start = new Date(end.getTime() - 10 * 24 * 60 * 60 * 1000);
    const url =
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(start.toISOString())}` +
      `&endDateTime=${encodeURIComponent(end.toISOString())}&$select=id,subject,start,end,attendees,bodyPreview,isCancelled,organizer&$top=40`;
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Microsoft Graph calendar ${response.status}: ${detail.slice(0, 280)}`);
    }
    const payload = (await response.json()) as { value?: GraphEvent[] };
    return (payload.value ?? [])
      .filter((event) => !event.isCancelled && event.end?.dateTime)
      .map((event) => ({
        externalId: event.id,
        subject: event.subject || "(meeting)",
        startAt: graphTime(event.start?.dateTime),
        endAt: graphTime(event.end?.dateTime),
        attendeeEmails: [
          ...(event.organizer?.emailAddress?.address ? [event.organizer.emailAddress.address.toLowerCase()] : []),
          ...(event.attendees ?? [])
            .map((attendee) => attendee.emailAddress?.address?.toLowerCase())
            .filter((address): address is string => Boolean(address)),
        ],
        bodyText: event.bodyPreview || "",
      }));
  }

  async sendMail(input: OutboundDraft): Promise<{ providerMessageId: string }> {
    const token = await this.getToken();
    const response = await this.fetchImpl("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: "HTML", content: plainToHtml(input.text) },
          toRecipients: [{ emailAddress: { address: input.to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!response.ok && response.status !== 202) {
      const detail = await response.text();
      throw new Error(`Outlook did not send the message (${response.status}): ${detail.slice(0, 280)}`);
    }
    return { providerMessageId: response.headers.get("request-id") || `graph-${Date.now()}` };
  }
}

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Calendars.Read",
].join(" ");

export interface MicrosoftToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) return {};
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

export async function microsoftTokenRequest(
  tenantId: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftToken> {
  const response = await fetchImpl(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as MicrosoftToken & { error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Microsoft token request failed.");
  }
  return payload;
}

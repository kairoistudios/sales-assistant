import { getConfig } from "@/lib/config";
import { getUserByEmail, ingestNote, makeRuntime, ready } from "@/lib/services/engine";

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.notesWebhookSecret) {
    return Response.json({ error: "NOTES_WEBHOOK_SECRET is not set." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${config.notesWebhookSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as { email?: string; title?: string; body?: string };
  if (!body.email || !body.body) return Response.json({ error: "email and body are required" }, { status: 400 });
  const db = ready();
  const user = getUserByEmail(db, body.email.toLowerCase());
  if (!user) return Response.json({ error: "Unknown seller" }, { status: 404 });
  const echo = await ingestNote(makeRuntime(db), user.id, body.title || "Note", body.body);
  return Response.json({ ok: true, echo });
}

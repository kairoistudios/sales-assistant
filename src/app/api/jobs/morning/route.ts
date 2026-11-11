import { getConfig } from "@/lib/config";
import { many } from "@/lib/db";
import { ensureBriefing, makeRuntime, ready, type UserRow } from "@/lib/services/engine";

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.jobSecret || request.headers.get("authorization") !== `Bearer ${config.jobSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = ready();
  const runtime = makeRuntime(db);
  const users = many<UserRow>(db, "SELECT * FROM users");
  const delivered: string[] = [];
  for (const user of users) {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: user.timezone }).format(new Date()),
    );
    if (hour < user.briefing_hour) continue;
    await ensureBriefing(runtime, user.id);
    delivered.push(user.email);
  }
  return Response.json({ ok: true, delivered });
}

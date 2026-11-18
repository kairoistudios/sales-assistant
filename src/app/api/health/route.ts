import { one } from "@/lib/db";
import { ready } from "@/lib/services/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const db = ready();
    const row = one<{ ok: number }>(db, "SELECT 1 AS ok");
    if (!row?.ok) throw new Error("Database check failed.");
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    console.error(message);
    return Response.json({ ok: false }, { status: 503 });
  }
}

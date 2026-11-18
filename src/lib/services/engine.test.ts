import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { saveOutlookTokens } from "@/lib/auth/outlook-tokens";
import { decryptToken } from "@/lib/crypto/tokens";
import { getConfig } from "@/lib/config";
import { one, openDatabase } from "@/lib/db";
import { seedDemo } from "@/lib/seed/demo";
import {
  approveItem,
  customerSendSweep,
  dismissItem,
  ensureBriefing,
  getUserByEmail,
  listAccounts,
  listLoops,
  listMessages,
  listOutbound,
  makeRuntime,
  notRelevantItem,
  syncMailbox,
  type Runtime,
} from "./engine";

const now = new Date("2026-11-11T15:00:00.000Z");

function runtime(): Runtime {
  const db = openDatabase(":memory:");
  seedDemo(db, now);
  const config = getConfig();
  config.demoMode = true;
  config.llmProvider = "heuristic";
  config.crmProvider = "local";
  config.crmDryRun = true;
  config.autoSendEnabled = false;
  return makeRuntime(db, now, config);
}

describe("ledger, briefing, and per-seller scope", () => {
  it("builds a capped briefing with evidence and does not email clients", async () => {
    const rt = runtime();
    const johnny = getUserByEmail(rt.db, "johnny@turb0.ai");
    const karimy = getUserByEmail(rt.db, "karimy@turb0.ai");
    if (!johnny || !karimy) throw new Error("demo users missing");

    const johnnys = await ensureBriefing(rt, johnny.id);
    const karimys = await ensureBriefing(rt, karimy.id);

    expect(johnnys.items.filter((item) => item.status === "pending").length).toBeLessThanOrEqual(5);
    expect(johnnys.items.filter((item) => item.status === "pending").length).toBeGreaterThanOrEqual(4);
    expect(johnnys.held.length).toBeGreaterThan(0);
    expect(johnnys.items.some((item) => item.evidence === "You offered times on Nov 3; no reply after 2 business days.")).toBe(
      true,
    );
    expect(johnnys.items.every((item) => item.draft_body.length > 20)).toBe(true);

    const johnnyLoopIds = new Set(listLoops(rt.db, johnny.id).map((loop) => loop.id));
    const karimyLoopIds = new Set(listLoops(rt.db, karimy.id).map((loop) => loop.id));
    expect(johnnys.items.every((item) => johnnyLoopIds.has(item.loop_id))).toBe(true);
    expect(karimys.items.every((item) => karimyLoopIds.has(item.loop_id))).toBe(true);
    expect(karimys.items.some((item) => item.loop_id === "loop_helios_times")).toBe(false);
    expect(johnnyLoopIds.has("loop_vesper")).toBe(false);

    const shared = listAccounts(rt.db, johnny.org_id).map((account) => account.name);
    expect(shared).toContain("Meridian Financial");
    expect(listAccounts(rt.db, karimy.org_id).map((account) => account.name)).toContain("Meridian Financial");

    const outbound = listOutbound(rt.db, johnny.id);
    expect(outbound.filter((row) => row.kind === "customer")).toHaveLength(0);
    expect(outbound.filter((row) => row.kind === "briefing")).toHaveLength(1);
    expect(await customerSendSweep(rt, johnny.id)).toEqual({ sent: 0, reason: "suggest_only" });
  });

  it("approves one message, dismisses, and learns from not relevant", async () => {
    const rt = runtime();
    const johnny = getUserByEmail(rt.db, "johnny@turb0.ai");
    if (!johnny) throw new Error("missing");
    const briefing = await ensureBriefing(rt, johnny.id);
    const pending = briefing.items.filter((item) => item.status === "pending" && item.channel === "email");
    const first = pending[0];
    const message = await approveItem(rt, johnny.id, first.id, `${first.draft_body}\n\nAdded a line.`);
    expect(message).toMatch(/Sent to/);
    expect(listOutbound(rt.db, johnny.id).filter((row) => row.kind === "customer")).toHaveLength(1);

    const karimy = getUserByEmail(rt.db, "karimy@turb0.ai");
    if (!karimy) throw new Error("missing");
    await expect(approveItem(rt, karimy.id, pending[1].id)).rejects.toThrow(/another seller/);

    const dismissed = await dismissItem(rt, johnny.id, pending[1].id);
    expect(dismissed).toMatch(/Dismissed/);
    const hidden = await notRelevantItem(rt, johnny.id, pending[2].id);
    expect(hidden).toMatch(/not relevant/);
    const loop = listLoops(rt.db, johnny.id).find((item) => item.id === pending[2].loop_id);
    expect(loop?.suppressed).toBe(1);
  });

  it("syncs the demo mailbox, filters personal mail, and stops a loop when the contact replies", async () => {
    const rt = runtime();
    const johnny = getUserByEmail(rt.db, "johnny@turb0.ai");
    const karimy = getUserByEmail(rt.db, "karimy@turb0.ai");
    if (!johnny || !karimy) throw new Error("missing");
    await ensureBriefing(rt, johnny.id);
    const summary = await syncMailbox(rt, johnny.id);
    expect(summary).toMatch(/Read/);
    const messages = listMessages(rt.db, johnny.id);
    const dentist = messages.find((message) => message.subject.includes("Dentist"));
    expect(dentist?.is_business).toBe(0);
    expect(listAccounts(rt.db, johnny.org_id).some((account) => account.name === "Fieldstone")).toBe(true);

    await syncMailbox(rt, karimy.id);
    const vesper = listLoops(rt.db, karimy.id).find((loop) => loop.id === "loop_vesper");
    expect(vesper?.status).toBe("closed");
    expect(vesper?.closed_reason).toBe("replied");
  });

  it("refreshes Outlook with the plaintext token and stores the new tokens encrypted", async () => {
    const key = randomBytes(32).toString("base64");
    const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
    const originalFetch = globalThis.fetch;
    process.env.TOKEN_ENCRYPTION_KEY = key;
    const graphHeaders: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        const body = String(init?.body ?? "");
        expect(body).toContain("refresh_token=refresh-PLAINTEXT-sentinel");
        expect(body).not.toContain("enc1");
        return Response.json({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.includes("graph.microsoft.com") && url.endsWith("/me/sendMail")) {
        graphHeaders.push(new Headers(init?.headers).get("authorization") || "");
        return new Response(null, { status: 202, headers: { "request-id": "graph-request" } });
      }
      if (url.includes("graph.microsoft.com")) {
        graphHeaders.push(new Headers(init?.headers).get("authorization") || "");
        return Response.json({ value: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const db = openDatabase(":memory:");
      seedDemo(db, now);
      saveOutlookTokens(db, "user_johnny", {
        accessToken: "expired-access-token",
        refreshToken: "refresh-PLAINTEXT-sentinel",
        expiresAt: "2020-01-01T00:00:00.000Z",
      });
      const config = getConfig();
      config.demoMode = false;
      config.llmProvider = "heuristic";
      config.crmProvider = "local";
      config.crmDryRun = true;
      config.autoSendEnabled = false;
      config.microsoftTenantId = "tenant-id";
      config.microsoftClientId = "client-id";
      config.microsoftClientSecret = "client-secret";
      const rt = makeRuntime(db, now, config);
      const summary = await syncMailbox(rt, "user_johnny");
      expect(summary).toMatch(/Nothing new|Read/);
      expect(graphHeaders.length).toBeGreaterThan(0);
      expect(graphHeaders.every((header) => header === "Bearer new-access-token")).toBe(true);

      const raw = one<{ microsoft_access_token: string; microsoft_refresh_token: string }>(
        db,
        "SELECT microsoft_access_token, microsoft_refresh_token FROM users WHERE id = ?",
        ["user_johnny"],
      );
      expect(raw?.microsoft_access_token.startsWith("enc1:")).toBe(true);
      expect(raw?.microsoft_refresh_token.startsWith("enc1:")).toBe(true);
      expect(raw?.microsoft_access_token).not.toContain("new-access-token");
      expect(raw?.microsoft_refresh_token).not.toContain("new-refresh-token");
      expect(raw?.microsoft_refresh_token).not.toContain("PLAINTEXT");
      expect(decryptToken(raw!.microsoft_access_token)).toBe("new-access-token");
      expect(decryptToken(raw!.microsoft_refresh_token)).toBe("new-refresh-token");
      expect(getUserByEmail(db, "johnny@turb0.ai")?.microsoft_refresh_token).toBe("new-refresh-token");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    }
  });
});

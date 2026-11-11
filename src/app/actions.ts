"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { readSession, signSession } from "@/lib/auth/session";
import { isDirection, isLoopKind } from "@/lib/domain/types";
import {
  ActionError,
  addManualLoop,
  approveItem,
  closeLoop,
  confirmRole,
  dismissItem,
  ensureBriefing,
  getUserByEmail,
  ingestNote,
  makeRuntime,
  notRelevantItem,
  ready,
  restoreLoop,
  runCommand,
  saveSettings,
  snoozeItem,
  syncMailbox,
} from "@/lib/services/engine";

async function runtime() {
  const db = ready();
  return makeRuntime(db);
}

async function userId(): Promise<string> {
  const jar = await cookies();
  const session = readSession(jar.get("sa_session")?.value, getConfig().sessionSecret);
  if (!session) redirect("/");
  return session.uid;
}

function bounce(path: string, notice: string): never {
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

async function guard(path: string, fn: (id: string) => Promise<string>): Promise<void> {
  const id = await userId();
  try {
    const notice = await fn(id);
    bounce(path, notice);
  } catch (error) {
    if (error instanceof ActionError) bounce(path, error.message);
    throw error;
  }
}

export async function signInDemo(formData: FormData) {
  const config = getConfig();
  if (!config.demoMode) bounce("/", "Demo mode is off. Sign in with Microsoft.");
  const email = String(formData.get("email") || "");
  const db = ready();
  const user = getUserByEmail(db, email);
  if (!user) bounce("/", "That demo seller is not in the ledger.");
  const jar = await cookies();
  jar.set("sa_session", signSession(user.id, config.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/briefing");
}

export async function signOut() {
  const jar = await cookies();
  jar.delete("sa_session");
  redirect("/");
}

export async function approveAction(formData: FormData) {
  const body = formData.get("body");
  const itemId = String(formData.get("itemId"));
  await guard("/briefing", async (id) =>
    approveItem(await runtime(), id, itemId, typeof body === "string" ? body : undefined),
  );
}

export async function snoozeAction(formData: FormData) {
  const itemId = String(formData.get("itemId"));
  const until = String(formData.get("until"));
  await guard("/briefing", async (id) => snoozeItem(await runtime(), id, itemId, until));
}

export async function dismissAction(formData: FormData) {
  const itemId = String(formData.get("itemId"));
  await guard("/briefing", async (id) => dismissItem(await runtime(), id, itemId));
}

export async function notRelevantAction(formData: FormData) {
  const itemId = String(formData.get("itemId"));
  await guard("/briefing", async (id) => notRelevantItem(await runtime(), id, itemId));
}

export async function commandAction(formData: FormData) {
  const command = String(formData.get("command") || "");
  await guard("/briefing", async (id) => runCommand(await runtime(), id, command));
}

export async function syncAction() {
  await guard("/mail", async (id) => syncMailbox(await runtime(), id));
}

export async function noteAction(formData: FormData) {
  const title = String(formData.get("title") || "Note");
  const body = String(formData.get("body") || "");
  await guard("/notes", async (id) => ingestNote(await runtime(), id, title, body));
}

export async function closeLoopAction(formData: FormData) {
  const loopId = String(formData.get("loopId"));
  await guard(`/loops/${loopId}`, async (id) => closeLoop(await runtime(), id, loopId));
}

export async function restoreLoopAction(formData: FormData) {
  const loopId = String(formData.get("loopId"));
  await guard(`/loops/${loopId}`, async (id) => restoreLoop(await runtime(), id, loopId));
}

export async function confirmRoleAction(formData: FormData) {
  const accountId = String(formData.get("accountId"));
  const contactId = String(formData.get("contactId"));
  await guard(`/accounts/${accountId}`, async (id) => confirmRole(await runtime(), id, contactId));
}

export async function manualLoopAction(formData: FormData) {
  const direction = String(formData.get("direction"));
  const kind = String(formData.get("kind"));
  await guard("/loops", async (id) => {
    if (!isDirection(direction) || !isLoopKind(kind)) throw new ActionError("Pick a direction and a type.");
    const rt = await runtime();
    const loopId = addManualLoop(rt, id, {
      accountId: String(formData.get("accountId")),
      contactId: String(formData.get("contactId") || "") || undefined,
      direction,
      kind,
      subject: String(formData.get("subject") || ""),
      excerpt: String(formData.get("excerpt") || ""),
      dueOn: String(formData.get("dueOn") || "") || undefined,
    });
    await ensureBriefing(rt, id, { refresh: true });
    bounce(`/loops/${loopId}`, "Loop opened.");
    return "";
  });
}

export async function settingsAction(formData: FormData) {
  const autonomy = String(formData.get("autonomy"));
  await guard("/settings", async (id) => {
    if (autonomy !== "suggest_only" && autonomy !== "auto_log" && autonomy !== "auto_send") {
      throw new ActionError("Unknown autonomy level.");
    }
    return saveSettings(await runtime(), id, {
      timezone: String(formData.get("timezone") || "America/New_York"),
      voiceNotes: String(formData.get("voiceNotes") || ""),
      autonomy,
      briefingHour: Number(formData.get("briefingHour") || 7),
      cap: Number(formData.get("cap") || 5),
      meetingDays: Number(formData.get("meetingDays") || 2),
      proposalMin: Number(formData.get("proposalMin") || 3),
      proposalMax: Number(formData.get("proposalMax") || 5),
      voicemailDays: Number(formData.get("voicemailDays") || 2),
      extraHolidays: String(formData.get("extraHolidays") || ""),
    });
  });
}

export async function rebuildAction() {
  await guard("/briefing", async (id) => {
    await ensureBriefing(await runtime(), id, { refresh: true });
    return "Rebuilt today's list from the ledger.";
  });
}

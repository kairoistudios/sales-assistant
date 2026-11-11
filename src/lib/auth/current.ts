import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { getUser, makeRuntime, ready, type UserRow } from "@/lib/services/engine";
import { readSession } from "./session";

export async function currentUser(): Promise<{ user: UserRow; runtime: ReturnType<typeof makeRuntime> }> {
  const jar = await cookies();
  const session = readSession(jar.get("sa_session")?.value, getConfig().sessionSecret);
  if (!session) redirect("/");
  const db = ready();
  const user = getUser(db, session.uid);
  return { user, runtime: makeRuntime(db) };
}

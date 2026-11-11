import Link from "next/link";
import { notFound } from "next/navigation";
import { closeLoopAction, restoreLoopAction } from "@/app/actions";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/current";
import { buildEvidence } from "@/lib/domain/evidence";
import { civilDate, formatCivil, parseTimingConfig } from "@/lib/domain/timing";
import { one } from "@/lib/db";
import { getUser, listLoops } from "@/lib/services/engine";

export default async function LoopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const { user, runtime } = await currentUser();
  const loop = listLoops(runtime.db, user.id).find((item) => item.id === id);
  if (!loop) notFound();
  const account = loop.account_id
    ? one<{ name: string }>(runtime.db, "SELECT name FROM accounts WHERE id = ?", [loop.account_id])
    : undefined;
  const contact = loop.contact_id
    ? one<{ first_name: string; last_name: string; email: string | null }>(runtime.db, "SELECT * FROM contacts WHERE id = ?", [
        loop.contact_id,
      ])
    : undefined;
  const org = one<{ timing_json: string }>(runtime.db, "SELECT timing_json FROM organizations WHERE id = ?", [user.org_id]);
  const owner = getUser(runtime.db, loop.owner_user_id);
  const evidence = buildEvidence({
    kind: loop.kind,
    direction: loop.direction,
    subject: loop.subject,
    nudgeStage: loop.nudge_stage,
    anchorAt: new Date(loop.source_at),
    dueOn: loop.due_on,
    dueIsStated: loop.due_stated === 1,
    timeZone: user.timezone,
    config: parseTimingConfig(org ? JSON.parse(org.timing_json) : {}),
    now: runtime.now,
  });

  return (
    <div>
      <Notice notice={notice} />
      <Link className="text-sm text-muted-foreground underline" href="/loops">
        All loops
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="serif text-4xl">{loop.subject}</h1>
        <Badge>{loop.direction === "we_owe" ? "You owe" : "They owe"}</Badge>
        <Badge>{loop.status}</Badge>
      </div>
      <p className="mt-2 text-muted-foreground">
        {account?.name}
        {contact ? ` · ${contact.first_name} ${contact.last_name}` : ""}
        {contact?.email ? ` · ${contact.email}` : ""}
      </p>
      <p className="mt-4 border-l-2 border-clay pl-3">{evidence}</p>
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Source</dt>
          <dd>{formatCivil(civilDate(new Date(loop.source_at), user.timezone))}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Next nudge</dt>
          <dd>{loop.next_action_at ? formatCivil(loop.next_action_at.slice(0, 10)) : "Not scheduled"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nudge stage</dt>
          <dd>{loop.nudge_stage} of 4 · {loop.next_channel ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Owner</dt>
          <dd>{owner.name}</dd>
        </div>
      </dl>
      <blockquote className="draft mt-6 whitespace-pre-wrap rounded-md p-4 text-sm">{loop.source_excerpt}</blockquote>
      <div className="mt-6 flex gap-2">
        {loop.status === "open" && loop.suppressed === 0 && (
          <form action={closeLoopAction}>
            <input type="hidden" name="loopId" value={loop.id} />
            <Button type="submit" variant="outline">
              Close loop
            </Button>
          </form>
        )}
        {(loop.suppressed === 1 || loop.status === "closed") && (
          <form action={restoreLoopAction}>
            <input type="hidden" name="loopId" value={loop.id} />
            <Button type="submit" variant="secondary">
              Put it back
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

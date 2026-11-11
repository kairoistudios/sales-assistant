import {
  approveAction,
  commandAction,
  dismissAction,
  notRelevantAction,
  rebuildAction,
  snoozeAction,
} from "@/app/actions";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currentUser } from "@/lib/auth/current";
import { addBusinessDays, holidayMap, parseTimingConfig } from "@/lib/domain/timing";
import { ensureBriefing, type BriefingItemView } from "@/lib/services/engine";
import { one } from "@/lib/db";

function money(cents: number | null): string {
  if (!cents) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default async function BriefingPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { user, runtime } = await currentUser();
  const briefing = await ensureBriefing(runtime, user.id);
  const org = one<{ timing_json: string }>(runtime.db, "SELECT timing_json FROM organizations WHERE id = ?", [user.org_id]);
  const timing = parseTimingConfig(org ? JSON.parse(org.timing_json) : {});
  const holidays = holidayMap(timing, briefing.date);
  const tomorrow = addBusinessDays(briefing.date, 1, holidays);
  const inThree = addBusinessDays(briefing.date, 3, holidays);
  const nextWeek = addBusinessDays(briefing.date, 5, holidays);
  const pending = briefing.items.filter((item) => item.status === "pending");
  const handled = briefing.items.filter((item) => item.status !== "pending");
  const first = user.name.split(" ")[0];

  return (
    <div>
      <Notice notice={notice} />
      <p className="text-xs uppercase tracking-[0.16em] text-clay">{briefing.dateLabel}</p>
      <h1 className="serif mt-2 text-4xl md:text-5xl">Good morning, {first}.</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        {pending.length === 0
          ? "Nothing is due. The ledger is quiet."
          : `${pending.length} ${pending.length === 1 ? "thing" : "things"} worth doing. The list is capped at ${briefing.cap}.`}
        {briefing.holiday ? ` ${briefing.holiday}. New nudges move to the next business day. Anything already due stays here.` : ""}
      </p>
      {briefing.deliveredAt && (
        <p className="mt-3 text-sm text-muted-foreground">
          Briefing email delivered to {user.email}.{" "}
          <a className="underline" href="/briefing/email">
            Read it
          </a>
          .
        </p>
      )}

      <form action={commandAction} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Input name="command" placeholder="approve 1 and 3, snooze 2 until Friday" aria-label="Plain-language command" />
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      <div className="mt-8 space-y-5">
        {pending.map((item, index) => (
          <ItemCard
            key={item.id}
            item={{ ...item, rank: index + 1 }}
            tomorrow={tomorrow}
            inThree={inThree}
            nextWeek={nextWeek}
          />
        ))}
      </div>

      {briefing.held.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Held, so the list stays short</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {briefing.held.map((item) => (
              <li key={item.loopId} className="rounded-md border border-dashed border-border px-3 py-2">
                <span className="font-medium">{item.accountName}</span>
                <span className="text-muted-foreground"> · {item.subject}</span>
                <p className="text-muted-foreground">{item.evidence}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {handled.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Handled today</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {handled.map((item) => (
              <li key={item.id}>
                {item.account_name}: {item.subject} · {item.status.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={rebuildAction} className="mt-8">
        <Button type="submit" variant="ghost">
          Rebuild today’s list
        </Button>
      </form>
    </div>
  );
}

function ItemCard({
  item,
  tomorrow,
  inThree,
  nextWeek,
}: {
  item: BriefingItemView;
  tomorrow: string;
  inThree: string;
  nextWeek: string;
}) {
  const sendLabel = item.channel === "email" ? "Approve and send" : "Log the call";
  return (
    <article id={`item-${item.id}`} className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <span className="serif text-3xl text-[#c4b49a]">{String(item.rank).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="serif text-2xl">{item.account_name ?? "Unassigned"}</h2>
            {item.motion && <Badge>{item.motion}</Badge>}
            <Badge>{item.direction === "we_owe" ? "You owe" : "They owe"}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.contact_name}
            {item.opp_name ? ` · ${item.opp_name}` : ""}
            {item.value_cents ? ` · ${money(item.value_cents)}` : ""}
          </p>
          <p className="mt-3 border-l-2 border-clay pl-3 text-sm">{item.evidence}</p>
          <div className="draft mt-4 rounded-md p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {item.channel === "email" ? `Draft to ${item.draft_to}` : "Call note"}
            </p>
            <p className="mt-1 text-sm font-medium">{item.draft_subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{item.draft_body}</p>
          </div>
          <details className="mt-3 text-sm text-muted-foreground">
            <summary className="cursor-pointer">Source</summary>
            <p className="mt-2 whitespace-pre-wrap">{item.source_excerpt}</p>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={approveAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <Button type="submit">{sendLabel}</Button>
            </form>
            <form action={dismissAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <Button type="submit" variant="outline">
                Dismiss
              </Button>
            </form>
            <form action={notRelevantAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <Button type="submit" variant="ghost">
                Not relevant
              </Button>
            </form>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">Edit before sending</summary>
            <form action={approveAction} className="mt-3 space-y-2">
              <input type="hidden" name="itemId" value={item.id} />
              <Textarea name="body" defaultValue={item.draft_body} />
              <Button type="submit" variant="secondary">
                Send edited
              </Button>
            </form>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Snooze</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ["Tomorrow", tomorrow],
                ["In 3 business days", inThree],
                ["Next week", nextWeek],
              ].map(([label, until]) => (
                <form key={label} action={snoozeAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="until" value={until} />
                  <Button type="submit" size="sm" variant="outline">
                    {label}
                  </Button>
                </form>
              ))}
              <form action={snoozeAction} className="flex gap-2">
                <input type="hidden" name="itemId" value={item.id} />
                <Input name="until" type="date" className="h-8 w-40" required />
                <Button type="submit" size="sm" variant="outline">
                  Date
                </Button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

import Link from "next/link";
import { manualLoopAction } from "@/app/actions";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUser } from "@/lib/auth/current";
import { formatCivil } from "@/lib/domain/timing";
import { LOOP_KINDS } from "@/lib/domain/types";
import { listAccounts, listContacts, listLoops } from "@/lib/services/engine";

export default async function LoopsPage({ searchParams }: { searchParams: Promise<{ notice?: string; view?: string }> }) {
  const { notice, view } = await searchParams;
  const { user, runtime } = await currentUser();
  const loops = listLoops(runtime.db, user.id).filter((loop) => {
    if (view === "closed") return loop.status === "closed";
    if (view === "we") return loop.direction === "we_owe" && loop.status === "open";
    if (view === "they") return loop.direction === "they_owe" && loop.status === "open";
    return loop.status === "open";
  });
  const accounts = listAccounts(runtime.db, user.org_id);
  const contacts = listContacts(runtime.db, user.org_id);
  const names = new Map(accounts.map((account) => [account.id, account.name]));

  return (
    <div>
      <Notice notice={notice} />
      <h1 className="serif text-4xl">Open loops</h1>
      <p className="mt-2 text-muted-foreground">Who owes what. Yours only — Karimy’s loops stay on her ledger.</p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {[
          ["/loops", "Open"],
          ["/loops?view=we", "You owe"],
          ["/loops?view=they", "They owe"],
          ["/loops?view=closed", "Closed"],
        ].map(([href, label]) => (
          <Link key={href} className="rounded-full border border-border px-3 py-1" href={href}>
            {label}
          </Link>
        ))}
      </div>
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
        {loops.length === 0 && <li className="p-5 text-sm text-muted-foreground">No loops in this view.</li>}
        {loops.map((loop) => (
          <li key={loop.id}>
            <Link className="block px-4 py-3 hover:bg-accent" href={`/loops/${loop.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{loop.subject}</span>
                <Badge>{loop.direction === "we_owe" ? "You owe" : "They owe"}</Badge>
                {loop.suppressed === 1 && <Badge>Hidden</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {loop.account_id ? names.get(loop.account_id) : "No account"}
                {loop.due_on ? ` · due ${formatCivil(loop.due_on)}` : ""}
                {loop.next_action_at ? ` · next ${formatCivil(loop.next_action_at.slice(0, 10))}` : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <form action={manualLoopAction} className="mt-8 space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="serif text-2xl">Add a loop</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <Label>Account</Label>
            <select className="h-10 w-full rounded-md border border-input bg-card px-3" name="accountId" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <Label>Contact</Label>
            <select className="h-10 w-full rounded-md border border-input bg-card px-3" name="contactId">
              <option value="">None</option>
              {contacts
                .filter((contact) => contact.kind === "client")
                .map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.first_name} {contact.last_name}
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <Label>Who owes</Label>
            <select className="h-10 w-full rounded-md border border-input bg-card px-3" name="direction">
              <option value="we_owe">You owe</option>
              <option value="they_owe">They owe</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <Label>Type</Label>
            <select className="h-10 w-full rounded-md border border-input bg-card px-3" name="kind">
              {LOOP_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Input name="subject" placeholder="Send the case study" required />
        <Input name="excerpt" placeholder="What was said" required />
        <Input name="dueOn" type="date" />
        <Button type="submit">Open loop</Button>
      </form>
    </div>
  );
}

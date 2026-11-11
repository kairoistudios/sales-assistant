import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmRoleAction } from "@/app/actions";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/current";
import { getAccount, listContacts, listLoops, listOpportunities, listUsers } from "@/lib/services/engine";

function money(cents: number | null): string {
  if (!cents) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const { user, runtime } = await currentUser();
  const account = getAccount(runtime.db, id);
  if (!account || account.org_id !== user.org_id) notFound();
  const contacts = listContacts(runtime.db, user.org_id).filter((contact) => contact.account_id === account.id);
  const opportunities = listOpportunities(runtime.db, user.org_id).filter((opp) => opp.account_id === account.id);
  const sellers = new Map(listUsers(runtime.db, user.org_id).map((seller) => [seller.id, seller.name]));
  const myLoops = listLoops(runtime.db, user.id).filter((loop) => loop.account_id === account.id && loop.status === "open");
  const otherOwners = [...new Set(opportunities.map((opp) => opp.owner_user_id).filter((owner) => owner !== user.id))];

  return (
    <div>
      <Notice notice={notice} />
      <Link className="text-sm text-muted-foreground underline" href="/accounts">
        All accounts
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="serif text-4xl">{account.name}</h1>
        {account.motion && <Badge>{account.motion}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {account.industry}
        {account.domain ? ` · ${account.domain}` : ""}
      </p>
      <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{account.summary || "No running summary yet."}</p>
      {otherOwners.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Also on this account: {otherOwners.map((owner) => sellers.get(owner)).join(", ")}. Their loops are not shown here.
        </p>
      )}

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">Contacts</h2>
      <ul className="mt-3 space-y-3">
        {contacts.map((contact) => (
          <li key={contact.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {contact.first_name} {contact.last_name}
              </span>
              <Badge>{contact.role.replaceAll("_", " ")}</Badge>
              {contact.role_confirmed === 1 ? <Badge>Confirmed</Badge> : <Badge>Proposed</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {contact.title} · {contact.email}
              {contact.role_confidence != null ? ` · confidence ${Math.round(contact.role_confidence * 100)}%` : ""}
            </p>
            {contact.summary && <p className="mt-2 text-sm">{contact.summary}</p>}
            {contact.role_confirmed === 0 && contact.role !== "unknown" && (
              <form action={confirmRoleAction} className="mt-3">
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="accountId" value={account.id} />
                <Button size="sm" type="submit" variant="outline">
                  Confirm role
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">Opportunities</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {opportunities.map((opp) => (
          <li key={opp.id} className="rounded-md border border-border px-3 py-2">
            <span className="font-medium">{opp.name}</span>
            <span className="text-muted-foreground">
              {" "}
              · {opp.stage.replaceAll("_", " ")} · {money(opp.value_cents)} · {opp.motion} · {opp.origination_path.replaceAll("_", " ")} ·{" "}
              {sellers.get(opp.owner_user_id)}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">Your open loops</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {myLoops.length === 0 && <li className="text-muted-foreground">None on your ledger.</li>}
        {myLoops.map((loop) => (
          <li key={loop.id}>
            <Link className="underline" href={`/loops/${loop.id}`}>
              {loop.subject}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

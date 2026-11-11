import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { currentUser } from "@/lib/auth/current";
import { listAccounts, listContacts } from "@/lib/services/engine";

export default async function AccountsPage() {
  const { user, runtime } = await currentUser();
  const accounts = listAccounts(runtime.db, user.org_id);
  const contacts = listContacts(runtime.db, user.org_id);
  return (
    <div>
      <h1 className="serif text-4xl">Accounts</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Shared across Turb0. Loops, drafts, and briefings stay with the seller who owns them.
      </p>
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
        {accounts.map((account) => {
          const people = contacts.filter((contact) => contact.account_id === account.id);
          return (
            <li key={account.id}>
              <Link className="block px-4 py-3 hover:bg-accent" href={`/accounts/${account.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{account.name}</span>
                  {account.motion && <Badge>{account.motion}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {account.industry} · {people.length} {people.length === 1 ? "contact" : "contacts"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

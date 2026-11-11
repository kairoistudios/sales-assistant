import { currentUser } from "@/lib/auth/current";
import { listAudit, listOutbound } from "@/lib/services/engine";

export default async function AuditPage() {
  const { user, runtime } = await currentUser();
  const entries = listAudit(runtime.db, user.org_id, user.id);
  const sent = listOutbound(runtime.db, user.id).filter((row) => row.kind === "customer");
  return (
    <div>
      <h1 className="serif text-4xl">Audit</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Every outbound message and every record change for your book. Other sellers’ messages are not listed.
      </p>
      <h2 className="mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">Sent to clients</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {sent.length === 0 && <li className="text-muted-foreground">Nothing has been sent. Suggest only is the default.</li>}
        {sent.map((row) => (
          <li key={row.id} className="rounded-md border border-border bg-card px-3 py-2">
            <span className="font-medium">{row.subject}</span>
            <span className="text-muted-foreground"> · {row.to_email}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">Record</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="border-b border-border py-2">
            <span className="text-muted-foreground">{entry.created_at.slice(0, 16).replace("T", " ")}</span> {entry.summary}
          </li>
        ))}
      </ul>
    </div>
  );
}

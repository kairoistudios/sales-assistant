import Link from "next/link";
import { currentUser } from "@/lib/auth/current";
import { listOutbound } from "@/lib/services/engine";

export default async function BriefingEmailPage() {
  const { user, runtime } = await currentUser();
  const email = listOutbound(runtime.db, user.id).find((row) => row.kind === "briefing");
  return (
    <div>
      <Link className="text-sm text-muted-foreground underline" href="/briefing">
        Back to the list
      </Link>
      <h1 className="serif mt-3 text-4xl">This morning’s email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {email ? `To ${email.to_email}` : "No briefing email has been delivered yet."} In demo mode this stays in Ledger.
        With Outlook connected, the same message is sent through Microsoft Graph.
      </p>
      {email && <pre className="draft mt-6 whitespace-pre-wrap rounded-lg p-5 text-sm leading-relaxed">{email.body}</pre>}
    </div>
  );
}

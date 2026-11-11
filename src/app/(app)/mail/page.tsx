import { syncAction } from "@/app/actions";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/current";
import { getConfig, microsoftConfigured } from "@/lib/config";
import { listMessages } from "@/lib/services/engine";

export default async function MailPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { user, runtime } = await currentUser();
  const messages = listMessages(runtime.db, user.id);
  const config = getConfig();
  const connected = Boolean(user.microsoft_refresh_token);
  return (
    <div>
      <Notice notice={notice} />
      <h1 className="serif text-4xl">Mail and calendar</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        {connected
          ? "Outlook is connected. Sync reads your mailbox and calendar through Microsoft Graph."
          : "Demo mailbox. Personal mail is filtered. Business mail opens and closes loops."}{" "}
        {microsoftConfigured(config) && !connected && (
          <a className="underline" href="/api/auth/microsoft/start">
            Connect Outlook
          </a>
        )}
      </p>
      <form action={syncAction} className="mt-4">
        <Button type="submit">Sync now</Button>
      </form>
      <ul className="mt-6 space-y-3">
        {messages.map((message) => (
          <li key={message.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{message.subject}</span>
              <Badge>{message.is_business ? "Business" : "Filtered"}</Badge>
              <Badge>{message.direction}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {message.from_name} · {message.from_email}
            </p>
            {message.filter_reason && <p className="mt-1 text-sm">{message.filter_reason}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

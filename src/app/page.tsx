import { signInDemo } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { getConfig, microsoftConfigured } from "@/lib/config";
import { ready, listUsers } from "@/lib/services/engine";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const config = getConfig();
  const db = ready();
  const sellers = config.demoMode ? listUsers(db, "org_turb0") : [];
  const microsoft = microsoftConfigured(config);

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-5 py-12 md:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-clay">Turb0 · Ledger</p>
        <h1 className="serif mt-3 text-5xl leading-tight md:text-6xl">The morning list, already drafted.</h1>
        <p className="mt-5 max-w-md text-lg text-muted-foreground">
          Ledger keeps every promise in a seller’s book: who owes what, when to nudge, and the note to send. Nothing goes
          to a client until you approve it.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {params.notice && <p className="mb-4 text-sm">{params.notice}</p>}
        {params.error === "microsoft" && (
          <p className="mb-4 text-sm text-destructive">Microsoft sign-in needs a tenant id, client id, and client secret.</p>
        )}
        {params.error === "domain" && (
          <p className="mb-4 text-sm text-destructive">That Microsoft account is outside {config.orgDomain}.</p>
        )}
        {params.error === "tenant" && (
          <p className="mb-4 text-sm text-destructive">That sign-in did not come from the configured Entra tenant.</p>
        )}
        {config.demoMode && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Demo mode. Two sellers, one firm, separate loops.</p>
            {sellers.map((seller) => (
              <form key={seller.id} action={signInDemo}>
                <input type="hidden" name="email" value={seller.email} />
                <Button className="h-auto w-full justify-start px-4 py-3" type="submit" variant="outline">
                  <span>
                    <span className="block text-left font-medium">{seller.name}</span>
                    <span className="block text-left text-xs text-muted-foreground">{seller.email}</span>
                  </span>
                </Button>
              </form>
            ))}
          </div>
        )}
        <div className={config.demoMode ? "mt-5 border-t border-border pt-5" : ""}>
          {microsoft ? (
            <Button asChild className="w-full">
              <a href="/api/auth/microsoft/start">Sign in with Microsoft</a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Outlook sign-in is waiting on an Entra app registration. The demo book is ready without it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

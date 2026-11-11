import { settingsAction } from "@/app/actions";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currentUser } from "@/lib/auth/current";
import { getConfig, microsoftConfigured } from "@/lib/config";
import { parseTimingConfig } from "@/lib/domain/timing";
import { one } from "@/lib/db";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { user, runtime } = await currentUser();
  const org = one<{ timing_json: string; briefing_cap: number }>(
    runtime.db,
    "SELECT timing_json, briefing_cap FROM organizations WHERE id = ?",
    [user.org_id],
  );
  const timing = parseTimingConfig(org ? JSON.parse(org.timing_json) : {});
  const config = getConfig();
  const meeting = timing.kinds.meeting_request.stages.find((stage) => stage.stage === 1)?.offsetBusinessDays ?? 2;
  const voicemail = timing.kinds.voicemail.stages.find((stage) => stage.stage === 1)?.offsetBusinessDays ?? 2;
  const proposal = timing.kinds.proposal.windowBusinessDays ?? { min: 3, max: 5 };

  return (
    <div>
      <Notice notice={notice} />
      <h1 className="serif text-4xl">Settings</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Timing defaults are shared by the firm. Voice, hours, and autonomy belong to you. Suggest only is the launch posture:
        nothing is sent without an approval.
      </p>
      <form action={settingsAction} className="mt-6 space-y-4">
        <label className="block space-y-1">
          <Label>Time zone</Label>
          <Input name="timezone" defaultValue={user.timezone} />
        </label>
        <label className="block space-y-1">
          <Label>Voice notes</Label>
          <Textarea name="voiceNotes" defaultValue={user.voice_notes} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <Label>Autonomy</Label>
            <select className="h-10 w-full rounded-md border border-input bg-card px-3" name="autonomy" defaultValue={user.autonomy}>
              <option value="suggest_only">Suggest only</option>
              <option value="auto_log">Auto-log CRM updates</option>
              <option value="auto_send">Auto-send (locked unless enabled)</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <Label>Briefing hour</Label>
            <Input name="briefingHour" type="number" min={5} max={11} defaultValue={user.briefing_hour} />
          </label>
          <label className="space-y-1 text-sm">
            <Label>Daily cap</Label>
            <Input name="cap" type="number" min={1} max={12} defaultValue={org?.briefing_cap ?? 5} />
          </label>
          <label className="space-y-1 text-sm">
            <Label>Meeting request, business days</Label>
            <Input name="meetingDays" type="number" min={1} max={15} defaultValue={meeting} />
          </label>
          <label className="space-y-1 text-sm">
            <Label>Proposal window, from</Label>
            <Input name="proposalMin" type="number" min={1} max={20} defaultValue={proposal.min} />
          </label>
          <label className="space-y-1 text-sm">
            <Label>Proposal window, to</Label>
            <Input name="proposalMax" type="number" min={1} max={30} defaultValue={proposal.max} />
          </label>
          <label className="space-y-1 text-sm">
            <Label>Voicemail, business days</Label>
            <Input name="voicemailDays" type="number" min={1} max={15} defaultValue={voicemail} />
          </label>
        </div>
        <label className="block space-y-1">
          <Label>Extra holidays (YYYY-MM-DD, comma separated)</Label>
          <Input name="extraHolidays" defaultValue={timing.extraHolidays.join(", ")} placeholder="2026-12-24" />
        </label>
        <Button type="submit">Save</Button>
      </form>

      <section className="mt-10 space-y-3 text-sm">
        <h2 className="serif text-2xl">Outlook</h2>
        <p className="text-muted-foreground">
          {user.microsoft_refresh_token
            ? "This seller’s mailbox is connected."
            : microsoftConfigured(config)
              ? "The Entra app is configured."
              : "Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, and MICROSOFT_CLIENT_SECRET. The tenant should be Turb0’s single-tenant directory."}
        </p>
        {microsoftConfigured(config) && (
          <a className="underline" href="/api/auth/microsoft/start">
            {user.microsoft_refresh_token ? "Reconnect Outlook" : "Connect Outlook"}
          </a>
        )}
        <h2 className="serif pt-4 text-2xl">Turb0 Partners</h2>
        <p className="text-muted-foreground">
          CRM mode is {user.crm_provider}. Writes are {config.crmDryRun ? "dry-run" : "live"}. Live writes use the seller’s Supabase
          token when TURB0_AUTH_MODE=user_jwt, so row level security still applies. This screen does not call production.
        </p>
      </section>
    </div>
  );
}

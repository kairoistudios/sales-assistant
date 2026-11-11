# Ledger

Phase 1 of the Sales Assistant: the open-loop ledger, follow-up timing, and a daily briefing for Turb0 sellers.

A seller signs in, sees a short ranked list of what is due, and approves, edits, snoozes, dismisses, or marks an item not relevant. Nothing is sent to a client without that approval. Johnny Ramondino and Karimy each have their own loops, drafts, and briefing. Accounts and contacts are shared inside the firm.

## Run it

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). Demo mode is on by default. Choose Johnny or Karimy. No API keys are required.

`npm run db:reset` deletes the local database. The next start reseeds the demo book relative to that day.

## What you can do in the demo

- Read today’s briefing. Each item has a draft and an evidence line, for example “You offered times on Nov 3; no reply after 2 business days.”
- Approve and send, edit, snooze, dismiss, or mark not relevant. Sent mail lands in the audit log. In demo mode it is not delivered to a real inbox.
- Type `approve 1 and 3, snooze 2 until Friday` on the briefing.
- Switch sellers. The account list is the same. The loops are not.
- Sync the demo mailbox. Personal mail is filtered. A new business thread opens loops. Karimy’s sync includes a reply that closes her Vesper proposal.
- Paste a meeting note. The page echoes what was filed.
- Change the timing defaults. Open loops are rescheduled on US business days, skipping weekends and federal holidays.

## Environment

Copy `.env.example` to `.env`. Demo mode ignores blank Microsoft and CRM values.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public origin. Used for the Outlook redirect. |
| `SESSION_SECRET` | Signs the session cookie. |
| `DATABASE_PATH` | SQLite file. Default `./data/sales-assistant.db`. |
| `DEMO_MODE` | `true` seeds two sellers and a demo mailbox. Turn off before any shared deployment. |
| `ORG_DOMAIN` | Only these Microsoft accounts may sign in. Default `turb0.ai`. |
| `LLM_PROVIDER` | `heuristic` (offline) or `openai`. |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | OpenAI-compatible chat completions. Extraction and drafts ask for JSON. Drafts drop sentences whose numbers are not in the source. |
| `MICROSOFT_TENANT_ID` | Entra tenant id for the single-tenant app. Not `common`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Confidential client. |
| `MICROSOFT_REDIRECT_URI` | Must match the app registration. Default `http://127.0.0.1:43123/api/auth/microsoft/callback`. |
| `CRM_PROVIDER` | `local` or `turb0`. |
| `CRM_DRY_RUN` | Default `true`. No HTTP call is made to Turb0 Partners. |
| `TURB0_SUPABASE_URL` | `https://itrmlygedcaqjulipxbs.supabase.co` |
| `TURB0_SUPABASE_ANON_KEY` | Supabase anon key. Required for user-token writes. |
| `TURB0_AUTH_MODE` | `user_jwt` (preferred) or `service_role`. |
| `TURB0_SERVICE_ROLE_KEY` | Bypasses row level security. Do not use against production from a laptop. |
| `NOTES_WEBHOOK_SECRET` | `POST /api/notes/webhook` with `Authorization: Bearer …` and `{ "email", "title", "body" }`. |
| `JOB_SECRET` | `POST /api/jobs/morning` delivers briefings once the seller’s local hour has reached their briefing hour. |
| `AUTO_SEND_ENABLED` | Leave `false`. Auto-send is not active in this phase. |

### Entra app registration

1. Entra admin center → App registrations → New registration.
2. Supported account types: **Accounts in this organizational directory only** (the turb0.ai tenant).
3. Redirect URI, Web: `http://127.0.0.1:43123/api/auth/microsoft/callback` plus the production origin when you have one.
4. Certificates & secrets → new client secret.
5. API permissions → Microsoft Graph, delegated: `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.Read`, `offline_access`. Grant admin consent.
6. Copy the Application (client) id and the Directory (tenant) id into `MICROSOFT_CLIENT_ID` and `MICROSOFT_TENANT_ID`.

Sign-in uses the tenant-specific authorize and token endpoints. The callback checks the id token’s `tid` and that the mailbox is `@turb0.ai`. Each seller’s refresh token is stored on their user row. Graph calls are only made after that connection exists.

The morning briefing is sent with `POST /me/sendMail` to the seller’s own address. Client follow-ups use the same call, and only after Approve.

### Turb0 Partners

The adapter talks to PostgREST:

- accounts → `clients` (`name`, `website`, `is_prospect`, optional `partner_id`)
- client contacts → `client_contacts` (`client_id`, `first_name`, `last_name`, `email`, `phone`, `title`)
- referrers → `partner_contacts` (`partner_id`, `first_name`, `last_name`, `email`, `phone`, `position`)
- opportunities → `opportunities` (`name`, `description`, `stage`, `contract_value_usd`, `contract_type`, `close_date`, `client_id`, `client_name`, `client_website`, `partner_id`, `created_by`)
- loop updates → `opportunity_notes` (`opportunity_id`, `body`, `created_by`)

`user_jwt` sends `apikey: <anon key>` and `Authorization: Bearer <seller access token>`. `service_role` sends the service key as both. Updates that match zero rows are treated as an RLS refusal.

This repo does not call production. Tests use `http://crm.test` and a mock `fetch`. `CRM_DRY_RUN=true` returns the request it would have sent and does not call `fetch`.

Linking a seller’s Partners login (password grant against `/auth/v1/token`) is intentionally not wired to a button. When you are ready, store that user’s Supabase access token and user id (`crm_access_token`, `crm_user_id`) and set `crm_provider` to `turb0` with dry-run off. `created_by` must be that user’s id or RLS will reject the insert.

## Tests

```bash
npm test
```

Covers business-day and holiday math (including Veterans Day and the observed Independence Day), time zones, the proposal 3–5 window, escalation through a channel change and a closing note, stopping on reply or close, ranking and the daily cap, not-relevant feedback, personal-mail filtering, commitment capture, per-seller scope, approve-does-not-send-without-approval, and the Turb0 payload shapes.

## Layout

- `src/lib/domain` — timing, evidence, ranking, ingestion plan, drafts, autonomy. No database.
- `src/lib/services/engine.ts` — applies those plans, builds the briefing, and runs one-step actions.
- `src/lib/adapters/mail` — `MailCalendarAdapter`. Demo fixtures, and Microsoft Graph.
- `src/lib/adapters/crm` — `CrmAdapter`. Local no-CRM mode, and Turb0 Partners.
- `src/lib/adapters/llm` — `LlmProvider`. Heuristic by default, OpenAI-compatible when configured.
- `src/lib/db/schema.ts` — SQLite. Includes `contracts` and `org_relationships` so later phases extend the model instead of replacing it.

Suggest only is the default. Approving an item is the explicit approval that allows one send. Generating the briefing emails the seller a copy of the list; that message does not go to a client. A sweep that would auto-send client mail returns `suggest_only` unless `AUTO_SEND_ENABLED` is set, and even then Phase 1 does not send unapproved client mail.

## Not in this phase

Chat delivery, text and voicemail intake, origination playbooks, research tiers, contract ingestion, org-map inference, and leader analytics. The schema and the adapter interfaces leave room for them. Google mail is not implemented; a second `MailCalendarAdapter` can sit next to Microsoft without changing the ledger.

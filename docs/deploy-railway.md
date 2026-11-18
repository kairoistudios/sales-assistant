# Deploy Ledger on Railway

This is the hosted setup for Johnny and Karimy. One website, one database file, Outlook connected for each of them. Nothing in this guide turns on automatic client email or live CRM writes.

## Why Railway

Ledger keeps its data in a single SQLite file. That fits a host where one copy of the app stays running and the file sits on a disk that survives deploys.

Railway does that with a volume attached to one service. The app listens on the port Railway assigns, and Railway’s health check calls `/api/health`.

Render’s free web services wipe the disk on every deploy, so the sellers’ Outlook connections would disappear. Render’s persistent disk is a paid add-on tied to one instance and it turns off rolling deploys. For two people and one database file, a Railway service plus a volume is the smaller setup.

SQLite is the right database here. Do not run more than one copy of the app. Two servers writing the same file will corrupt it. If you later need more than one server, move the database to Postgres before you add a second copy.

## What you need before you start

- A Railway account that can deploy from this GitHub repository.
- The three Microsoft values from [entra-app-registration.md](entra-app-registration.md): tenant id, client id, and client secret. You can deploy the site first and add Microsoft after the public address exists. You need that address to register the production redirect URI.
- Three different random secrets. On a Mac, open Terminal and run this once per secret. Copy each result into a password manager. Do not reuse one value for all three, and do not put them in git, Slack, or a GitHub issue.

```bash
openssl rand -base64 32
```

| Secret | Env var | Rule |
| --- | --- | --- |
| First random string | `SESSION_SECRET` | Signs the login cookie. |
| Second random string | `TOKEN_ENCRYPTION_KEY` | Must be this 32-byte value. It encrypts Outlook tokens in the database. Keep it forever. If you replace it, Johnny and Karimy have to connect Outlook again. |
| Third random string | `JOB_SECRET` | Password for the morning-briefing call. |

## Create the service

1. Go to [railway.com](https://railway.com) and sign in.
2. Choose **New Project**, then **Deploy from GitHub repo**, and select this repository.
3. Railway reads `railway.toml`. It installs dependencies with Node.js 22 (the version this repo requires), runs `npm run build`, then `npm start`. The start command listens on Railway’s `PORT`. You do not type a port or install Node yourself.
4. Wait until the first deploy finishes. It will be unhealthy until the variables below are set. That is expected.
5. Open the service → **Settings** → **Networking** → **Generate Domain**. Copy the `https://` address. It looks like `https://sales-assistant-production.up.railway.app`. No path and no slash at the end.
6. Open **Settings** → **Volumes** → **Add Volume**. Set the mount path to `/data`. One gigabyte is enough. Attach the volume to this service only.
7. Open **Settings** → **Scale** (or **Scaling**) and leave replicas at **1**. Do not turn on multiple replicas.
8. The health check path is already `/api/health` in `railway.toml`. If a field asks you to type it, use `/api/health`.

## Variables

Open the service → **Variables**. Add every row. Names are case-sensitive. Values have no quotes around them.

Leave `PORT` unset. Railway sets it.

| Variable | Live value | What it does |
| --- | --- | --- |
| `APP_URL` | `https://YOUR-DOMAIN` | Public address, no trailing slash. Must be `https`. |
| `SESSION_SECRET` | the first random string | Signs the login cookie. The app will not boot in production with the sample value. |
| `TOKEN_ENCRYPTION_KEY` | the second random string | Encrypts Outlook access and refresh tokens in SQLite. |
| `DATABASE_PATH` | `/data/sales-assistant.db` | The database file on the volume. If you forget this and the volume is mounted, the app uses `$RAILWAY_VOLUME_MOUNT_PATH/sales-assistant.db`. Set it anyway so the location is obvious. |
| `DEMO_MODE` | `false` | Production already defaults to false. Set it explicitly so a later edit cannot turn the demo book on. |
| `ORG_DOMAIN` | `turb0.ai` | Only `@turb0.ai` mailboxes can connect. |
| `MICROSOFT_TENANT_ID` | Directory (tenant) ID | From the Entra app. Not the word `common`. |
| `MICROSOFT_CLIENT_ID` | Application (client) ID | From the Entra app Overview. Not the Object ID. |
| `MICROSOFT_CLIENT_SECRET` | Client secret **Value** | From Certificates & secrets. Not the Secret ID. |
| `MICROSOFT_REDIRECT_URI` | `https://YOUR-DOMAIN/api/auth/microsoft/callback` | Must match the Web redirect URI on the Entra app, character for character. |
| `LLM_PROVIDER` | `heuristic` | Works with no API key. Change to `openai` only when you have a key. |
| `LLM_API_KEY` | empty | Only for `LLM_PROVIDER=openai`. |
| `LLM_MODEL` | `gpt-4o-mini` | Only used when the provider is `openai`. |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible chat endpoint. |
| `CRM_PROVIDER` | `local` | Keep `local` until Turb0 Partners writes are ready. |
| `CRM_DRY_RUN` | `true` | Default is already on. The only value that turns dry-run off is `false`. Leave it `true`. |
| `TURB0_SUPABASE_URL` | `https://itrmlygedcaqjulipxbs.supabase.co` | Unused while CRM is local and dry-run. |
| `TURB0_SUPABASE_ANON_KEY` | empty | Needed later for Partners writes as the seller. |
| `TURB0_AUTH_MODE` | `user_jwt` | Keep this. `service_role` bypasses row level security. |
| `TURB0_SERVICE_ROLE_KEY` | empty | Do not set this on the hosted app. |
| `NOTES_WEBHOOK_SECRET` | empty, or another random string | Protects `POST /api/notes/webhook`. Leave empty until something posts notes. |
| `JOB_SECRET` | the third random string | Protects `POST /api/jobs/morning`. |
| `AUTO_SEND_ENABLED` | `false` | The only value that turns auto-send on is `true`. Leave `false`. Phase 1 still does not send unapproved client mail. |

After the variables are saved, redeploy if Railway did not redeploy on its own.

## Confirm the site is up

Open `https://YOUR-DOMAIN/api/health` in a browser. You want exactly:

```json
{"ok":true}
```

Then open `https://YOUR-DOMAIN`. With `DEMO_MODE=false` there is no Johnny/Karimy demo button. There is **Sign in with Microsoft**, once the Microsoft variables are set.

If the process exits before the site loads, open the service **Deployments** log. A refused boot says `Refusing to start in production` and names the variable to fix. It does not print secret values. `/api/health` answers only after that check passes.

## Add the redirect URI, then sign in

1. In the Entra app, add a **Web** redirect URI for the exact `MICROSOFT_REDIRECT_URI` above. Steps are in [entra-app-registration.md](entra-app-registration.md). The local `http://127.0.0.1:43123/...` URI can stay on the same app.
2. Redeploy after `APP_URL` and `MICROSOFT_REDIRECT_URI` match the domain you generated.
3. Johnny opens the site and chooses **Sign in with Microsoft**, with his `johnny@turb0.ai` account. Karimy does the same with `karimy@turb0.ai`. That sign-in stores each person’s Outlook tokens, encrypted, and creates their user.
4. Each of them opens **Mail** and chooses **Sync now** once, to pull the mailbox and calendar into the ledger.

Start from an empty volume. If a demo database was written to `/data` earlier, delete `/data/sales-assistant.db` from the service shell before the real sign-in, or the demo book will still be in the file. `DEMO_MODE=false` does not delete data that is already there.

## Morning briefing

The website does not send the briefing by itself. An hourly call asks it to. For each seller whose local time has reached their briefing hour (7 by default), the app emails that seller their list. It sends that email once per day. It does not email a client.

Add a second service in the same Railway project. This one only wakes up, makes the call, and exits. It does not get a volume.

1. In the project, choose **Create** → **Empty Service**. Name it `morning-briefing`.
2. Open **Settings** and set the start command to:

```bash
curl -fsS -X POST -H "Authorization: Bearer $JOB_SECRET" "$APP_URL/api/jobs/morning"
```

3. Set the cron schedule to `0 * * * *` (every hour, at minute 0).
4. Add variables `APP_URL` and `JOB_SECRET` with the same values as the web service.

Try it once from your own computer before you trust the schedule. Replace both placeholders:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer YOUR_JOB_SECRET" \
  https://YOUR-DOMAIN/api/jobs/morning
```

Success looks like `{"ok":true,"delivered":["johnny@turb0.ai","karimy@turb0.ai"]}` once their local hour has arrived. A call earlier in the morning returns `"delivered":[]`. That is the clock check, not a failure.

New Outlook mail is imported from the **Mail** page. Each seller chooses **Sync now**. The hourly job delivers the briefing from loops already in the ledger.

## Safety checks that stay on

- `AUTO_SEND_ENABLED=false`. Approving an item is what sends one client email. A sweep does not send client mail on its own.
- `CRM_DRY_RUN=true` and `CRM_PROVIDER=local`. The app does not call Turb0 Partners.
- `DEMO_MODE=false`. The sample book is not seeded into an empty database.
- One replica, one volume, one SQLite file.
- Do not commit `.env`. Railway variables are the only copy of the secrets.

## Backups and the encryption key

The ledger and the Outlook connections live only in `/data/sales-assistant.db`. Deleting the volume deletes both.

Before you change `TOKEN_ENCRYPTION_KEY`, rotate the Microsoft client secret, or delete the volume, open the service shell and copy `/data/sales-assistant.db` somewhere safe. Use Railway’s volume backup too if your plan includes it.

`TOKEN_ENCRYPTION_KEY` decrypts tokens that are already in the file. If you change the key, the app cannot read the old tokens. Johnny and Karimy each use **Sign in with Microsoft** again. Their loops stay in the file. Only the mailbox connection is lost.

Plaintext tokens from an older copy of the database are encrypted in place the first time the app starts with `TOKEN_ENCRYPTION_KEY` set. Rows that are already encrypted are left as they are.

## Updating

Merge to the branch Railway deploys. Railway runs `npm run build` and `npm start` again. The volume is not replaced by a deploy. Confirm `/api/health` still returns `{"ok":true}` after the deploy.

`npm start` is the production command locally too: `npm run build`, then `npm start`. It listens on `PORT` or port `43123`. Local production mode also requires `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, and an `https` `APP_URL`. Day-to-day local work stays on `npm run dev`.

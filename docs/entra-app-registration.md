# Register the Entra app for Ledger

This is the Microsoft 365 setup for the turb0.ai tenant. A Microsoft 365 admin does it once. Johnny and Karimy do not create the app. They only sign in after it exists.

The app is a confidential web client. The server holds the client secret and talks to Microsoft Graph as the signed-in seller. You will not turn on a mobile or single-page redirect, and you will not add application permissions.

Sign in at [https://entra.microsoft.com](https://entra.microsoft.com) with an account that can grant admin consent for turb0.ai. Global Administrator or Cloud Application Administrator can do that. Use the turb0.ai directory, not a personal Microsoft account. If the top bar shows the wrong directory, switch it before you create anything.

The code requests these delegated scopes and no others (`MICROSOFT_SCOPES` in `src/lib/adapters/mail/microsoft.ts`):

`openid` `profile` `email` `offline_access` `User.Read` `Mail.Read` `Mail.Send` `Calendars.Read`

## 1. Create the registration

1. In the left nav, open **Identity** → **Applications** → **App registrations**.
2. Choose **New registration**.
3. **Name:** `Turb0 Ledger`. Sellers may see this name on the consent screen.
4. **Supported account types:** select **Accounts in this organizational directory only (Turb0 only - Single tenant)**. The tenant name in parentheses may differ slightly. The line must say **Single tenant**. Do not select any option that says **Multitenant** or **personal Microsoft accounts**.
5. **Redirect URI:** open the platform menu and choose **Web**. Paste this local address exactly:

```text
http://127.0.0.1:43123/api/auth/microsoft/callback
```

Use `127.0.0.1`, not `localhost`. The app sends `127.0.0.1`. A different host is a redirect mismatch and Microsoft will refuse the sign-in.

6. Choose **Register**.

## 2. Copy the two ids

On the app’s **Overview** page, copy these two values into a password manager. Leave **Object ID** alone. It is not a setting the app uses.

| On the Overview page | Env var |
| --- | --- |
| **Application (client) ID** | `MICROSOFT_CLIENT_ID` |
| **Directory (tenant) ID** | `MICROSOFT_TENANT_ID` |

Check **Supported account types** on that same page. It should say **My organization only**.

The app calls the tenant-specific sign-in address, `https://login.microsoftonline.com/<tenant id>/oauth2/v2.0/authorize`. It rejects a sign-in whose token is from any other directory. Do not put `common` or `organizations` in `MICROSOFT_TENANT_ID`.

## 3. Add the hosted redirect URI

Do this after the Railway domain exists. Both addresses stay on the same app. Local development uses the first. The hosted site uses the second. Each running copy sets `MICROSOFT_REDIRECT_URI` to the one it actually uses.

1. Open **Manage** → **Authentication**.
2. Under **Platform configurations**, you should already see a **Web** platform. If you do not, choose **Add a platform** → **Web**.
3. Under **Web** → **Redirect URIs**, choose **Add URI** and paste the hosted callback. No trailing slash:

```text
https://YOUR-DOMAIN/api/auth/microsoft/callback
```

`YOUR-DOMAIN` is the Railway domain, for example `sales-assistant-production.up.railway.app`. It must be `https`. Microsoft accepts `http` only for `127.0.0.1` and `localhost`.

4. On the same Authentication page, under **Implicit grant and hybrid flows**, leave **Access tokens** and **ID tokens** unchecked. Ledger uses the authorization-code flow on the server.
5. Under **Advanced settings**, set **Allow public client flows** to **No**.
6. Choose **Save**.

If you later put the site on a custom domain, add that callback as another Web URI and change `APP_URL` and `MICROSOFT_REDIRECT_URI` to match. The redirect URI, `MICROSOFT_REDIRECT_URI`, and `APP_URL` must share one origin:

```text
APP_URL=https://YOUR-DOMAIN
MICROSOFT_REDIRECT_URI=https://YOUR-DOMAIN/api/auth/microsoft/callback
```

## 4. Create a client secret

1. Open **Manage** → **Certificates & secrets**.
2. Open the **Client secrets** tab.
3. Choose **New client secret**.
4. **Description:** `Ledger production`.
5. **Expires:** choose the longest lifetime the menu offers. That is **730 days (24 months)** when it is listed. Put a calendar reminder a week before that date. When the secret expires, Outlook sign-in stops until you create a new one and update `MICROSOFT_CLIENT_SECRET`.
6. Choose **Add**.
7. Immediately copy the **Value** column. That value is `MICROSOFT_CLIENT_SECRET`. You cannot see it again. The **Secret ID** is not the secret. If you lose the Value, create a new secret and delete the old one after the app is updated.

Send the Value through a password manager or a private message. Do not email it to a shared inbox, and do not paste it into git.

## 5. Add the Graph permissions

Add only delegated permissions. The picker has two tabs, **Delegated permissions** and **Application permissions**. Stay on **Delegated permissions**. Application permissions would let the app read mail without a signed-in seller. The code never uses those.

1. Open **Manage** → **API permissions**.
2. Choose **Add a permission**.
3. Choose **Microsoft Graph**, then **Delegated permissions**.
4. Search for each permission string below and check that row. Search the string in the first column, not the sentence. Add all eight, then choose **Add permissions**.

| Permission | Name in the picker | Why Ledger asks for it |
| --- | --- | --- |
| `openid` | Sign users in | Sign-in. |
| `profile` | View users' basic profile | The seller’s name. |
| `email` | View users' email address | The mailbox address on the sign-in token. |
| `offline_access` | Maintain access to data you have given it access to | Refresh token, so the morning job can run after the browser is closed. |
| `User.Read` | Sign in and read user profile | `GET /me` after sign-in, to confirm the mailbox. |
| `Mail.Read` | Read user mail | Read that seller’s inbox and sent mail. |
| `Mail.Send` | Send mail as a user | Send the briefing to the seller, and send a client email only after the seller approves it. |
| `Calendars.Read` | Read user calendars | Read that seller’s calendar. |

`User.Read` is often already on the list from the registration. Leave it there.

Do not add `Mail.ReadWrite`, `Mail.Send.Shared`, `Calendars.ReadWrite`, `Mail.ReadBasic`, or anything under Application permissions.

## 6. Grant admin consent

User consent is not enough for a mailbox app, and many tenants have user consent turned off.

1. Stay on **API permissions**.
2. Choose **Grant admin consent for Turb0**. The button uses the tenant’s display name.
3. Confirm **Yes**.
4. The **Status** column for every row should show a green check and **Granted for Turb0**.

If the button is greyed out, the account you are using cannot grant consent. Sign in as a Global Administrator or Cloud Application Administrator and repeat this step.

## 7. Limit the app to the two sellers

This is optional and worth doing. It stops any other turb0.ai mailbox from connecting.

1. Left nav: **Identity** → **Applications** → **Enterprise applications**.
2. Open **Turb0 Ledger**. If it is missing, search for that name. This is the enterprise application, not the app registration you were just in.
3. Open **Properties**. Set **Assignment required?** to **Yes**. Choose **Save**.
4. Open **Users and groups** → **Add user/group**.
5. Add `johnny@turb0.ai` and `karimy@turb0.ai`. They do not need an app role. Default access is enough.

If assignment is required and a person is not on that list, Microsoft blocks their sign-in.

## 8. Hand these values back

Whoever sets the Railway variables needs four things. Map them like this:

| Hand back | Env var | Where it came from |
| --- | --- | --- |
| Directory (tenant) ID | `MICROSOFT_TENANT_ID` | App registration → Overview |
| Application (client) ID | `MICROSOFT_CLIENT_ID` | App registration → Overview. Not the Object ID. |
| Client secret Value | `MICROSOFT_CLIENT_SECRET` | Certificates & secrets → Client secrets → Value. Not the Secret ID. |
| The redirect URI for this environment | `MICROSOFT_REDIRECT_URI` | The Web URI that matches this running copy |

Also tell them the public site address, with no path, for `APP_URL`.

Do not hand back the Object ID, the Secret ID, an Application ID URI, or anyone’s password.

## What the seller sees

Johnny or Karimy opens the site and chooses **Sign in with Microsoft**. They sign in with their `@turb0.ai` account. The callback checks two things: the token’s tenant id matches `MICROSOFT_TENANT_ID`, and the mailbox ends in `@turb0.ai`. Anyone else is turned away. The access token and the refresh token are encrypted before they are stored.

A seller who needs to connect again uses **Sign in with Microsoft** or **Settings** → **Reconnect Outlook**.

## When the code’s permissions change

Compare the consent screen with the eight names in the table above. If a later change adds a scope, update this guide from `MICROSOFT_SCOPES`, add that delegated permission, and choose **Grant admin consent for Turb0** again.

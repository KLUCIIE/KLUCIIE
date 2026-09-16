# Microsoft OAuth / Azure AD (Entra ID) Setup Guide

This guide walks through wiring up "Sign in with Microsoft" for the CIIE platform.

It is a step-by-step reference you follow once, as a Super Admin, to create the
Azure app registration and paste the resulting values into
**Admin → OAuth & Sign-in**.

---

## 0. What you need before you start

- An Azure subscription / Microsoft Entra tenant you can administer
  (a tenant admin, or a user who can consent to API permissions).
- A browser logged in to [portal.azure.com](https://portal.azure.com).
- Super Admin access in the CIIE app (to save OAuth settings).

> **In this app the OAuth settings are stored at runtime in the `oauth_settings`
> row. There is exactly one Redirect URI, and it is displayed on the
> Admin → OAuth & Sign-in page after you save anything.**

---

## 1. Create the app registration

1. In the Azure portal, go to **Microsoft Entra ID** (formerly Azure Active Directory).
2. Open **App registrations → New registration**.
3. Fill in:
   - **Name**: e.g. `CIIE Portal`
   - **Supported account types**: choose **"Accounts in this organizational directory only"**
     (single tenant). This is the recommended choice for a university app.
   - **Redirect URI (optional)**: leave blank here — we add it in the next step.
4. Click **Register**.

## 2. Add the Redirect URI (Web platform)

1. In the new app registration, open **Authentication**.
2. Under **Platform configurations → Add a platform → Web**, add the exact Redirect URI:
   - Copy it from the **Admin → OAuth & Sign-in** page in the CIIE app
     (shown as "Redirect URI — add this exactly in Azure → Authentication").
   - In local development it is normally:
     ```
     http://localhost:5173/api/oauth/microsoft/callback
     ```
   - In production it is:
     ```
     https://<your-site-domain>/api/oauth/microsoft/callback
     ```
3. Make sure **"ID tokens"** is checked under **Implicit grant and hybrid flows**.
4. Click **Save**.

> **Why the path:** Microsoft must be able to reach this exact URL. The CIIE
> frontend proxies `/api` to the backend, so the browser can be redirected to
> the site origin and still hit the backend callback. The value is either
> `FRONTEND_URL` + `/api/oauth/microsoft/callback` or, if set, the
> `OAUTH_REDIRECT_URI` backend environment variable.

## 3. Copy the Tenant ID and Client ID

1. Open **Overview** in your app registration.
2. Copy:
   - **Application (client) ID** → `Client ID` field in the CIIE app.
   - **Directory (tenant) ID** → `Tenant ID` field in the CIIE app.

## 4. Create a client secret

1. Open **Certificates & secrets → Client secrets → New client secret**.
2. Give it a description (e.g. `ciie-prod`) and an expiry.
3. Click **Add**, then immediately copy the **Value** (it is shown only once).
4. Paste it into the **Client secret** field in the CIIE app.
   > Save it somewhere safe. Never commit it to the repository.

## 5. Grant the API permissions

1. Open **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.
2. Add:
   - **User.Read** — required. Lets the app read the signed-in user's basic profile.
   - **User.Read.All** — optional. Only needed if you want to display extra profile data server-side.
3. Click **Grant admin consent** for the tenant (needs a tenant admin).
   - A blue "Granted" checkmark should appear next to **User.Read**.

---

## 6. Configure the CIIE app

1. Log in as a **Super Admin**.
2. Open **Admin → OAuth & Sign-in**.
3. Fill in the three fields from steps 3 and 4:
   | Azure value | CIIE field |
   |---|---|
   | Directory (tenant) ID | Tenant ID |
   | Application (client) ID | Client ID |
   | Client secret value | Client secret |
4. Choose a **Sign-in mode**:
   - **Microsoft only** — `/register/user` shows only the Microsoft button.
   - **Both / Register + Microsoft** — the password form is also shown.
   - **Registration only** — hides Microsoft (default).
5. Toggle **Enable Microsoft sign-in** on, then **Save**.

## 7. Allow your email domain

Microsoft sign-in only works for email domains a Super Admin has allowed when
domain restriction is turned on:

1. Open **Admin → Settings**.
2. Make sure **"Restrict sign-ups to allowed domains"** is enabled.
3. Add the email domain students use (e.g. `kluniversity.in`).
4. Save. Users outside this list will be rejected with
   **"Email domain is not allowed"**.

---

## 8. Verify

1. Open `/register/user` (Users → Register / self-registration page).
2. Click **Sign in with Microsoft**, complete the consent prompt.
3. You should be redirected back and asked to finish your profile.
4. Check **Admin → Members**: the new user has role **CIIE User** and
   `Microsoft` is marked on their account.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `AADSTS50011` invalid redirect URI | The Redirect URI in Azure does not exactly match the value shown on the OAuth admin page (no trailing slash, same scheme/host/port). |
| `AADSTS50105` signed-in user not found | The Microsoft account is not in the tenant for which the app is registered. |
| "Email domain is not allowed" | The domain is not in Admin → Settings → allowed email domains (step 7), or domain restriction is on but the list is empty. |
| `invalid_client` / 401 from Azure | Client Secret was regenerated or expired. Create a new secret and update the OAuth page. |
| Blank Redirect URI on the admin page | Reload the page after saving — the value is served from the backend (`GET /api/oauth/settings`), not stored in the database. |
| Microsoft button hidden | Token/secret missing, OAuth disabled, or mode is "Registration only". |

## Backend environment variables (optional overrides)

| Variable | Purpose | Default |
|---|---|---|
| `FRONTEND_URL` | Where the SPA lives; base for the default Redirect URI. | `http://localhost:5173` |
| `OAUTH_REDIRECT_URI` | Exact Microsoft redirect target; overrides the derived value. | derived from `FRONTEND_URL` |
# OAuth / OIDC provider setup (Administrators)

This guide walks through configuring **Google**, **Apple**, and **GitHub** so users can sign in to TaskMesh with those providers (Task **T0111**).

TaskMesh is an OAuth **client** (relying party). It never acts as an identity provider itself. After a successful IdP login, TaskMesh creates the same **session cookie** used by email/password sign-in.

In the app: **Administration → OAuth**. Use the **?** help panel while filling fields.

---

## Prerequisites (TaskMesh host)

Do these once before enabling any provider.

1. **Migrations applied** — `oauth_providers`, `user_identities`, and `oauth_login_states` tables exist (`npm run db:migrate`).
2. **Encryption key** — set a long random secret in `.env` (never commit it):

   ```bash
   OAUTH_CREDENTIALS_KEY=…   # e.g. openssl rand -base64 48
   ```

   Provider client secrets and Apple’s `.p8` key are encrypted with this value. Rotating it without re-entering secrets breaks decryption.

3. **Public origin** — know the HTTPS (or local HTTP) origin users use in the browser, e.g. `https://taskmesh.example.com` or `http://127.0.0.1:5173` for DEV via Vite.

   Optional if the request host is wrong for redirects:

   ```bash
   OAUTH_PUBLIC_BASE_URL=https://taskmesh.example.com
   ```

4. **Restart the API** after changing `.env`.
5. **Administrator** account in TaskMesh to open Administration → OAuth.

### Callback URL pattern

For each provider slug, register this **exact** redirect URI at the IdP (origin + path):

```text
{PUBLIC_ORIGIN}/api/v1/auth/oauth/{slug}/callback
```

Examples:

| Provider | Callback path |
|----------|----------------|
| Google | `/api/v1/auth/oauth/google/callback` |
| Apple | `/api/v1/auth/oauth/apple/callback` |
| GitHub | `/api/v1/auth/oauth/github/callback` |

Scheme, host, port, and path must match character-for-character (no trailing slash unless you registered one).

---

## Requirements comparison

| | Google | Apple | GitHub |
|---|--------|-------|--------|
| **Account** | Google account | Apple Account | GitHub account |
| **Paid membership required?** | No for basic OAuth sign-in | **Yes** — [Apple Developer Program](https://developer.apple.com/programs/) (typically **USD $99 / year**; regional pricing varies) | No for creating an OAuth App |
| **Cloud / org extras** | Free [Google Cloud](https://console.cloud.google.com/) project; billing account often prompted but **OAuth sign-in itself is not a paid API product** | Must create identifiers under Certificates, Identifiers & Profiles; web Sign in with Apple is tied to a **primary App ID** (iOS/macOS/tvOS/watchOS) | Personal or org account; OAuth Apps are free (separate from GitHub Actions minutes / paid plans) |
| **User-facing cost** | End users: free Google Account | End users: free Apple Account | End users: free GitHub account with a **verified email** |
| **Hardest setup** | Consent screen + exact redirect URI | Developer Program + App ID + Services ID + `.p8` key + domains | Usually easiest |

Fees and policies change; always confirm on the vendor sites linked below.

---

## Google

### What you need

- A **Google Account** (free).
- A **Google Cloud** project ([Console](https://console.cloud.google.com/)). Creating a project is free; Google may ask you to link a billing account for the Cloud org, but configuring OAuth client credentials for Sign-In does **not** require purchasing a Google Workspace subscription.
- For production with an **External** audience: while the app is in **Testing**, only listed test users can sign in until you **publish** the consent screen. Publishing may trigger Google’s verification if you request sensitive/restricted scopes. TaskMesh’s default scopes (`openid email profile`) are the common “Sign in with Google” set — follow Google’s current verification rules if prompted.

### Official documentation

- [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Manage OAuth clients](https://support.google.com/cloud/answer/15549257?hl=en)
- [Google Auth Platform / Clients](https://console.cloud.google.com/auth/clients) (console)
- [OAuth consent / branding](https://console.cloud.google.com/auth/overview) (console; UI labels evolve)

### Step-by-step

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen** / **Credentials**, depending on console UI).
3. Configure the **OAuth consent / branding**:
   - User type **External** for a normal private/public web app (or **Internal** only if every user is on your Google Workspace).
   - App name, support email, and developer contact as required.
   - Add **Test users** while the app remains in Testing.
4. Create an OAuth client:
   - [Clients → Create client](https://console.cloud.google.com/auth/clients)
   - Application type: **Web application**
   - **Authorized redirect URIs**: add  
     `{PUBLIC_ORIGIN}/api/v1/auth/oauth/google/callback`
   - Authorized JavaScript origins are optional for TaskMesh’s server-side code flow; you may leave them empty or add your site origin if Google asks.
5. Copy the **Client ID** and **Client secret** (secret is shown once — store it safely).
6. In TaskMesh → **Administration → OAuth → Google**:
   - Paste Client ID and Client secret
   - Leave scopes as default (`openid email profile`) unless you know you need others
   - Enable the provider (requires `OAUTH_CREDENTIALS_KEY`)
   - Save
7. Sign out (or use a private window) and open TaskMesh Login → **Continue with Google**.

### TaskMesh behavior notes

- Requires a **verified** email from Google (`email_verified`).
- With **JIT** off (default), the Google email must already match a TaskMesh user, or the identity must already be linked.
- With **JIT** on, a new TaskMesh user can be created (default role Editor).

---

## Apple (Sign in with Apple)

### What you need

- An **Apple Account** with two-factor authentication.
- Enrollment in the **[Apple Developer Program](https://developer.apple.com/programs/)** — paid membership (commonly **USD $99 per year** for the standard program; see [Enrollment](https://developer.apple.com/help/account/membership/program-enrollment/) for current fees and payment methods). The free “Apple Developer” website access is **not** enough to create Sign in with Apple keys and Services IDs.
- Ability to create:
  - A **primary App ID** (iOS, macOS, tvOS, or watchOS) with **Sign in with Apple** enabled  
  - A **Services ID** (this becomes TaskMesh’s Client ID)  
  - A **Sign in with Apple** private key (`.p8`) associated with that App ID  
- Domains / return URLs registered for the Services ID. Apple expects real hostnames for production; follow Apple’s rules for localhost / development (return URLs generally must include scheme, host, and path).

There is **no separate per-login fee** from Apple for Sign in with Apple beyond Developer Program membership. You do **not** need an App Store paid application listing solely to create identifiers, but you **do** need the App ID capability configured as Apple documents.

### Official documentation

- [Configure Sign in with Apple for the web](https://developer.apple.com/help/account/configure-app-capabilities/configure-sign-in-with-apple-for-the-web/)
- [Create a Sign in with Apple private key](https://developer.apple.com/help/account/configure-app-capabilities/create-a-sign-in-with-apple-private-key/)
- [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) (console)
- [Sign in with Apple REST API](https://developer.apple.com/documentation/signinwithapplerestapi) (overview)
- [Program enrollment & fees](https://developer.apple.com/help/account/membership/program-enrollment/)

### Step-by-step

1. Enroll (or sign in) at [Apple Developer](https://developer.apple.com/account).
2. Note your **Team ID** (Membership details / account membership page).
3. **Identifiers → App IDs**: create or edit a primary App ID and enable **Sign in with Apple**.
4. **Identifiers → Services IDs**:
   - Register a Services ID (e.g. `io.blackrook.taskmesh.web`).
   - Enable **Sign in with Apple** → **Configure**.
   - Select the primary App ID.
   - Add **Domains and Subdomains** for your TaskMesh host.
   - Add **Return URLs**:  
     `{PUBLIC_ORIGIN}/api/v1/auth/oauth/apple/callback`
   - Save.
5. **Keys**:
   - Create a key, enable **Sign in with Apple**, associate the primary App ID.
   - Download the `.p8` file **once**; note the **Key ID**.
6. In TaskMesh → **Administration → OAuth → Apple**:
   - **Client ID** = Services ID identifier  
   - **Team ID** = Apple Team ID  
   - **Key ID** = key’s Key ID  
   - **Private key** = full `.p8` PEM text (including `BEGIN` / `END` lines)  
   - Enable and Save  
7. Test Login → **Continue with Apple**.

### TaskMesh behavior notes

- TaskMesh uses Apple’s **form_post** callback mode (server receives a POST).
- The human **name** is often provided only on the **first** authorization; later logins may omit it.
- Email may be the user’s real address or an Apple **Hide My Email** relay — both are treated as the account email when present.
- JIT / email-matching rules are the same as Google.

---

## GitHub

### What you need

- A **GitHub** personal account or an **organization** where you can administer Developer settings (free accounts are enough).
- Creating an **OAuth App** does **not** require a paid GitHub plan. Paid GitHub products (Pro, Team, Enterprise, Actions minutes, etc.) are unrelated to OAuth App registration.
- End users who sign in must have a **verified** email on GitHub (GitHub blocks OAuth authorization for unverified primary emails). TaskMesh also requires a verified email from the emails API.

### Official documentation

- [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps) (includes verified-email note)
- [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- Developer settings: GitHub → avatar → **Settings** → **Developer settings** → **OAuth apps**  
  Direct pattern: `https://github.com/settings/developers`

> GitHub recommends GitHub Apps for many new integrations. TaskMesh currently implements the classic **OAuth App** flow (user sign-in + `user:email`).

### Step-by-step

1. GitHub → **Settings** → **Developer settings** → **OAuth apps** → **New OAuth App** (or **Register a new application**).
2. Fill in:
   - **Application name** — e.g. `TaskMesh`
   - **Homepage URL** — your TaskMesh public origin  
   - **Authorization callback URL** —  
     `{PUBLIC_ORIGIN}/api/v1/auth/oauth/github/callback`  
     (OAuth Apps support a **single** callback URL.)
3. Register the application.
4. Open the app → **Generate a new client secret**; copy **Client ID** and **Client secret**.
5. In TaskMesh → **Administration → OAuth → GitHub**:
   - Paste Client ID and Client secret
   - Default scopes `read:user user:email` are correct
   - Enable and Save
6. Test Login → **Continue with GitHub**.

### TaskMesh behavior notes

- TaskMesh calls GitHub’s user + emails APIs and requires a **verified** email (prefers primary verified).
- Same JIT / existing-user matching rules as the other providers.

---

## After providers are enabled

### Login

Enabled providers appear as **Continue with …** buttons on `/login`. Email/password remains available.

### Linking accounts (users)

Signed-in users: **Profile → Linked accounts** — link or unlink Google / Apple / GitHub. A user with **no password** cannot unlink their **last** linked provider (lockout guard).

### JIT provisioning (Administrators)

Per provider checkbox **JIT create users**:

| JIT | Behavior |
|-----|----------|
| **Off** (default) | Unknown verified email → login error (`oauth_no_account`). Admin must create the user first (or they match an existing email). |
| **On** | Creates a TaskMesh user with no password, assigns **Editor** (or the selected default role), links the identity, and signs them in. |

User **signup** product flows remain a separate Task (**T0129**); this guide is federation login + Admin provider config only.

### Troubleshooting

| Symptom | Things to check |
|---------|-----------------|
| Enable fails mentioning credentials key | `OAUTH_CREDENTIALS_KEY` set and API restarted |
| `redirect_uri_mismatch` / similar | Callback URL exact match including `http` vs `https` and port |
| Google works only for you | Consent screen still in Testing — add test users or publish |
| Apple callback fails | Services ID vs App ID confusion; Team/Key/`.p8` mismatch; return URL domain registered |
| GitHub “no verified email” | User must verify email on GitHub; scopes include `user:email` |
| Button missing on Login | Provider **Enabled** and Client ID saved; hard-refresh Login |

---

## Related TaskMesh docs

- [SECURITY.md](../SECURITY.md) — threat model, CSRF exempt for Apple `form_post`, secret handling  
- [Platform tables](database/platform.md) — `oauth_providers`, `user_identities`, `oauth_login_states`  
- [INSTALL.md](../INSTALL.md) — host install and `.env`  
- [.env.example](../.env.example) — `OAUTH_CREDENTIALS_KEY` / `OAUTH_PUBLIC_BASE_URL` stubs  

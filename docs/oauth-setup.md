# Google OAuth setup

Flow: the browser goes to **Supabase Auth** (`/auth/v1/authorize`), then to **Google**. Google redirects back to **Supabase** at `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Supabase then redirects to **your app** at `…/auth/callback?code=…`, and supabase-js exchanges the PKCE code for a session.

Google only needs to know about Supabase's callback. Supabase needs to allow your app's final `/auth/callback` URL.

## 1. Google Cloud project
1. https://console.cloud.google.com → project picker → **New project**.

## 2. OAuth consent screen (Google Auth Platform → Branding / Audience)
1. User type **External**, app name, support email, logo (optional).
2. Authorized domains: `supabase.co`, plus your own domain if you have one.
3. Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (the defaults).
4. While in **Testing**, only listed test users can sign in. **Publish** the app for public use (Google may require verification for branding).

## 3. Credentials
**Clients → Create client → Web application**
- **Authorized JavaScript origins:** `http://localhost:5173`, `https://chat.yourdomain.com` (or your `*.pages.dev` URL)
- **Authorized redirect URIs:** `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

Copy the **Client ID** and **Client Secret**.

## 4. Supabase provider settings
Go to **Authentication → Sign In / Providers → Google**, enable it, paste the Client ID and Client Secret, and save. Never put the client secret in frontend code or `VITE_*` variables.

## 5. Supabase URL allow-list (Authentication → URL Configuration)
- Site URL: your production app URL (for dev: `http://localhost:5173`)
- Redirect URLs:
  - `http://localhost:5173/auth/callback`
  - `https://chat.yourdomain.com/auth/callback` (or `https://talksy.pages.dev/auth/callback`)
  - Preview builds (optional): `https://*.talksy.pages.dev/auth/callback`

The app sends `redirectTo = ${window.location.origin}/auth/callback?next=…`, so each origin you use must be on this list.

## 6. Guest → Google upgrade
Enable **Manual linking**. The app calls `supabase.auth.linkIdentity({ provider: 'google' })`, which attaches Google to the **same user id**, so friends, DMs and history are kept.

If that Google account already belongs to another Talksy user, Supabase returns `identity_already_exists`. The callback page explains the conflict, and nothing is merged or silently replaced.

## 7. Test locally
`pnpm dev` → Log in → **Continue with Google**. You should land on `/onboarding` (new user) or `/app` (returning user). Also check sign out → sign in (returning user), and leave a tab open for more than an hour to confirm silent token refresh.

## 8. Test in production
Repeat on the deployed URL from a private window and from a phone. If you see `redirect_uri_mismatch`, check step 3. If you're bounced to the Site URL instead of `/auth/callback`, the redirect URL is missing from step 5.

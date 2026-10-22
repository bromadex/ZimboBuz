# Connecting ZimERP to Supabase

ZimERP runs on one Supabase project (database, sign-in and file storage). The
database is set up from `supabase/migrations` by the **Supabase** GitHub
Actions workflow; the app reaches Supabase through environment variables.

## 1. Database (done by the workflow)

- Repository secret `SUPABASE_DB_URL`: the project's **Session pooler**
  connection string (Supabase → Connect).
- Actions → Supabase → Run workflow: `check` lists waiting migrations and
  checks the live database; `apply` applies them first. On the working
  branch, a push that changes migrations runs `check`, or `apply` when the
  commit message contains `[supabase apply]`.

## 2. Sign-in settings in Supabase (Authentication)

- **URL Configuration**
  - Site URL: `https://zimerp.co.zw`
  - Redirect URLs: add `https://**.zimerp.co.zw/**`
    (sign-in emails always link to a company's free ZimERP address; an own
    main domain still works because ZimERP forwards visitors to it).
- **Sign In / Providers → Email**: on. "Confirm email" can stay on: new
  owners then confirm their address before their first sign-in.
- **Emails**: the default emails work. For better delivery and your own
  wording, set custom SMTP (for example Resend) and edit the "Invite user",
  "Reset password" and "Confirm signup" templates.
- **Passwords**: minimum length 10 (ZimERP asks for 10 too).

ZimERP keeps its own two-step sign-in (authenticator app), so Supabase MFA is
not needed.

## 3. App environment (Vercel, or wherever the app runs)

| Variable | Where to find it | Secret? |
|---|---|---|
| `AUTH_MODE` | `supabase` | no |
| `DATABASE_URL` | Connect → **Transaction pooler** (port 6543) | yes |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project ref>.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API keys → publishable / anon | no |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API keys → secret / service_role | **yes, server only** |
| `SESSION_SECRET` | `openssl rand -hex 32` | yes |

With the service role key set, uploaded files (logos, website pictures,
product pictures) go to a private Supabase Storage bucket, `zimerp-files`,
created on first upload. Visitors never get Supabase links: ZimERP serves
public files itself and only those registered as public.

## How it fits together

- Supabase checks email and password, sends the confirmation, reset and
  invitation emails, and owns `auth.users`.
- ZimERP then starts its own signed session for that user id and reaches the
  database as that user, so row-level security decides everything they see.
- Email links land on `/auth/callback` (ERP) or `/account/auth` (customer
  portal), which confirm the address or ask for a new password.

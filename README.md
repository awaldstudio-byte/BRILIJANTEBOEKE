# Briljante Boeke

This repository contains the existing Briljante Boeke public website and the Phase 1 private-school ordering foundation. The established logo, book artwork, Roboto typography and navy/turquoise visual system remain the source of truth.

## Phase 1 functions

- Private access codes and order links tied to one school and one ordering period
- School-specific grade availability, prices and expected quantities
- One parent order containing one or more learners from that school
- Learner name, surname and grade
- Parent contact details and a versioned policy acknowledgement
- Server-calculated order totals
- PayFast checkout and server-to-server payment verification
- Briljante staff login, dashboard, school setup, order tracking and paid-learner CSV export
- Afrikaans and English parent-order and Briljante administration interfaces
- One-time display of each new school code and link, with copy controls and a prepared email draft for Briljante to send
- Academic-year history and ordering-period open, close and archive states
- Audit records and queued parent/staff payment notifications

School dashboards and school logins are not part of Phase 1.

## Architecture

- Static website and browser interfaces hosted by Vercel
- Vercel serverless API routes under `api/`
- Supabase Postgres, Auth and Row Level Security
- PayFast hosted payment page and verified ITN callback
- No secret keys in browser code; database and payment credentials remain server-side

## Local checks

Requirements: Node.js 24, Docker Desktop and the Supabase CLI.

```powershell
npm install
npm run check
npx supabase start
npx supabase db reset --local
npx supabase db lint --local --level warning
```

Run `test/phase1-acceptance.sql` against the local database to verify multi-learner order creation, server-calculated totals and restricted anonymous access.

The static preview modes do not send orders, personal data or payments:

- `/order/?preview=1`
- `/admin/?preview=1`

Add `&lang=en` to either preview URL for the English interface.

## Environment variables

Copy `.env.example` into the relevant local or Vercel environment and replace every placeholder. Do not commit the completed file.

Required values:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `ORDER_TOKEN_SECRET`
- `APP_ORIGIN`
- `PAYFAST_MODE`
- `PAYFAST_LIVE_ENABLED` (false until merchant activation and sandbox acceptance)
- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`
- `BRILJANTE_NOTIFICATION_EMAILS`

Start with `PAYFAST_MODE=sandbox`. Live mode must only be enabled after the complete sandbox acceptance run succeeds.

The current readiness record is `docs/PAYFAST_READINESS.md`. Without complete payment configuration the live school interface stays closed and the order API refuses to create orders. `PAYFAST_MODE=live` additionally requires `PAYFAST_LIVE_ENABLED=true` and non-sandbox merchant credentials. Public homepage/policy publication does not activate the school-ordering application.

## Database setup and staff approval

The dedicated project is already provisioned. Verify its project reference before applying any migration; do not create or switch projects as a routine release step.

1. Apply pending migrations from `supabase/migrations/` in timestamp order after the required backup and acceptance checks.
2. Run the relevant database security and permissions checks.
3. Add only an explicitly approved staff email to the private `public.staff_access_approvals` directory, with the approved role and display name. Do not put an administrator-selected password in SQL or create a user with a shared password.
4. The approved staff member uses the account setup flow, proves control of that mailbox with the expiring provider code, and privately chooses a password. Supabase Auth manages the identity; the application verifies its linkage to the approval before granting staff access.
5. Follow the password and authenticator stages on the staff interface. An enrolled authenticator remains compulsory at login; an approved user with no enrolled factor can choose to set one up later.

`staff_access_approvals` is authoritative. Do not activate the legacy `staff_users` directory: current application access deliberately ignores it, and older immutable previews may still consult it without the current controls. Staff permission never comes from user-editable metadata.

The restricted preview permits only the dedicated technical test identity on its configured project and origin. Real staff use the production administration route. See `docs/STAFF_ACCESS_PREVIEW_2026-10-22.md`, `docs/STAFF_RECOVERY_2026-10-26.md` and the latest release status for environment-specific acceptance.

## First school information

The Briljante administration page requires only the confirmed operational information:

- School name and optional contact details
- Academic year
- Ordering-period opening and closing dates
- Participating grades
- Price and expected quantity per participating grade
- Optional delivery note

Saving a new setup generates a private parent access code and order link. Briljante can copy either value or open a prepared email addressed to the school contact. Generating a replacement code revokes the previous active code.

## PayFast acceptance

Before live launch, verify all of the following in PayFast sandbox:

1. A parent can order for two or more learners in one transaction.
2. The checkout amount matches the server-calculated order amount.
3. Return and cancel routes contain no parent access token.
4. Only a valid PayFast ITN marks an order as paid.
5. Invalid signature, merchant, amount and source checks do not change the order to paid.
6. Repeated ITNs remain idempotent.
7. A temporary PayFast validation outage returns a retry response without permanently rejecting the event.
8. The paid learner export matches the learners attached to paid orders.

## Deployment sequence

1. Deploy the feature branch to a Vercel preview.
2. Configure preview-only Supabase and PayFast sandbox environment values.
3. Run browser, database, security and PayFast acceptance checks.
4. Add the first real school and confirm its link, grades, prices, dates and quantities with Briljante.
5. Configure production environment values.
6. Merge to `main` only after acceptance.
7. Verify `www.briljanteboeke.co.za`, HTTPS, the order flow, staff login and PayFast ITN processing on the production deployment.

The current production branch is `main`. A feature-branch push is a preview only and must not be treated as a production launch.

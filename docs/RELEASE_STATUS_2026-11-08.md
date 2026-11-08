# Briljante release checkpoint — 8 November 2026

The public website still runs the previous marketing release. The ordering/admin application is not yet promoted to the public domain. Do not describe this checkpoint as complete payment, refund or production acceptance.

## Completed and observed

- The source is preserved in commits `05a93d5` and `5f5c692` on `codex/phase1-foundation`. No remote push was performed in this pass.
- The current full suite passed 292 tests, with 95 JavaScript files checked. The dependency audit found zero vulnerabilities; whitespace checks passed.
- The first preview attempt exposed a real platform limit: the new management endpoint made 13 functions, exceeding the current plan's 12-function limit. Management now shares the existing orders function through rewrites. Its public URL, queries, payloads and authorization remain covered by five additional regression tests.
- Preview deployment `dpl_H72x7x1Cr2jPAm5SrkFe4fpZz8WF` is READY at https://brilijanteboeke-87e5iqmxq-awaldstudio.vercel.app . This is an isolated build; the existing canonical test alias was not changed because the hosted migrations are still pending.
- Thirteen HTTP smoke checks passed for public/admin/order pages, management assets, protected routes, methods and private-file exclusion. Authentication was required at the management/orders endpoints, invalid methods were refused, and internal docs/migrations/environment/library source returned 404. Evidence: `outputs/release-2026-11-08/http-preview-result.json`.
- Production and branch-scoped preview environment names remain present. Production aliases still serve the older release; public `/order/` remains 404, and the existing test alias does not expose the new management asset. No production deployment, DNS change or hosted migration was performed.
- The 5 November encrypted hosted snapshot had passed recovery across all 23 application tables, with 58 total schema tables archived. This remains a dated data snapshot, not a full Supabase service backup or proof of Storage-file/key recovery.
- The user declined extra supplier particulars, stating that Briljante manufactures its own products. Existing confirmed business/contact content is retained. No legal exemption is inferred from that statement.

## Immediate access gap

Computer use reports: `Local browser use is disabled in Work settings`. The connected Supabase account lists other projects, not Briljante, and the local Supabase CLI has no access token. No attempt was made to bypass the disabled browser setting, extract browser credentials or reset an account password. The user has been asked to enable browser access.

## Continue when access is restored

1. Open the correct dedicated Supabase project `cigyxjfzbjlgbrduzcpw`; allow its existing session to restore before requesting sign-in.
2. Recheck the hosted migration state and current real-data counts. Refresh the encrypted snapshot with the existing public-key SQL and verify its recovery in a new private directory before applying changes.
3. Apply the two pending migrations transactionally, with reasonable lock/statement limits. The prepared script is `outputs/release-2026-11-08/apply-pending-migrations.sql`, SHA-256 `80804c50b1aef753204c1d5f5dddab3cae894cdf296594a445bc6cd36ab0a0c9`. Confirm neither migration is already applied before running it. Then run the rollback-only acceptance SQL independently; do not nest its rollback around the deployment transaction.
4. Point the canonical technical preview alias to the new build. Use the existing technical staff session to verify order lookup/corrections, emailed per-book refund request/review/simulated completion, balances/reports, dispatch, notification inbox outcomes and mobile/keyboard behavior. A recorded simulation is not a PayFast provider refund.
5. Verify the live merchant configuration and appropriate provider acceptance, then perform the authorised controlled real-payment check with user participation. Confirm order/callback/mail evidence and any required refund/settlement behavior; do not infer these from the earlier signed API ping.
6. Promote the verified application within the existing domain configuration, check actual production routes/HTTPS/headers and keep a known rollback deployment available.

Source preparation and a successful preview deployment do not establish that these remaining hosted journeys have passed.

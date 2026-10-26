# Sandbox acceptance checkpoint

26 October 2026, South Africa. This is a continuation record, not launch acceptance.

Implemented locally: secure staff password recovery retaining enrolled MFA; audited recording of a full refund already completed in PayFast; terminal refund protection; and a genuine PayFast sandbox order path. Sandbox creation requires the existing technical administrator, exact preview origin, dedicated database, Test School 1, approved test mailbox, two explicit server flags and sandbox mode. Atomic pending orders use the established DEMO reference classification and a separate sandbox idempotency key. Only a validated provider notification can pay these orders. Live mode rejects both publicly documented sandbox merchant IDs. No client merchant account was created.

Hosted database: migrations `20261026145309_record_full_refund_reconciliation.sql` and `20261026145656_sandbox_payment_acceptance.sql` were installed transactionally on dedicated project `cigyxjfzbjlgbrduzcpw`. Combined refund and sandbox rollback acceptance passed there. Baseline: PostgreSQL 17.6, zero real orders, three pre-existing DEMO orders, one school, anonymous payment RPC execution false. No test fixture writes were retained. Existing preview application remains the previous release; no sandbox credentials have been configured.

Local PostgreSQL 17.11 rehearsal applied all 11 migrations; encrypted dump/restore preserved all 25 tables, data, RLS, grants and application-function fingerprints. Phase 1, sandbox, refund, shipping, staff and academic acceptance were exercised, including suites after restore. This was synthetic data. It is not a backup of the hosted client database. Provider-managed backup/retention and a secure hosted dump still require confirmation/access; do not reset the database password to obtain it.

Next actions:

1. Confirm integrated test result and commit current prepared changes. Deploy after schema-first checks, retaining existing preview demonstration flag. No production deployment.
2. Enable a deployment-only restricted sandbox using the public test credentials documented by PayFast: https://support.payfast.help/portal/en/kb/articles/why-am-i-getting-a-merchant-id-merchant-key-error-20-9-2022 . Use PAYFAST_MODE=sandbox, PAYFAST_LIVE_ENABLED=false, DEMO_PAYMENTS_ENABLED=true and PAYFAST_SANDBOX_TESTS_ENABLED=true. No live merchant credentials are needed for this test. Do not store provider or mailbox secrets in Git or output.
3. Use the authorised technical session and Test School 1 in the normal ordering UI. Enter fictional learners and only the approved technical test mailbox. Complete an actual PayFast dummy-wallet checkout, inspect its verified callback, paid database state, two notification jobs, actual inbox messages, dashboard and reports. Label all evidence as sandbox/no money.
4. Check cancellation/retry and delayed/duplicate notification handling, refund-recording dialog, grouped shipping notifications, narrow-screen layouts and recovery request guidance. Any real password/authenticator step is completed privately by the user. Existing account login is signed in; do not sign it out during acceptance.
5. Final client merchant signup/FICA, enabled payment methods, supplier particulars, operational ownership, hosted backup and approved low-value live payment/refund/settlement acceptance remain launch requirements. No live payment, real refund, client email, production deployment or DNS change was performed.

The user authorises necessary implementation and sandbox acceptance. Work must stop at 2% or 1% remaining account usage, including agents; resume from this checkpoint when usage permits. Do not claim provider acceptance from the automated test count.

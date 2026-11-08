# Briljante Boeke release status — 1 November 2026

## Decision

Do not switch the public domain to this build yet. PayFast verified the merchant account, but that is not evidence that the website's live configuration and transaction flow have been accepted. The existing public site remains in place. Briljante expects to provide PayFast dashboard access on Monday, 2 November.

## Confirmed provider correspondence

- PayFast's activation email says the merchant account is verified and activated. Monray subsequently confirmed it is ready for payments.
- Monray asked the studio to contact `Integrations@network.global` after verification for the integration/testing check. No message has been sent as part of this work.
- An earlier restricted preview transaction used PayFast's test environment and fictional data; it does not prove a live merchant transaction.
- A read-only hosted check on 1 November showed the approved Briljante staff account is active and has completed email verification, password setup and account setup. Recheck sign-in and permissions during hosted acceptance.
- A read-only hosted refund preflight on 1 November found zero duplicate provider-reference groups and zero null provider-reference fields in the legacy refund ledger. Repeat immediately before applying the migration.

## Work prepared locally

- Staff can search orders, correct permitted parent and learner details, and record an emailed refund request for selected books. Approval and recording an already-completed PayFast refund are separate steps. The site does not initiate a refund or send an automatic reply to the parent.
- Refund balances and paid-book counts are reflected in the order status, reporting and fulfilment logic. Test data is separated from production views and mutations, and the public order flow has additional rate limiting.
- The new database migrations and application changes are local and have not yet been applied to the hosted project or released. Isolated migration, access and encrypted restore rehearsals use synthetic data only; they are not backups of the hosted project.
- Preview and production currently share staff authentication. An authorised staff member can change their own real password or MFA through preview; the preview is therefore not a fully isolated identity environment. Resolve or explicitly account for this before allowing routine preview access after launch.
- Local application checks passed 274 tests across 92 JavaScript files. A fresh-install check passed before the final guard tests were added. A dependency update removed the four high-severity audit findings; eight moderate findings remain in the ExcelJS dependency chain and need ongoing review. An isolated PostgreSQL rehearsal passed all 14 migrations, legacy refund-reference backfill, concurrent cross-ledger duplicate checks, access controls and encrypted restore (31 table fingerprints). Evidence: `C:\Users\natha\.codex-private\briljante-backups\management-20261101-j\rehearsal-result.json`.
- The reproducible synthetic rehearsal is `scripts/management-rehearsal.mjs`; its output must be in a new private directory. It does not back up hosted data. New files, including both migrations, application modules, tests and this runner, remain uncommitted and must be included in the eventual release.

## Release prerequisites

1. Obtain existing PayFast dashboard access securely. Configure the correct live merchant values and passphrase in the production hosting environment without putting secrets in source control, chat or evidence. Verify the appropriate live mode and origin settings. The hosting project currently has preview variables but no production variables.
2. Establish and verify a current, recoverable hosted-data backup and Storage-file recovery. The current Supabase Free plan does not include project backups. Do not reset an unknown database password. Follow `BACKUP_RESTORE_2026-10-26.md`; its synthetic test does not replace this step.
3. Apply the pending database migrations safely to the correct hosted project, then deploy the matching build to a restricted preview. Verify staff login, order lookup and corrections, per-book refund request/review/recording, reporting, dispatch and notifications using approved fictional records. Check that production and preview isolation work against the deployed environment, including the shared staff-authentication limitation above.
4. Complete the PayFast integration review requested by Monray and agree an authorised, controlled real-payment check. A live transaction and refund require the account owner's participation; do not claim either has succeeded without provider and application evidence.
5. Set and verify the production mail recipients, SMTP, origin, auth, database and security settings; verify production builds, the canonical domain, HTTPS, redirects and existing email DNS before and after cutover. Keep rollback and recovery details available.

Recheck all facts and tests at release time. A passing local suite or provider account approval is not a guarantee that the live system is ready.

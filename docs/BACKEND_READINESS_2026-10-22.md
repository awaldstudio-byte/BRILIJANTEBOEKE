# Backend readiness before PayFast meeting

This is an internal working record, not a launch approval. Baseline feature revision: 7ba4916; new mail implementation remains local pending service access and acceptance. Existing public marketing release is preserved. No client emails, DNS changes, database writes or real payments were performed in this pass.

## Access and live observations

- Dedicated Briljante database project: cigyxjfzbjlgbrduzcpw. Browser is signed out. Connected database tool lists GETIT-CORE and NOSTRATIC only; neither may substitute for Briljante.
- Vercel feature preview has database URL/key configuration, application origin and order-token secret. No PayFast or SMTP configuration is listed. Provider-protected secrets cannot be pulled; local environment does not supply usable database credentials. No credentials are recorded here.
- Preview GET /api/public-school with a deliberately invalid readiness-test code returned HTTP 500 rather than expected 404. Recent preview runtime log shows `fetch failed`; root cause still requires dedicated project access. Do not describe this as merely missing PayFast configuration.
- Anonymous preview /api/admin-dashboard returns 401; /api/order-status without credentials returns 404. These are preliminary boundary checks, not full authorisation acceptance.
- Domain MX points to smtp.google.com. SPF authorises Google and Purelymail; Purelymail ownership and DKIM records are present. Preserve incoming Google delivery. Purelymail account administration is also signed out. A DNS record is not proof of an active SMTP sender or inbox delivery.

## Coverage register

| ID | Area | Requirement | Scope basis | Status | Evidence | Environment/revision | Owner | Next action |
|---|---|---|---|---|---|---|---|---|
| B01 | Preservation | Retain approved site, brand and mail routing | Existing client scope | Implemented and verified | No public source, DNS or mailbox changes in this pass | Current working tree | Studio | Keep static release separate |
| B02 | Public design/navigation | Preserve seven-grade catalogue, policy and contact pages | Approved site | Not applicable | No visual changes in backend task | Public 276b336 | Studio | Existing release evidence remains separate |
| B03 | Enquiries | Preserve browser-composed quotation/contact mail | Existing scope | Not applicable | No enquiry-service changes | Current source | Studio | Do not equate mailto with delivery |
| B04 | Search/analytics | Preserve public indexing and no optional tracking | Existing scope | Not applicable | No new scripts, analytics or indexing changes | Current source | Studio | No tracking added |
| B05 | Data connectivity | Dedicated project accessible from runtime | Phase 1 | Failed | Invalid-code lookup 500; runtime fetch failed | Hosted preview | Studio | Sign in to correct project, inspect status and runtime configuration |
| B06 | School profiles | School/year/window/grade/price/access-code CRUD | Phase 1 | Implemented but unverified | Existing admin-schools and public-school handlers | Feature source | Studio | Authenticated database acceptance |
| B07 | Parent order | Multi-child validation and authoritative total | Phase 1 | Implemented but unverified | Existing RPC and order input tests | Feature source | Studio | Database-backed success, tamper, duplicate and closed-window tests |
| B08 | Staff access | Roles, sessions, login/logout, cross-user boundaries | Phase 1 | Implemented but unverified | requireStaff and preliminary anonymous 401 | Feature preview | Studio | Real authorised login and viewer/admin negative tests |
| B09 | Reports | School/year totals and paid learner CSVs | Phase 1 | Implemented but unverified | Existing exports and preview; no live query this pass | Feature source | Studio | Verify against real test records and final spreadsheet headings |
| B10 | Batches | Single-school paid-item snapshot and dispatch status | Phase 1 | Implemented but unverified | Existing batch RPC and API | Feature source | Studio | Test late orders, concurrent batch creation and cancellation |
| B11 | Email content | Minimal bilingual paid confirmation | Phase 1 | Implemented and verified | New order-mail unit tests, no child details or access tokens in template | Local source | Studio | Review rendered message with approved sender |
| B12 | Email worker | Authorised recipients, encrypted SMTP, conditional queue claim | Phase 1 | Implemented and verified | Eight new tests; fake transport and database only | Local source | Studio | Authenticated SMTP verification and controlled inbox test |
| B13 | Email operation | Scheduled hosted worker and confirmed delivery | Phase 1 | Launch/access pending | CLI worker prepared; MAIL_ENABLED false; no schedule activated | Local source | Studio | Access existing mail admin, configure sender; choose supported scheduler and verify without relying on laptop |
| B14 | Email failure | No silent duplicate resends after uncertain SMTP outcome | Operational safety | Implemented and verified | Ambiguous delivery marked failed for review; deterministic message ID; 8 mail tests | Local source | Studio | Add operational failed/stale-processing review; SMTP acceptance is not inbox receipt |
| B15 | Privacy/business rules | Approved operator details, retention, delivery/refund rules | Existing merchant scope | Client confirmation pending | Existing legal pages and 20 October readiness record | Feature/public source | Briljante | Consolidate outstanding facts; do not invent legal identity or policies |
| B16 | Payment integration | Verified hosted checkout and ITN handlers | Phase 1 | Implemented but unverified | Eleven passing local PayFast tests, provider mocked | Feature source | Studio/PayFast | Merchant choice/approval, sandbox credentials and end-to-end payment testing |
| B17 | Payment recovery | Cancel/retry, abandoned pending, refunds | Phase 1 | Not checked | Prior source audit identified cancellation/expiry/refund reconciliation gaps | Feature source | Studio | Finish recovery acceptance and operational handling before live activation |
| B18 | Security | RLS, secret boundary, abuse limits, delivered headers | Phase 1 | Implemented but unverified | Source boundary and negative unit tests; no current database advisors | Feature source | Studio | Authenticated project advisors and runtime boundary/abuse review |
| B19 | Continuity | Backup/restore, failure reporting, worker monitoring | Launch readiness | Not checked | No restore or mail scheduler observed | Dedicated project | Studio | Verify provider plan, backups, rollback/restore and failure ownership |
| B20 | Release/handover | Approved domain, gated payments and tested staff journey | Phase 1 | Launch/access pending | No live activation in this pass | Feature only | Studio | Resolve above and record acceptance before application cutover |

## Prepared mail operation

`api/_lib/order-mail.js` validates the configured sender, fixed parent/staff recipients and paid order state. It uses Nodemailer 10.2.1 with TLS/certificate verification and timeouts. Queue jobs are claimed using a conditional queued-to-processing update. No recipient can be supplied by an unauthenticated web request: no public send API was added.

`node --env-file=<protected-server-env> scripts/send-order-mail.mjs` verifies SMTP without sending. `--send` explicitly processes at most five existing queued paid-order notifications. Running this locally is not the final hosted schedule. SMTP server acceptance is recorded as sent, not claimed as inbox receipt. A worker crash or uncertain acceptance needs manual review; do not automatically reset processing/failed jobs to queued.

Remaining email service steps: use the existing approved sending provider, confirm a dedicated orders sender or existing authorised sender, configure server-side SMTP settings, test one explicitly authorised recipient, verify inbox/authentication, then enable a supported hosted schedule. Do not alter MX or migrate client mailboxes.

## Test result and next access action

44 automated tests passed (including eight mail tests); JavaScript syntax checks passed. These do not prove database connectivity, real SMTP authentication, inbox delivery, actual payment confirmation or scheduler execution. Dependency audit is recorded separately when completed.

Next: sign into the existing dedicated Supabase project and existing studio mail administration. Do not open new accounts or reset passwords. Diagnose and retest the current school lookup before claiming that PayFast is the only remaining dependency.

## Follow-up after recovering the dedicated account

The observations above are retained as the initial audit, not current completion claims. The user recovered the existing organisation nvivaqnivhbtiwproofg. Its Briljante project was paused; it was resumed on the existing free plan without a billing change. The dashboard subsequently reported restoration complete and Healthy.

Direct read-only SQL then established that public had no tables/functions, no migration-history table, and auth had zero users. Thus the historical claim that this project's application schema had been deployed was not supported by the actual database. The five existing migration sources were reviewed and installed in one transaction, creating 17 RLS-protected application tables. No existing application records were overwritten.

Two new source migrations apply the client-confirmed Grade 1/2 R320 price and original cover paths while retaining book IDs, and serialise batch allocation by locking the school's ordering period. Both were applied through the authenticated SQL editor. The rollback-only acceptance script was updated to include mandatory policy consent and test school batch allocation. It passed twice, covering authoritative R660 totals for two learners, paid-state processing, duplicate notifications, one-school batch allocation and rejection of duplicate allocation, and anon/authenticated role boundaries. These use a synthetic verified event inside a rolled-back transaction, NOT a real PayFast payment.

The hosted invalid-school-code lookup now returns the expected 404, not 500; anonymous admin dashboard remains 401. The existing deployment's database credentials therefore connect successfully after recovery and schema installation. No keys were rotated or exposed. Final read-only inventory checks are recorded in the conversation and saved proof.

Mail now has an event-driven hosted background path: after a verified COMPLETE notification is committed, @vercel/functions waitUntil retains the mail task beyond the HTTP acknowledgement. The task is scoped to that order, checks MAIL_ENABLED, validates the sender, claims queued jobs conditionally and closes its SMTP transport. The CLI remains a controlled recovery tool. No periodic automation or paid service was created. SMTP credentials and actual recipient inbox delivery are still unverified, and MAIL_ENABLED remains unset/disabled. Function timeout/crash and uncertain SMTP outcomes require queue review; this is not an exactly-once inbox delivery guarantee.

Latest local checks: 46 tests pass; dependency audit reports zero known vulnerabilities. No public marketing release or payment activation is included in this feature update.

Still outstanding, not PayFast dependencies: existing mail-admin sign-in and sender authentication/inbox test; first dashboard administrator approval and private password setup; authenticated application CRUD/report/export acceptance; final cancellation/retry/refund handling review; backup/restore and production availability decisions. A new action-time approval was requested before granting the first dashboard administrator role. Free-plan pause risk remains an operational consideration; no upgrade was purchased.

Schema installation via SQL Editor does not populate Supabase CLI migration history. Reconcile the checked-in migration baseline with the live project through the supported CLI workflow when authenticated CLI access is available; do not blindly reapply initial CREATE TABLE migrations.

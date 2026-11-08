# PayFast sandbox acceptance

27-28 October 2026, South Africa. Internal continuation record, updated through the 28 October provider and report checks below. Live payments remain disabled; only fictional Test School 1 records and the approved technical test mailbox are in scope. This record supersedes the payment-acceptance status in the historical 26 October requirements review.

## Starting state

- Resumed source checkpoint `e338838`; previous integrated checks: 212 passed across 77 JavaScript files.
- Stable preview initially pointed to `dpl_2VE5mH6FAsJP3EL1YpGHKEhAM7Gu`, containing the earlier callback/cancellation fixes. New recovery, refund and sandbox code was not deployed at the initial 27 October checkpoint.
- Dedicated database `cigyxjfzbjlgbrduzcpw`: PostgreSQL 17.6, initially zero real orders and three existing DEMO orders; refund ledger and sandbox-order function present. The atomic-checkout migration was subsequently applied and hosted rollback-only acceptance passed with fixtures removed by rollback.
- On 28 October, the authorised technical staff session restored automatically after the initial loading state. No credentials, authentication codes or user session tokens were retrieved by the agent.
- Public sandbox credentials rechecked against PayFast's current support page: https://support.payfast.help/portal/en/kb/articles/why-am-i-getting-a-merchant-id-merchant-key-error-20-9-2022 . These are provider-published dummy credentials, independent of the client's live merchant account.

## Changes and preview release

- `91cb511`: atomic checkout preparation prevents retry writes from resetting completed attempts. Paid/refunded states and original receipts are preserved; a distinct additional verified provider receipt is retained for reconciliation without duplicate paid mail or any automatic financial refund. Local and hosted rollback-only SQL acceptance passed.
- `1855a49`: source verification includes PayFast's officially published callback networks, retaining signature, merchant, amount and server-confirmation checks. The private order-status page can retry the same pending/failed order without creating another order. The 27 October deployment `dpl_F4sjVHFTrG2ShzRtCxHDqyzhzQ7h` was Ready and assigned to `https://briljante-preview-awaldstudio.vercel.app`; delivered script hashes matched source. Integrated regression: 220 tests passed across 78 JavaScript files.
- `b814f2e`: English/Afrikaans failed-payment text now points to the same-order retry; cancelled orders direct users to Briljante for assistance. Integrated regression: 221 tests passed. The subsequent preview was Ready, assigned to the stable alias, and delivered `assets/order-status.js` SHA-256 matched `2ebdc5d3cbeec501be28d52db6b42f671d635b10d35b6de9a6972f010cd7e413`.
- `af6015b`: administration requests now use canonical trailing-slash API paths directly, retaining methods, payloads and query strings. The full regression passed 222 tests across 79 JavaScript files. Preview `dpl_F8C8xrnMUvnCGAXywmUZpmBDZNLW` (`https://brilijanteboeke-c0c41fnlv-awaldstudio.vercel.app`) was Ready and assigned to the stable preview. Delivered `assets/admin-app.js` SHA-256 matched source: `1ea191ee10bfd62490a2a94d82fe7276a547d5fb02eec8f755378877faa56873`. The redirect was not established as the cause of the shipping stall; a repeat on the canonical-route release still left the batch Created with no notification jobs. Do not claim the shipping issue fixed from this change.

All releases above are restricted previews. No production release, DNS change, live payment activation, client merchant-account creation or real financial refund was performed.

## Genuine provider checks

### 27 October: rejected source address

Fictional order `DEMO-BB-26-DC1616C3` contains two learners and totals R660. PayFast dummy-wallet receipt `3478875` returned COMPLETE, but the callback failed only `source_ip_invalid`. Signature, merchant, amount and server confirmation passed. The application correctly kept the order unpaid and did not queue paid-confirmation mail. This order remains unpaid on 28 October; provider success alone was not treated as application acceptance.

The source check was corrected using PayFast's published callback infrastructure ranges, including `144.126.193.139`, while retaining all other verification checks. References: https://developers.payfast.co.za/docs?capcode=xMzF#ports-ips and https://support.payfast.help/portal/en/kb/articles/what-ip-addresses-does-payfast-use-20-9-2022 .

### 28 October: cancellation, same-order retry and verified payment

New fictional order `DEMO-BB-26-6756F827` contains Sandbox Three Acceptance (Grade 1, R320) and Sandbox Four Acceptance (Grade 5, R340), total R660. An actual PayFast sandbox cancellation returned to the application's pending state. The private status-page retry reopened payment for this same order.

The subsequent genuine dummy-wallet COMPLETE receipt `3480217` was verified from source IP `144.126.193.139` at `2026-10-28T07:07:51.47679Z` (09:07:51 South African time). The canonical order became `paid`, its attempt became `complete`, and exactly two confirmation jobs were recorded: parent and staff. Both jobs recorded SMTP acceptance to the approved `technical@awaldstudio.com` test mailbox. Both messages were then independently opened in that mailbox: recipient technical@awaldstudio.com, sender orders@briljanteboeke.co.za, valid sender-domain signature, correct learners/reference/R660. The staff message also shows nine paid books and R2,960 simulated paid value. Screenshots: task outputs `payfast-acceptance-2026-10-28/parent-confirmation-inbox.png` and `staff-confirmation-inbox.png`.

The provider sandbox moved no real money. Repeated/late callbacks, wrong signatures/amounts, terminal-state retention and duplicate receipts have regression/SQL evidence; those fixtures are distinct from the genuine provider run above.

## Dashboard, exports and staff screens

- Authenticated dashboard: four paid orders, R2,960 simulated paid total, nine paid books and one pending order. The pending 27 October order is excluded from paid totals.
- Actual 28 October school XLSX and PDF downloads contain nine learner rows and four distinct paid-order references. New reference `DEMO-BB-26-6756F827` appears twice with the correct Grade 1 and Grade 5 learners. Unpaid `DEMO-BB-26-DC1616C3` is absent. Grade counts: Grade 1 = 5, Grade 4 = 1, Grade 5 = 2, Grade 6 = 1.
- The school XLSX contains one `Paid learner register` sheet, nine learner rows at 11-19, and `D21 = SUM(D11:D19) = 9`. Parent email/phone/contact fields are absent from both school exports. These registers contain no financial amounts, so R2,960 is established by the dashboard check, not inferred by multiplying learner rows.
- The actual PDF is one A4 landscape page. Every page and the workbook render were inspected: both logos, full names, references, workbook descriptions and dates are readable without clipping or overlap. Evidence and file hashes: task workspace `outputs/payfast-acceptance-2026-10-28/report-review/verification-result.json`, with rendered proof in the same directory. Original downloads were unchanged.
- The hosted refund-recording dialog was inspected for the new verified payment. It displays the correct original receipt/full amount and warns that it records an externally completed refund. No external refund was completed or recorded. A dispatched/delivered allocation correctly blocks this recording action.
- Self-service recovery has automated and synthetic-rendering evidence. Private hosted completion of recovery mail, existing-authenticator verification and password mutation remains pending; the agent did not change credentials.

## Shipping checkpoint

New batch `a5e58cc9-08e2-4262-8f97-9339cc9bbc41` was created with the new order's two books. Its last confirmed stored state at this checkpoint is Created. A requested dispatch left the selection disabled without a logged PATCH; diagnosis and canonical-state verification remain in progress. No dispatch/delivery email for this new batch is claimed.

Existing batches were found at the start of the 28 October check: `5bfa...` Delivered with four books and `f642...` Dispatched with three books, showing sent counts. They were left unchanged. These historical counts do not establish new-batch or actual inbox acceptance.

## Client/provider correspondence and backup status

- At 07:00 South African time on 28 October, Lindie reported uploading FICA documents. At 08:39, Monray asked which email address was registered. Submission is client-reported; completed FICA, merchant approval, enabled methods and settlement readiness have not been confirmed. The registered merchant email must be confirmed before the requested provider follow-up; no follow-up was sent by this task.
- The dedicated Supabase scheduled-backup dashboard was checked on 28 October and explicitly states **Free Plan does not include project backups**, offering a Pro upgrade with seven days of backups. No upgrade was performed. The current project therefore has no included automatic provider backups established by this check.
- A local encrypted synthetic PostgreSQL restore rehearsal already passed; it is not a backup of hosted client data. An actual encrypted hosted backup remains pending secure existing database credentials/access, together with Storage file-byte coverage, key recovery and an off-device copy. No database password was reset.

## Required service evidence

| Check | Current state |
| --- | --- |
| Expanded source and SQL regression | Verified at deployed `af6015b`: 222 tests; hosted atomic-checkout/refund/sandbox rollback acceptance passed. Eight focused refund tests rerun successfully during the subsequent completeness review |
| Preview deployment and delivered source verification | Verified through `af6015b`, latest deployment and delivered source hash recorded above |
| Genuine PayFast dummy-wallet checkout and validated notification | Verified on 28 October: receipt `3480217`, correct source/signature/merchant/amount/server confirmation, paid order and complete attempt |
| Correct pending/paid/cancelled/retry behavior | Actual cancellation return stayed pending, same-order retry worked, verified payment became paid; other failure/duplicate/late-event states have regression and rollback-only SQL evidence |
| Parent and staff messages for the verified sandbox order | Both SMTP outcomes and actual technical-inbox receipt verified; correct recipients, line items, amounts, progress and sender-domain signature |
| Dashboard and downloaded school reports agree with the new order | Verified: four paid orders/R2,960 on dashboard; nine books/four references in actual XLSX/PDF, correct new learners and pending-order exclusion |
| Grouped dispatch/delivery notifications | New two-book batch Created; dispatch diagnosis in progress. New-batch send and inbox acceptance remain pending |
| Recovery and refund-recording screens | Hosted refund dialog verified; no refund recorded. Recovery private hosted completion still pending; synthetic/automated checks already passed |
| Actual hosted client-data backup and provider retention | Free Plan dashboard confirms no included project backups; no upgrade performed. Actual hosted encrypted backup pending credentials/access; local synthetic restore already passed |
| Client merchant signup, FICA, methods and supplier information | Lindie reported FICA upload; Monray requested registered email. Approval, methods, settlement and supplier information remain client/provider confirmation pending |
| Approved low-value live payment/refund/settlement | Pending after sandbox acceptance and merchant approval |

Automated tests, synthetic restore, SQL-inserted payment events, genuine provider acceptance, SMTP acceptance and inbox receipt remain distinct evidence. No checklist total or sandbox outcome establishes production readiness or a guarantee that every possible failure has been tested.

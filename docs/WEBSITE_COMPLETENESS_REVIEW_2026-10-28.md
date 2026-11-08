# Website completeness and refund-management review

28 October 2026. Source `af6015b`; read-only source/provider review plus the prior same-day acceptance evidence. This is an itemised gap review, not a production sign-off. The current request asks what exists and describes a desired parent-management workflow; no such new workflow was silently implemented during this review.

## Verified and remaining work

The restricted preview has a genuine verified PayFast dummy-wallet payment, cancellation and same-order retry, received parent/staff messages, reconciled dashboard and actual school XLSX/PDF downloads. The integrated source check passed 222 tests. Eight focused refund tests were rerun successfully. See `PROVIDER_ACCEPTANCE_2026-10-27.md` for exact receipts/deployments and test boundaries.

Remaining: new-batch dispatch/delivery acceptance (last confirmed state Created, no notification jobs), complete private hosted recovery, an encrypted backup of hosted data and Storage with recoverable independent key/off-device copy, confirmed supplier particulars and approved operating policies, accepted payment methods/artwork, merchant verification and live payment/refund/settlement acceptance. Final physical-device/browser/accessibility/performance and release checks retain their previously recorded limits.

Current public HTTP probes: `https://www.briljanteboeke.co.za/` = 200; public `/order/` and `/admin/` = 404; stable preview `/admin/` = 200/noindex. The application is still a preview, not the released public ordering system.

## CAPTCHA and abuse protection

No Google reCAPTCHA/Turnstile integration exists in the application. Neither Monray's email nor the reviewed PayFast custom-integration/website terms establishes a requirement for Google reCAPTCHA specifically. Google describes it as an anti-spam/abuse tool and requires server-side verification; adding a visible checkbox alone would not protect the backend.

Staff authentication and restricted demonstration/sandbox submission have persisted request limits. Ordinary live guest order creation in `api/orders.js` and its `create_school_order` RPC do not currently enforce an application-level submission quota. Validation, maximum learner count, private order tokens, authoritative amounts and idempotency exist, but they do not replace abuse throttling. Before public activation, implement dedicated server-side public-order/checkout limits with proportionate bot checks and test legitimate shared-school/network use. A bot challenge is an optional additional control, not proof of payment or a replacement for authorization. No external bot provider/account or tracking was added.

## Refund and parent management

| Capability | State |
| --- | --- |
| Search orders by reference, parent surname/email and status/school/period | Implemented |
| View parent contact, children, school, amount and payment state | Implemented |
| Parent profile across orders / staff contact or learner editing | Not implemented |
| Parent online refund request, review queue, approve/reject and decision messages | Not implemented; current terms direct parents to email Briljante |
| Record an already completed full-order PayFast refund | Implemented; administrator-only immutable audited reconciliation, no money moved |
| Partial refund / one child in a multi-child payment | Not implemented |
| Automatic PayFast refund from the application | Not implemented |

Synthetic local and hosted rollback acceptance verifies refund recording, original receipt/amount/date evidence, idempotency, permissions, batch/mail blocks, paid-report exclusion and late-callback terminal state. The hosted dialog was inspected. No genuine PayFast sandbox refund was completed; no request-to-approval journey could be tested because it does not exist.

The requested extension should provide a private order-linked refund request (never order-reference-only authorization), a searchable staff order/parent detail view, administrator review notes/approve/reject, separate approved/pending-payment/completed states, actual provider evidence before completion, and request/decision/completion notifications. Staff detail corrections need a reason and before/after audit without rewriting the original payment/consent record or frozen dispatch snapshot. Workbook, grade, quantity and financial changes need a distinct reviewed workflow. Partial versus whole-order refunds must be specified before representing partial support.

## Current provider obligations

Primary references reviewed:

- https://support.payfast.help/portal/en/kb/articles/verify-your-account-20-9-2022
- https://support.payfast.help/portal/en/kb/articles/how-to-set-up-and-test-your-payfast-integration-as-an-aggregator
- https://payfast.io/legal/general-terms-conditions/ (updated November 2025), Schedule 1 sections 1.4, 1.7 and 1.9
- https://developers.payfast.co.za/docs
- https://developers.payfast.co.za/api#refunds
- https://developers.google.com/recaptcha/intro
- https://developers.google.com/recaptcha/docs/verify

The provider's published website conditions cover product descriptions, an affirmative refund/returns acceptance within checkout, customer-service email, currency, export/delivery policy, domicile, approved accepted-card artwork and payment-data security information. Source has substantial coverage, but confirmed business particulars and account-enabled/approved payment artwork remain open. Do not advertise unconfirmed methods.

The current terms also mention regular transaction reconciliation (Schedule 1 section 1.7), quarterly ASV and annual web-application scans (1.9). Exact applicable merchant/card-security obligations, responsibility, accepted evidence and any charge must be confirmed with PayFast for this hosted-checkout Aggregation account. These scans have not been performed or purchased; do not assume that a successful payment or FICA verification certifies the website's security or all business workflows.

PayFast merchant verification reviews submitted identity/business/address/bank evidence and communicates an account-verification result. Payment integration separately validates submitted merchant/transaction parameters and sends payment notifications; our backend verifies the notification before marking paid. Public documentation does not establish a complete audit of our private database, source code, reports or every management feature. Only PayFast can confirm its account-specific review result and any further requirements.

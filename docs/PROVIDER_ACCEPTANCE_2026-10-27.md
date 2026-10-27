# PayFast sandbox acceptance

27 October 2026, South Africa. Internal verification record. Live payments remain disabled; only fictional Test School 1 records and the approved technical test mailbox are in scope.

## Starting state

- Resumed source checkpoint `e338838`; previous integrated checks: 212 passed across 77 JavaScript files.
- Stable preview initially points to `dpl_2VE5mH6FAsJP3EL1YpGHKEhAM7Gu`, containing the earlier callback/cancellation fixes. New recovery, refund and sandbox code was not deployed at resumption.
- Hosted dedicated database `cigyxjfzbjlgbrduzcpw` rechecked today: PostgreSQL 17.6, zero real orders, three existing DEMO orders; refund ledger and sandbox-order function present.
- Yesterday's technical application session expired. The user has been asked to sign in privately again; no credentials, authentication codes or user session tokens are retrieved by the agent.
- Public sandbox credentials rechecked against PayFast's current support page: https://support.payfast.help/portal/en/kb/articles/why-am-i-getting-a-merchant-id-merchant-key-error-20-9-2022 . These are provider-published dummy credentials, independent of the client's live merchant account.

## Current work

An additional review found that checkout retries could overwrite a completed payment attempt after its order-status read. Atomic checkout preparation and terminal paid-state preservation are being added and independently tested before deployment. Distinct extra provider receipts must remain visible as reconciliation evidence; no automatic financial refund is performed.

## Required service evidence

| Check | Current state |
| --- | --- |
| Expanded source and SQL regression | In progress for the additional retry correction |
| Preview deployment and delivered source verification | Pending |
| Genuine PayFast dummy-wallet checkout and validated notification | Pending |
| Correct pending/paid/cancelled/retry behavior | Pending hosted run |
| Parent and staff messages for the verified sandbox order | Pending SMTP and actual inbox checks |
| Dashboard and downloaded school reports agree with the new order | Pending |
| Grouped dispatch/delivery notifications | Pending actual test-mail acceptance |
| Recovery and refund-recording screens | Pending hosted checks; synthetic checks already recorded |
| Actual hosted client-data backup and provider retention | Pending secure existing database credentials/access; local synthetic restore already passed |
| Client merchant signup, FICA, methods and supplier information | Client/provider confirmation pending |
| Approved low-value live payment/refund/settlement | Pending after sandbox acceptance and merchant approval |

The table will be updated only from observed results. Automated tests, synthetic restore, SQL-inserted payment events, SMTP acceptance and inbox receipt are distinct evidence.

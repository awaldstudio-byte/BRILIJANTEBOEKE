# Completed full-refund reconciliation

This feature records a full refund already completed in PayFast. It has no financial refund API, moves no money and sends no email. Partial refunds, returns after dispatch/delivery, and reopening refunded orders are outside this action.

An administrator opens **Record completed refund** beside an eligible paid order, checks the original amount and PayFast transaction, and enters the completed refund confirmation reference, completion time and reason. The user must explicitly confirm external completion and confirm the recording before submission. English/Afrikaans copy is available. Viewers and the static sample-data preview have no recording action. Existing simulated DEMO orders without a completed PayFast attempt have no action either.

`POST /api/admin-orders/` with action `record-full-refund` requires administrator authorization and the configured same origin. The trusted actor comes from the staff session. `record_completed_full_refund` also checks the actor's current active administrator approval. It requires one completed attempt with matching full amount, original provider transaction, sandbox/live mode and a verified COMPLETE event.

The database transaction locks the ordering period (shared with batch creation), payment attempt/order and confirmation jobs. It blocks active batches, any historical dispatch/delivery, and an in-flight confirmation email. Cancel an unshipped batch through the normal fulfilment workflow first. Dispatched/delivered orders require an operational returns/refund review; this feature does not silently rewrite frozen allocations.

The immutable private `order_refunds` ledger, order/payment state change, queued-confirmation suppression and audit record commit together. Exact repeats return the existing result; changed repeats and reused confirmation references fail. Refunded orders drop out of existing paid-only financial totals, progress and paid learner reports. Cancelled batch reports remain historical frozen snapshots. Terminal triggers retain refunded status on late COMPLETE/FAILED/CANCELLED notifications and preserve the refunded payment's original provider reference.

## Validation and rollout

- Supabase CLI 2.121.0 generated `20261026145309_record_full_refund_reconciliation.sql`. Apply it before deploying the API, whose order listing includes the new ledger relation.
- Eight focused handler/input/UI-renderer checks pass with `node --test test/refund-reconciliation.test.js`.
- `test/refund-reconciliation-acceptance.sql` passes on isolated PGlite 0.5.12 PostgreSQL with synthetic fixtures, both as database owner and as `service_role`. It checks transactional states/audit, exact repeats/conflicts, amount/provider/date checks, original verified-payment evidence, batch/mail blocking, late callback terminal states and narrow RLS/grants. Test writes roll back to the original synthetic count.
- The isolated bootstrap uses the relevant existing migrations; only the initial unused pgcrypto extension declaration is omitted because built-in UUID generation suffices for these tests. This is SQL behavior verification, not a hosted provider test or a concurrency stress test.
- No live migration, refund, email or deployment was performed by this implementation subtask. Root must run the rollback-only acceptance against the dedicated project after migration, inspect the rendered dialog in the application, and include the feature in the final integrated check.

Current Supabase changelog and database-function/RLS guidance were reviewed: https://supabase.com/changelog.md, https://supabase.com/docs/guides/database/functions, https://supabase.com/docs/guides/database/postgres/row-level-security. The relevant PostgreSQL extension/cipher changes do not affect this feature's relational/locking operations. The new RPC uses SECURITY INVOKER with an empty search path; anonymous/authenticated execution and table access are revoked, and the server role receives only SELECT/INSERT on the new ledger.

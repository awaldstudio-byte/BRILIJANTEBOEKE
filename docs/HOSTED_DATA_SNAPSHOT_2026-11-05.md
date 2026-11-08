# Encrypted hosted data snapshot

This is a fallback for the dedicated Briljante project while its existing PostgreSQL password is unavailable. It performs a read-only SQL export using the authenticated project dashboard. It does not reset credentials, create a database role, change hosted schema, or start a paid service.

## Scope and limits

The export includes every non-partition-child table in `public`, `auth` and `storage`, plus migration history when present. Partition parents include their child rows. It also includes table columns, constraints, indexes, triggers, policies, ACL/owner/RLS metadata, application/managed-schema function definitions, views, enum labels, sequence metadata and extension versions. Each table has an exact PostgreSQL JSONB data digest. The only key supplied to the server is a dedicated public encryption key; plaintext rows do not enter SQL-editor results, CSV files, application output or logs.

This is **not a `pg_dump` archive or a full Supabase service backup**. It omits Storage file bytes, other schemas such as Vault/Realtime, cluster role passwords, provider encryption roots, service configuration, network settings, mail settings and source files. The local recovery check preserves all exported managed-schema data in a JSONB archive, but it does not start Supabase Auth/Storage services. It rebuilds the known application schema from source, verifies exact public table columns/types, restores actual application rows into typed tables, validates all application foreign keys, and compares every public table's data digest. This proves application-data recovery into the named local PostgreSQL schema, not hosted account/session/MFA or full-platform restoration.

The retained private key is Windows DPAPI CurrentUser protected in a separate owner-only directory. It requires this Windows identity and machine. An independent secure recovery-key copy and off-device archive remain operational requirements; a DPAPI file alone does not survive loss of the Windows identity/machine. No recurring task or cloud copy is created by these scripts.

## Commands

1. `node scripts/prepare-hosted-snapshot.mjs --output-dir ABSOLUTE_PRIVATE_DIRECTORY --key-dir SEPARATE_ABSOLUTE_PRIVATE_DIRECTORY` creates the public-key SQL export and the owner-protected private key. Both directories must be outside the repository. Inspect the generated `inventory.sql` result first; this approach is intended for the currently small project, not a large database export.
2. Run `encrypted-export.sql` as a read-only query in the correct project's SQL Editor. Download **all rows** as CSV. The columns are `part_no,total_parts,encrypted_sha256,encrypted_chunk`; the verifier rejects missing/duplicate chunks, mismatched totals or checksums.
3. Run `node scripts/verify-hosted-snapshot.mjs --input ENCRYPTED_CSV --key-file DPAPI_KEY --work-dir NEW_PRIVATE_DIRECTORY --pg-bin PG17_DIRECTORY`. If hosted migration history is absent, supply the independently identified source boundary, currently `--through-migration 20261027112816`. This is recorded as an explicit source boundary rather than verified migration history, and actual public columns/types must still match.
4. Read the aggregate-only `recovery-result.json`. Require `passed:true`, matching table digests and application foreign-key validation. The encrypted PGP archive is retained. The plaintext payload remains in process memory and a temporary owner-only, loopback PostgreSQL cluster; the cluster is stopped and removed after the exercise. Sensitive SQL diagnostics are suppressed. The script cannot target a hosted database for restoration.

The fingerprint in the recovery report records captured schema metadata; definitions/ACLs remain inside the encrypted snapshot for review. It is not a claim that every managed role, trigger state or service setting was recreated.

## Synthetic acceptance

`scripts/snapshot-rehearsal.mjs` exercises the complete public-key export and recovery flow against a disposable native PostgreSQL 17 fixture. On 5 November it passed all six checks over 26 tables, including all 23 public application tables, exact large-number and XML-character preservation, foreign-key restoration and ciphertext-tamper rejection. Evidence: `C:\Users\natha\.codex-private\briljante-backups\snapshot-roundtrip-20261105-b\recovery\recovery-result.json`. This fixture evidence is separate from any actual hosted export and must never be described as the current client backup.

Prepared actual-host export SQL: `C:\Users\natha\.codex-private\briljante-backups\hosted-20261105\encrypted-export.sql`. It has not been executed by this preparation task.

Official references reviewed: [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [Supabase backup API](https://supabase.com/docs/reference/api/v1-list-all-backups), [PostgreSQL pgcrypto public-key encryption](https://www.postgresql.org/docs/17/pgcrypto.html). Supabase recommends CLI/pg_dump exports for Free projects and notes that database backups omit Storage object bytes. The custom snapshot above is a documented recovery fallback, not a replacement claim for the provider's supported dump format.

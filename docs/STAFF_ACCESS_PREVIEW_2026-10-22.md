# Staff access preview: 22 October 2026

## Subsequent approved policy: optional initial authenticator setup

After the mandatory-MFA preview below, Nathan explicitly approved a Set up later option after the reduced protection was explained. This supersedes the earlier requirement for every staff member to enrol MFA. Mailbox proof, password setup, active approval, validated provider identity, private application sessions and role checks are unchanged. No domain-wide signup, client invitation or live payment was added.

Users without a verified factor may defer after verified password setup. Account security in the dashboard lets them enable it later; subsequent password logins do not repeatedly force enrolment. Users with any verified factor cannot use the skip endpoint, and protected APIs still require verified TOTP/aal2 for enrolled users. An unverified QR enrolment is not treated as enabled; skipping never removes factors. Ready sessions and email-only setup sessions cannot use the skip endpoint to renew or promote themselves. Fresh provider identity is rechecked before deferral. There are no new database tables or grants, and the legacy staff_users directory remains unused.

Verification for this change: 87 automated tests pass; the loopback-only synthetic UI fixture exercised initial deferral, dashboard entry, Account security, later setup and an enabled status. The setup choice was visually checked on desktop, 768px tablet and 320px mobile with no horizontal overflow at the latter two sizes. No live authenticator key or code was viewed. Live personal setup and account recovery still need the user's own acceptance. No real setup email was sent as part of this change.

## Implemented

The preview has an email-first sign-in page in English and Afrikaans, retaining the approved Briljante branding. There is no public signup or automatic approval for a domain. Only individually approved, active addresses may receive setup codes. The initial approval is technical@awaldstudio.com; no client invitations have been sent.

Supabase Auth generates and verifies the expiring, single-use email codes and manages passwords and authenticator factors. An approved first-time user verifies the mailbox, privately sets a strong password, then privately configures an authenticator. The server requires verified MFA, an active approval and an unexpired application session before any staff API or export. Passwords, codes and authenticator secrets are never saved in browser storage or application logs.

Setup codes use the orders@briljanteboeke.co.za encrypted SMTP sender through AUTH_MAIL_ENABLED, separate from MAIL_ENABLED=false. Unknown addresses receive the same generic public response but no email. Requests and code attempts have shared database-backed limits. Setup stages expire after 15 minutes. Remembered ready sessions have a 30-day absolute deadline; other ready sessions have an eight-hour deadline and browser-session cookies. Sign-out revokes the application session, not just its cookies. Password changes revoke other application sessions.

The private staff_access_approvals directory is authoritative. This implementation deliberately never activates the legacy staff_users directory: older immutable previews use that directory without the new MFA/application-session gate. Keep legacy staff_users empty and do not grant new users there. The live acceptance test verifies this condition. Historical deployments should still be retired or protected before production handover.

The existing preview=1 demonstration remains sample-only and now visibly identifies itself. It cannot access actual records without the protected APIs. For real access testing use /admin/?lang=en without preview=1.

## Verification before hosted release

- All 71 automated tests pass; 39 JavaScript files pass syntax checks.
- The new migration was installed on the dedicated project cigyxjfzbjlgbrduzcpw. It adds four private, RLS-enabled tables and two service-only functions. Only the approved technical address was seeded.
- Rollback-only live database acceptance passed: private RLS/table/RPC permissions, durable quotas, five-attempt code limit, used-code replay denial, expiry denial and an empty active legacy directory.
- Desktop and 390px mobile front-end layouts were visually reviewed; labels, password-manager autocomplete, keyboard focus and no horizontal overflow were checked. MFA secrets must not appear in screenshots.

## Human testing and remaining boundaries

The hosted preview was verified to return 200/no-store for the login page, 401/no-store for unsigned dashboard, school, order, fulfilment and export requests, 403 for a cross-site login request, and 404 for internal code and environment paths. A controlled setup request reached the email-code screen and generated the approved technical identity. The initial application grant is still incomplete; no private password or MFA step was submitted by the agent. Delivery status is now recorded as sent only after SMTP accepts the intended recipient, not before sending. SMTP acceptance is not proof of inbox placement.

Final preview deployment: dpl_Bza3Ce6ReSF6Zb3GZo3yNbV9boLY, Ready, source commit 5a79fd4. The stable alias https://briljante-preview-awaldstudio.vercel.app points to it. A second controlled setup-code request on the final deployment recorded sent with zero attempts, confirmed identity linkage and incomplete setup. Use only the latest code; no client emails were sent. Unsigned dashboard/export rejection was rechecked on this final alias. Actual inbox placement and the user's private setup remain unverified.

The user must personally enter verification codes, choose/submit passwords and configure the authenticator. Those private steps have not been completed by the agent. Do not claim end-to-end authenticated access, inbox delivery, lost-device recovery or live CRUD/export acceptance until actually tested.

This preview does not publish the application to the client's main domain or enable PayFast/live payments, paid-order emails, client accounts or richer order-summary templates. Production readiness also requires provider-admin MFA/recovery review, backup/restore and availability decisions, and migration-history reconciliation. The provider's paid leaked-password feature has not been purchased.

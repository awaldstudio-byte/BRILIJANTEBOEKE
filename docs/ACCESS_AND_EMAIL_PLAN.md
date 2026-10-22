# Staff access and automated email requirements

Latest approved access policy, 22 October 2026: Nathan approved optional initial authenticator enrolment after its security trade-off was explained. Set up later is available only before a factor is verified. Enrolled accounts must still complete their challenge at login. Account security provides later enrolment; no MFA disable/removal control has been added. Approved-email, mailbox verification, password and server-side session/role checks remain compulsory. This supersedes earlier mandatory-enrolment language below; see STAFF_ACCESS_PREVIEW_2026-10-22.md for implementation and tested boundaries.

This is an implementation and acceptance plan, not a statement that these flows are complete.

## Source decisions

The user approved technical@awaldstudio.com as the studio's full dashboard administrator and an internal setup/test recipient. No client invitations or messages are authorised by that test approval. The user requested managed password handling and an approved-email, first-time setup flow.

The referenced conversation, Automated Email Format Feedback (6ada2bd8-d96c-83ea-8ad0-2b5dddbf1638), was read on 22 October 2026. Its user messages specify the requirements below. Its attached progress-bar image was inspected. The retrieval did not expose the assistant's final draft as text, so that exact copy is not an approved implementation source here.

## Managed staff authentication

- Retain Supabase Auth for password hashing, password verification, recovery and multi-factor authentication. Do not build a password store or put plaintext passwords in application tables, logs, email, source or support correspondence.
- Staff approval is separate from authentication. Continue server-side staff allow-list and role checks for every protected operation. An Auth user or a hidden frontend view is not permission to access school, order, learner or export data.
- Email is the first visible step. Do not disclose whether arbitrary email addresses are approved or have completed setup. Use a neutral response and an equivalent failure path for unknown/inactive accounts.
- A first-time approved user must prove control of the approved mailbox using a provider-generated, expiring, single-use setup/recovery link before choosing a password. Merely typing a known address cannot grant setup access. No public self-registration or automatic approval.
- Complete setup/recovery on an allow-listed application route. Reject expired, replayed or substituted tokens; remove credentials from the address bar; do not log tokens or send them to analytics. Guard against email-scanner consumption and login-CSRF/session substitution.
- Enforce the provider password policy as well as helpful frontend validation. Support password managers and long passphrases. Do not email or display an administrator-selected password.
- Require verified multi-factor authentication for staff-data access, including API routes and exports, not only the screen. An authenticated but first-factor-only session may access only the tightly scoped setup/challenge flow. Test enrolment, challenge, lost-device recovery and revocation before activation.
- Use secure, HttpOnly, appropriately same-site cookies; verify authenticated users and active staff roles on the server. Bound requests and abuse rates, avoid sensitive error logs, and test sign-out, disabled users, expired sessions, refresh, CSRF and cross-account access.
- Organisation/hosting/mail provider administrator accounts are separate security boundaries. Verify their MFA and recovery arrangements independently, without resetting credentials or buying a plan automatically.

### Live provider settings saved on 22 October 2026

In the dedicated project cigyxjfzbjlgbrduzcpw:

- Public self-registration disabled; anonymous sign-in and manual identity linking remain disabled.
- Email confirmation and secure email changes remain enabled.
- Minimum password length set to 16 characters.
- Secure password changes enabled.
- Email OTP/setup/recovery link expiry set to 900 seconds.
- Provider UI shows leaked-password protection requires Pro or above. It was not enabled and no upgrade was purchased.

These settings do not establish that the custom onboarding, MFA enforcement or provider-administrator MFA is implemented. Full access remains pending tested onboarding and explicit staff linkage. Do not submit the earlier manual create-user/password form as a substitute for the approved flow.

## Order emails

Sender: orders@briljanteboeke.co.za. Preserve existing Google MX/incoming mail and use info@briljanteboeke.co.za as the reply destination unless the client approves a different route. The newly created Purelymail orders mailbox does not establish external incoming delivery while MX remains at Google.

Use the existing Briljante logo, navy/turquoise styling, readable HTML tables and inline styles, with a complete plain-text alternative. Progress bars are supplementary; exact numeric totals must remain legible when images/CSS are blocked. Outlook/Gmail/mobile tests and a controlled inbox test remain necessary.

### Parent receipt

- Payment received, verified order reference, payment date, school, parent name, their own learner name/grade, ordered Afrikaans workbooks and order total.
- Only that parent's order data. Never include other schools' figures, other parents or other learners.
- Distinguish verified payment from dispatch or delivery; no unsupported shipping promise.

### Briljante staff notification

- The current verified order's reference, school, parent, learners/grades, individual Afrikaans workbook lines and total.
- Overall paid individual workbook quantities by Grades 1-7, shown as paid / expected and percentage where an expected quantity exists.
- The same counts and allocations grouped by school and participating grade.
- No awaiting-processing section, per the user's decision; batch/dispatch management remains in the dashboard.
- Count book quantities, not parent transactions. Include only verified paid orders in paid totals; do not describe a successful browser return as payment verification.
- Scope totals to the triggering order's academic year, identify that year and timestamp the snapshot. Historical academic years must not inflate current progress. Define and test reopening/multiple periods, refunds, inactive offerings, missing expectations and orders above expectations.
- Use server-side aggregation, not fabricated values or browser state. Do not silently truncate at a database API row limit. Record whether the snapshot is payment-time or sending-time and label it truthfully; delayed messages must not imply historical totals were captured when they were not.
- A missing denominator must be shown as not supplied, not as 0% or a claim that no further books are expected. Preserve an actual count above the expectation; clamp only the decorative bar.
- Send overall/school summaries only to explicitly authorised staff recipients. Fixed server configuration, not request input, controls recipients. Treat forwarding of learner details as an operational privacy risk.
- Escape every dynamic HTML value, prevent header injection, and never include school access codes, service keys, passwords or session tokens.

## Current email readiness

Both technical@awaldstudio.com and orders@briljanteboeke.co.za were observed in Purelymail Users after the user saved them. SPF and DKIM authorise Purelymail sending; incoming Briljante MX remains smtp.google.com. No mail routing was changed.

Preview-only sender configuration was saved on branch codex/phase1-foundation: MAIL_FROM, MAIL_REPLY_TO, SMTP_HOST, SMTP_PORT and SMTP_USER. MAIL_ENABLED=false. The user subsequently saved SMTP_PASSWORD as a protected, preview-branch-only secret. Its value was not retrieved. No confirmation has been sent.

A build-only TLS/SMTP authentication probe was added under api/_lib/check-smtp.js, triggered only by explicit SMTP_VERIFY_ON_BUILD=true in a preview build. It calls verify(), never sendMail(), creates no public diagnostic endpoint, and logs only fixed messages and allow-listed error codes. It never enables runtime mail or downloads the protected secret. Four new tests pass (50 total). The optional postinstall hook does nothing without the explicit flag.

The one controlled hosted check, deployment dpl_HEa2rZi5r13v4G9nHbXw4h3juNTs (22 October 2026, 17:53 UTC), reached the provider but failed EAUTH. No email was sent and the unsuccessful deployment was not promoted. A fresh inspection of the orders mailbox still showed no saved App Passwords entry. Authentication is failed, not verified; privately provision/save the SMTP-only key and replace the protected value before another authorised check. Do not reset the ordinary mailbox password or blindly retry the rejected credential.

Subsequent result, 22 October 2026 at 17:58 UTC: after the user saved the generated credential, the orders mailbox showed an app password named VERCEL with SMTP selected and IMAP, POP3, DAV and Sieve unselected. Vercel showed the replacement secret saved for the preview branch. One new authorised hosted check on dpl_8pPFWCnfQRogcrYKZ1RAQs1DUGNE succeeded: `SMTP check: authenticated over verified TLS; no email sent.` The deployment is Ready. This supersedes the sender-authentication failure, not the record of the first attempt. SMTP authentication is now implemented and verified on that preview; inbox receipt, actual delivery and custom Auth onboarding are not verified. MAIL_ENABLED remains false.

The existing paid-order mail code is still the earlier minimal plain-text version. The HTML templates, richer order details and progress summary described above are not implemented yet. Do not present that source or this plan as a completed branded email.

## Acceptance gates

1. Provision a send-only SMTP credential privately and install it only in the approved protected hosting/provider configuration. Never paste it into chat or source.
2. Complete and test managed invite/setup, password reset and MFA; verify server-side rejection of first-factor-only, unknown, disabled and expired accounts.
3. Implement staff-only aggregates and branded parent/staff templates, with tests covering data separation, quantities, years, missing denominators, HTML injection and failure outcomes.
4. Send one authorised internal test, verify inbox receipt and sender authentication, and review desktop/mobile and plain-text rendering. SMTP acceptance alone is insufficient.
5. Test the real authenticated school/order/export journey. Keep payment processing gated until PayFast acceptance is complete.

No system is guaranteed unhackable. Managed authentication reduces custom password-handling risk; correct access controls, provider-account security, updates, backups and operational ownership remain necessary.

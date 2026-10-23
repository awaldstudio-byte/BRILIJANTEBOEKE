# Dashboard layout and email-first access — 23 October 2026

## Changes

- All dashboard notices live inside `#admin-notices`, a named full-width grid area. Inserting a notice directly into the two-column shell previously displaced the navigation and main content into unintended grid cells on desktop.
- The application fills the viewport below the header. Main content and sidebar have independent scroll containers; long orders no longer scroll the sidebar or whole document. Narrow screens retain a separately horizontally scrollable navigation bar and table. Switching sections resets only the main content scroll position.
- Submitting the first email screen now calls the server's `email-check` action. Only active, individually approved staff addresses can advance. Existing configured users reach password entry. Approved first-time users reach setup, request mailbox verification, then choose a strong password through the existing verified-session flow.
- A denied email stays on the email screen with a neutral contact-support message. Direct unapproved `request-code` calls also fail before creating setup challenges or scheduling email. Approval checks never authenticate, create accounts, send messages or grant permissions. All later operations independently retain authorization checks.
- Existing remembered sessions, password requirements and enrolled-factor challenges are unchanged. Optional MFA setup remains optional for users without an enrolled factor.

## Security trade-off

The requested approval-first gate intentionally exposes a difference between approved and unapproved addresses through the next screen / HTTP result. Neutral wording does not remove this enumeration signal. This supersedes the previous uniform unknown-address setup response. It is not a complete spam or abuse solution: existing origin checks, hashed per-IP/per-email durable limits, code quotas, mailbox verification and password/session boundaries remain necessary and are retained. No user IDs, roles, names, provider tokens or private profile records are returned by the lookup.

## Verification

- 162 automated tests pass, including approved/existing/new/disabled/unknown routing, no challenge or email for denied addresses, rate-limit denial, non-cacheable responses, session protections and a guard against notices being prepended into the shell again.
- Loopback-only browser fixtures at 1440×900, 1024×844, 768×844, 390×844 and 320×844: document width matched viewport width and the desktop notice did not displace navigation. A 40-row stress fixture scrolled main content to approximately 1409px with sidebar scroll and position unchanged.
- Browser login fixtures: unknown address remained on the email form; approved configured address reached password entry; approved first-time address reached setup and the verification-code form. No real credentials or outbound messages were used in those fixtures.
- Preview deployment `dpl_6kQevf89S47pcZh4FefTZLEc8HHq` was READY before assigning `https://briljante-preview-awaldstudio.vercel.app`.
- Live backend checks: an unapproved synthetic `.invalid` address returned 403; `technical@awaldstudio.com` returned only `next: password`. Both responses were no-store and set no session cookies. These checks do not send email or create users.
- Existing signed-in dashboard session survived the preview refresh. Real data remained one school, two paid DEMO orders, four learners and R1,320 simulated paid value. Actual table horizontal scrolling moved the table 240px while navigation and document scroll remained unchanged.

The public marketing domain, parent checkout implementation, database schema, account passwords, mail settings and payment settings were not changed. Desktop/phone widths were browser fixtures, not physical-device or Safari certification.

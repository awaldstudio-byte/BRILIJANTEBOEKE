# Verification email design

The staff setup email now includes a restrained, responsive HTML layout based on the user's reference: exact existing Briljante logo, a light grey surround, white content card, navy type, turquoise rule, a selectable verification code and support details. The logo is attached inline using CID, not fetched from a remote tracking URL. English and Afrikaans instructions and a complete plain-text alternative remain available.

The code is visible immediately. A clipboard button that reveals a code cannot reliably run inside ordinary email clients because their scripting support is restricted. Do not add a decorative, nonfunctional Copy code button, encode the code in an external URL, or weaken mailbox verification to imitate that interaction. The user was told about this limitation before implementation.

No authentication or account approval rules change. Setup still requires the existing browser-bound challenge, provider verification, private password setup and MFA. No live code or learner data appears in design artifacts. The local-only design server uses synthetic code 12345678. No new real verification email was sent for this design change.

Verification: 76 automated tests pass; 41 JavaScript files pass syntax checks. Tests include complete text/HTML MIME generation with the exact CID logo, disabled file/remote content loading, no scripts/forms/fake buttons/credential links, rejection of injected fields, and the existing access checks. Browser rendering was reviewed at normal desktop width, 768px tablet and 320px narrow mobile; the latter two have no horizontal overflow. Actual Gmail/Outlook/Apple Mail inbox rendering and dark-mode behaviour are not yet tested. Browser previews are not a substitute for those inbox tests.

The email template is in api/_lib/staff-email.js. api/admin-login.js explicitly includes assets/images/logo.png in its hosted function bundle. The local design preview is scripts/preview-staff-email.mjs; scripts, docs and test fixtures remain excluded from public deployment. Only the feature preview is being released, not the production website or payment configuration.

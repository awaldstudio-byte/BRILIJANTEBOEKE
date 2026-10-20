# Briljante Boeke: PayFast preparation

Prepared 20 October 2026. Internal working record; excluded from public deployment.

## Approved scope and business model

Elna's email of 19 October confirms PayFast. Briljante Boeke sells its own Afrikaans workbooks to parents at participating South African schools. A private link limits each order to one school and its grades/prices. One payment can cover multiple children. Briljante prepares the books and delivers in school-specific batches. This is not a marketplace, escrow, subscription or split-payment service. Settlement must be to the merchant's verified account, never A WALD STUDIO's account.

The original book covers, samples, logo, navy/turquoise palette and Roboto fonts are retained. The old video contained the unwanted script lettering. Its replacement uses selectable book layouts with real text and the same artwork. No replacement covers or Grade 1/2 assets have been invented. Elna says those files will arrive by the end of the week of 19 October.

## Website and payment requirements

| ID | Area | Requirement | Scope basis | Status | Evidence | Environment / revision | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Scope | Preserve approved site and source | Client request | Implemented and verified | Existing logo/artwork retained; targeted changes only | Local working tree based on d317351 | Studio | Verify public deployment |
| 02 | Design | Replace curly homepage and grade lettering | Client email 23 September | Implemented and verified | HTML Roboto heading and grade controls, original 3-7 artwork | Local responsive browser checks | Studio | Verify public deployment |
| 03 | Catalogue | Grade 1 and 2 cover, samples and product details | Elna email 19 October | Client confirmation pending | No supplied assets in repository; neutral forthcoming note | Local working tree | Briljante | Supply final assets, text and prices |
| 04 | Navigation | Discoverable policies and support | PayFast website terms | Implemented and verified | Footer FAQ, privacy and order-terms links | Local affected pages | Studio | Verify public routes |
| 05 | Privacy | Disclose actual parent/child data and PayFast transfer | Existing application and PayFast privacy notice | Implemented and verified | Bilingual privacy page; no child details sent in checkout request | Local source and checkout test | Studio / Briljante | Confirm operational retention and privacy contact |
| 06 | Terms | Describe product, ZAR, domestic bulk school delivery, cancellation/refund/support | PayFast general terms, schedule 1.4 | Implemented and verified | Bilingual terms and FAQs | Local affected pages | Briljante | Confirm final business rules and tax/delivery treatment |
| 07 | Checkout | Display purchase conditions within checkout before affirmative acceptance | PayFast general terms, schedule 1.4 | Implemented and verified | Inline bilingual conditions and required checkbox, final school delivery note | Local English/Afrikaans checkout review | Studio | Repeat with merchant sandbox account |
| 08 | Contact | Confirm legal supplier identity, public address and support phone | Merchant onboarding and supplier disclosure | Client confirmation pending | Only trading name and existing email addresses verified | Current source and client correspondence | Briljante | Supply approved legal name/type, business address, phone and registration/VAT details where applicable |
| 09 | Payments | Server-calculated amount and private status access | Agreed Phase 1 | Implemented but unverified | Existing order RPC and checkout amount; access-token test | Existing schema; local tests | Studio | Verify correct dedicated database access and end-to-end sandbox order |
| 10 | Payments | Reject forged, duplicate-field, wrong-merchant/amount/source notifications | PayFast custom integration | Implemented and verified | Negative tests; sandbox and live source separation | Local tests | Studio | Repeat with real sandbox ITN |
| 11 | Payments | Keep retries idempotent and transient confirmation failures retryable | Agreed payment flow | Implemented and verified | Stable verified event keys; rejected callbacks cannot consume verified event key; outage test | Local helper tests; existing SQL reviewed | Studio | Run transactional database and provider tests |
| 12 | Payments | Return/cancel cannot mark an order paid | Agreed payment flow | Implemented but unverified | Status page reads status; only verified ITN calls payment RPC | Source and existing tests | Studio | Provider success/cancel/delayed callback acceptance run |
| 13 | Payments | Gate real ordering until configuration and explicit live release | Safe activation | Implemented and verified | Orders require PayFast config; live mode requires PAYFAST_LIVE_ENABLED=true and a non-sandbox merchant ID | Local configuration tests | Studio | Enable only after account approval and full sandbox test |
| 14 | Account | Briljante-owned merchant account, verified beneficiary and authorised representative | PayFast registration/verification | Launch/access pending | No PayFast merchant credentials configured in Vercel | Vercel environment inventory, 20 October | Briljante / PayFast | Register and verify directly with PayFast |
| 15 | Branding | Approved PayFast/card-method branding | PayFast terms, methods enabled on account | Launch/access pending | No invented logo or unconfirmed accepted-method claims | Current build | PayFast / Studio | Obtain approved artwork and confirm activated payment methods |
| 16 | Security | Exclude internal files and keep secrets server-side | Application architecture | Implemented and verified | .vercelignore excludes docs/tests/scripts/schema; keys remain server-only; no credentials in this record | Local checks | Studio | Probe excluded routes on deployed preview |
| 17 | Staff workflow | School and order management, paid lists and school-specific fulfilment | Agreed Phase 1 | Implemented but unverified | Existing administration preview and schema; no new staff access changed | Existing feature branch | Studio / Briljante | Staff authentication and first real school acceptance |
| 18 | Reports | Excel separator compatibility and agreed final report design | Client email 1 October | Not checked | Existing CSV export still uses comma separators; final layout not yet agreed | Existing feature branch | Studio / Briljante | Resolve Excel import and confirm final report headings/layout before launch |
| 19 | Infrastructure | Correct project, existing domain, HTTPS and rollback | Approved hosting | Implemented and verified | Vercel brilijanteboeke, project prj_nxGKfknjzuyslJKwzjfIVvM8CfSa; existing domain resolves and returns 200 | Current public deployment | Studio | Publish static readiness changes without activating unverified school payments |
| 20 | Database | Use dedicated Briljante project only | User's dedicated-account decision | Launch/access pending | Expected project cigyxjfzbjlgbrduzcpw; current connector lists Getit/Nostratic only; Vercel secrets cannot be downloaded | 20 October access check | Studio / account owner | Authenticate dedicated Briljante account; do not substitute unrelated database |
| 21 | Search | Public policies, correct canonical URLs and sitemap | Existing site | Implemented but unverified | Existing canonical and redirects preserved; FAQ in feature sitemap | Local source | Studio | Verify production routes and keep staff/checkout out of indexing |
| 22 | Measurement | Tracking and marketing | Not requested | Not applicable | No advertising/analytics integration added | Source | Studio | Reassess only if authorised |
| 23 | Accounts | Parent/school dashboards and registration | Excluded from Phase 1 | Not applicable | Guest school-linked ordering; staff dashboard only | Agreed scope | Studio | None |
| 24 | Operations | Payment confirmation email, backup/restore, refunds and handover | Launch preparation | Not checked | Existing SQL queues notification jobs but delivery is not verified by local tests | Existing architecture | Studio / Briljante | Verify notification worker, inbox delivery and operational handover before launch |

## What cannot yet be claimed

Website preparation is not PayFast approval or legal certification. Local tests do not establish a completed payment, verified merchant account, settlement, working production database, delivered confirmation email or final client-approved refund/tax rules. Physical-device, Safari and assistive-technology checks have not been performed.

## Account handoff

1. Ask PayFast to confirm the suitable merchant account type for Briljante's legal structure. This business is a publisher, not a school collecting fees.
2. Register with an address controlled by Lindie/Elna, verify that address and let the authorised representative accept the merchant terms. Do not invent the legal name or register under A WALD STUDIO.
3. PayFast requests different documents for companies and sole traders. A company generally needs registration evidence, company physical-address evidence, bank-account evidence and the relevant representative/director identification/address documents. Use PayFast's current document list for the actual legal structure.
4. Upload identity and bank documents directly through the merchant dashboard. Do not place them in Git, screenshots, this checklist or a general client email.
5. Configure sandbox credentials server-side. Set APP_ORIGIN to the tested deployment origin. The callback is /api/payfast-notify; return/cancel use /order/status/ with reference and language.
6. Complete real sandbox success, cancel/failure, amount mismatch, repeated/delayed ITN and multi-child acceptance. Check notification delivery and school reports against the order ledger.
7. Configure the verified merchant's live credentials securely. Keep PAYFAST_LIVE_ENABLED=false until release checks, policy/business details and first-school acceptance are complete.

## Verified official sources

- https://support.payfast.help/portal/en/kb/articles/sign-up-with-payfast-20-9-2022
- https://support.payfast.help/portal/en/kb/articles/verify-a-company-account
- https://support.payfast.help/portal/en/kb/articles/verify-a-sole-trader-account
- https://support.payfast.help/portal/en/kb/articles/verify-your-account-20-9-2022
- https://payfast.io/legal/general-terms-conditions/
- https://payfast.io/privacy-policy/
- https://developers.payfast.co.za/docs
- https://payfast.io/contact/

Support address verified in PayFast's current help centre: support@payfast.help. Copy briljanteboeke@gmail.com on an onboarding request; send no passwords, merchant secrets or identity/bank documents in that email.

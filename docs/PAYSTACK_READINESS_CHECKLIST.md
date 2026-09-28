# Briljante Boeke Paystack readiness checklist

This is an internal preparation document. It contains no payment credentials, identity documents or bank details.

## Current position

Briljante Boeke is a direct seller of its own school workbooks. The school-ordering facility is not a marketplace, does not onboard third-party sellers or service providers, and does not hold or release money on behalf of another merchant.

The core ecommerce, administration and fulfilment system is provider-independent. The current payment adapter and visible preview wording still refer to PayFast. A Paystack adapter and wording change must be completed before Paystack is presented as the live payment provider.

## Reviewer requirement mapping

| Paystack review item | Current evidence | Status |
| --- | --- | --- |
| Functional website showing goods and services | Public Briljante site, catalogue, Grade 3-7 product pages and school-ordering preview | Ready for review |
| Product demonstration | Sanitised parent-order and Briljante administration previews | Ready for review |
| Test login | Preview mode uses sanitised data and does not expose production credentials | Ready for review |
| Pricing structure | Product pages and school-specific order totals show ZAR prices; school prices are configurable | Ready for review |
| Customer information collected | Parent name, email and mobile; child name, surname and grade; school, academic period, order reference, amount and payment status | Documented |
| Enhanced due diligence | No third-party merchant onboarding. Unusual, mismatched, failed or disputed payments can be held for manual review | Documented |
| Acceptable use | No user-generated marketplace activity. Unlawful or fraudulent orders may be refused under the order terms and provider rules | Covered by business model; separate AUP not presently necessary |
| Payment flow | Server calculates the order total, provider hosts payment, server verifies the provider event, and only verified orders become paid | Implemented for current adapter; Paystack adapter pending |
| Dispute management | Public order terms and FAQ describe the evidence review, support route, correction, replacement and refund process | Ready for review |
| Delivery or shipping policy | Books are prepared by Briljante and delivered in bulk to the school, normally at year-end or in January | Ready for review |
| Refund policy | Public school-order terms include corrections, damaged books, cancellations and refunds | Ready for review |
| Stock or dropshipping explanation | Briljante produces and prepares its own books for participating schools; it is not a dropshipping model | Ready for review |
| Fund holding and release | No escrow or third-party release. The provider settles directly to Briljante under its payout schedule | Ready once Paystack account is approved |

## Technical Paystack work still required

1. Replace the PayFast checkout initializer with a Paystack transaction-initialisation endpoint.
2. Add server-side Paystack webhook signature verification and transaction verification.
3. Match the verified reference, amount, currency and status before marking an order paid.
4. Preserve idempotency so repeated webhook events cannot create duplicate paid records.
5. Store the provider transaction reference and audit result.
6. Update the parent checkout, status page, privacy wording and terms from PayFast to Paystack.
7. Add only server-side Paystack credentials through the hosting environment; never commit or email secret keys.
8. Test success, cancellation, failed payment, amount mismatch, duplicate webhook and delayed-webhook cases in Paystack test mode.

## Information Briljante must provide for merchant activation

The required set depends on whether Paystack classifies the merchant as a registered company, sole proprietor or starter business. Do not collect more than Paystack requests.

- Legal or owner name matching the bank account.
- Business type and, if registered, CIPC registration information.
- Bank confirmation letter for the settlement account.
- Required owner or director identity information.
- Proof of address if required for the selected business type.
- Briljante-controlled email address and mobile number for the merchant account.
- Confirmation that the settlement account belongs to Briljante or its legal owner/entity.

These documents must be supplied directly through Paystack's secure onboarding process. They should not be stored in the website repository or included in ordinary email unless Paystack expressly provides a secure approved channel.

## Items not required from the Getit thread

- GETIT's WhatsApp workflow, grocery pricing, retailer receipts and preauthorisation model do not apply.
- GETIT's CIPC documents and director resolution cannot be reused for Briljante.
- The supplier-invoice request in the Getit thread was explicitly withdrawn by Paystack in the following email.
- Briljante does not need to disclose school learner lists for merchant activation. The review demonstration uses sanitised data.

## Recommended submission pack after the provider switch

1. Short cover email describing Briljante as the direct seller and fulfiller.
2. Public homepage, catalogue, product, FAQ, privacy and delivery/refund-policy links.
3. Sanitised parent-order and administration preview links.
4. A concise payment-flow and dispute-management document.
5. Merchant KYC records uploaded through Paystack's secure onboarding process.
6. Confirmation that the Paystack test payment and webhook flow have passed the integration checks.

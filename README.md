# Briljante Boeke — original-look migration

This package was reconstructed from the supplied WPvivid backup with the **existing client-facing design as the source of truth**. It preserves the Blocksy/Elementor colours, typography, header/footer, page structure, book assets, banner video and quote-based sales flow. WordPress/PHP/WooCommerce runtime code is intentionally not required on Vercel.

## Deploy
Upload the contents of this folder to the GitHub repository root and redeploy in Vercel with Framework Preset **Other**. No build command is required.

## Sales flow
The visible `Voeg by kwotasie` workflow remains. The quote list is stored in the visitor browser and `Send Your Request` opens a pre-filled email to `sales@briljanteboeke.co.za`. There is no online checkout.

## Important
Do not mix files from the earlier redesigned conversion with this package. Replace the repository contents with this folder.

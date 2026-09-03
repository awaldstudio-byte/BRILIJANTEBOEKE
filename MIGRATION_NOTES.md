# Migration Notes

This static site was rebuilt from the supplied WPvivid backup of `briljanteboeke.co.za`.

## Preserved
- Briljante Boeke / Brilliant Books branding and original logo assets
- Existing navy / blue / aqua brand palette recovered from the WordPress theme settings
- Afrikaans + English presentation
- Grade 3–7 catalogue
- Original book cover artwork
- Original sample workbook pages
- Original homepage banner video
- Existing Grade 3–7 prices from the WooCommerce product records
- About copy naming Elna Pretorius and Lindie Isherwood
- `info@briljanteboeke.co.za` and `sales@briljanteboeke.co.za`
- Privacy / POPIA page content and Terms & Conditions from the backup
- SEO basics: page titles, descriptions, sitemap and robots file

## Intentionally removed / replaced
- WordPress, PHP and MySQL dependency
- WooCommerce cart and checkout
- Customer account / login / membership pages
- YITH quote-cart dependency
- Elementor / Blocksy runtime dependency
- Template/demo blog posts

## Current enquiry flow
Customers browse a workbook, inspect sample pages and use the quote/contact flow. Forms prepare a pre-filled email to Briljante Boeke; they do not take payment online.

## Deployment
The repository is intended for GitHub -> Vercel. See `README.md`.

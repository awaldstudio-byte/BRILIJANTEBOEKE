# Grade 1 and Grade 2 public catalogue update

## Client source

- Elna's 20 October 2026 Drive email requests Grades 1, 2 and 3 together as the Junior section, with Grades 4–7 on the next row.
- The 21 October 2026 email supplies both grade folders for the website.
- All 31 supplied PNGs are copied without alteration to `assets/images/grade-1/` and `assets/images/grade-2/`. SHA-256 comparison verified every original against the public copies.
- Afrikaans descriptions come from the two supplied PowerPoint files. English translations are included alongside the original text.

## Public changes

- Seven-grade homepage rotation, Grade 1 static fallback and mobile controls grouped 1–3 / 4–7.
- Separate Junior 1–3 and Grade 4–7 catalogue groups. Phone catalogue now displays two books per row with compact spacing and 44px quotation buttons; desktop layout and About page remain unchanged.
- New product pages with the supplied artwork and descriptions. Following the client's 22 October requests, the five Grade 1 module covers and all four crossed-out Grade 2 module covers are no longer shown as samples. Grade 1 retains its cover, title page and eight content pages (10 gallery images). Grade 2 retains its cover, title page and ten content pages (12 images). Original files are preserved.
- Search and quotations include both new products. Existing Grade 3–7 product identifiers and prices remain unchanged.
- About page, homepage range and sitemap include Grades 1–7.

## Pricing and payment boundary

On 22 October the client confirmed Grade 1 and Grade 2 at R320 each and requested their prices be displayed like the other grades. Catalogue cards, both product pages and quotation calculations now use R320. Quantity 2 is R640 for each grade. ISBNs remain unconfirmed and are not invented. Unknown future prices still never calculate as R0 or NaN.

This is a public catalogue/content release. It does not activate the inactive Grade 1/2 database placeholders, create school offerings, alter school-specific pricing, or enable live payments. Existing merchant approval and payment-release gates remain unchanged. Admin/order/API routes must not be included in the static public deployment.

## Verification

Run `npm run check`, `scripts/review-payfast.mjs` for seven-grade homepage/policies, and `scripts/review-grades.mjs` for catalogue, every new gallery thumbnail, quotations, search and About at five desktop/tablet/mobile sizes. Hosted checks must follow publication.

Keep the approved heading and outer-ring turquoise `#11d2cd`, and inner-ring navy `#093464`. The existing turquoise-on-white contrast limitation is unchanged by this release.

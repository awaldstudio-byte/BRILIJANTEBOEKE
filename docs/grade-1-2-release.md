# Grade 1 and Grade 2 public catalogue update

## Client source

- Elna's 20 October 2026 Drive email requests Grades 1, 2 and 3 together as the Junior section, with Grades 4–7 on the next row.
- The 21 October 2026 email supplies both grade folders for the website.
- All 31 supplied PNGs are copied without alteration to `assets/images/grade-1/` and `assets/images/grade-2/`. SHA-256 comparison verified every original against the public copies.
- Afrikaans descriptions come from the two supplied PowerPoint files. English translations are included alongside the original text.

## Public changes

- Seven-grade homepage rotation, Grade 1 static fallback and mobile controls grouped 1–3 / 4–7.
- Separate Junior 1–3 and Grade 4–7 catalogue groups. Responsive reflow preserves their order.
- New product pages with all supplied covers, title pages, sample pages and module covers: 15 gallery images for Grade 1 and 16 for Grade 2.
- Search and quotations include both new products. Existing Grade 3–7 product identifiers and prices remain unchanged.
- About page, homepage range and sitemap include Grades 1–7.

## Pricing and payment boundary

No Grade 1/2 price or ISBN was supplied. Do not invent either. The public pages and quotation form show "Prys op aanvraag | Price on request" for those products, including mixed quotations with already-priced books. Unknown prices never calculate as R0 or NaN.

This is a public catalogue/content release. It does not activate the inactive Grade 1/2 database placeholders, create school offerings, alter school-specific pricing, or enable live payments. Existing merchant approval and payment-release gates remain unchanged. Admin/order/API routes must not be included in the static public deployment.

## Verification

Run `npm run check`, `scripts/review-payfast.mjs` for seven-grade homepage/policies, and `scripts/review-grades.mjs` for catalogue, every new gallery thumbnail, quotations, search and About at five desktop/tablet/mobile sizes. Hosted checks must follow publication.

Keep the approved heading and outer-ring turquoise `#11d2cd`, and inner-ring navy `#093464`. The existing turquoise-on-white contrast limitation is unchanged by this release.

# Homepage workbook animation — 20 October 2026

## Scope

Restore the original automatic Grade 3–7 showcase as responsive HTML/GSAP animation. Retain exact existing covers, sample pages, local fonts and white/navy/turquoise brand palette. Roboto Slab 600 replaces the rejected script lettering; Roboto remains the supporting font. No new book artwork, tracking, payments, customer features or homepage copy claims were added.

The original MP4 is preserved. This release is a native responsive animation, not a newly encoded MP4. The equivalent finite 25.4-second review composition is in `../briljante-banner-motion` and shares `assets/banner-motion.js` with the website.

## Implementation

- Automatic five-grade rotation; approximately four-second readable holds and short coordinated copy/cover/page transitions.
- Grade-matched covers, four sample pages and two product links.
- Manual selection pauses at the selected complete grade; play/pause control resumes rotation.
- Hover, keyboard focus, offscreen and hidden-tab suspension.
- Reduced-motion static browsing; complete Grade 3 fallback with product links if JavaScript/GSAP is unavailable.
- Locally vendored GSAP 3.14.2. No new external browser requests, storage or optional tracking introduced by the animation.
- Only active slide is available to keyboard and assistive technology. Automatic slide changes do not make live announcements.

## Verification

- `npm run check`: 28 JavaScript syntax checks and 18 passing tests, including a regression test for the incoming-artwork flash.
- HyperFrames 0.8.181 full check: zero lint/runtime/layout/motion warnings or errors; 50/50 text contrast checks pass. No encoded video requested or rendered.
- Local and hosted browser review: 1440×1000, 1024×768, 768×1024, 390×844 and 320×740; all five grade selections, image loads, links, no horizontal overflow, unaffected policy pages, no JavaScript errors.
- Independent real-time cycle: 3 → 4 → 5 → 6 → 7 → 3; art/link/grade consistency checked every 100 ms. Pause/resume, manual browsing, focus/hover/offscreen pause and reduced motion passed.
- Loop endpoint and beginning compared pixel-identical. Initial incoming-copy/page flash was identified by dense transition frames and corrected with an explicit pre-reveal hidden state.
- Additional fallback, landscape and enlarged-text checks are recorded in `outputs/briljante-banner-independent-review` at the project workspace root.

Physical phones, Safari and a full screen-reader audit were not tested. These scoped checks do not constitute complete WCAG or security certification.

## Release boundary

Deploy only `index.html`, `assets/home-banner.js`, `assets/workbook-banner.css`, `assets/banner-motion.js` and `assets/vendor/gsap-3.14.2.min.js` into the static public-release worktree. Never merge/deploy the entire foundation application to the public domain.

After publishing, verify the delivered assets match this source and repeat `/` 200 with `/admin/`, `/order/` and payment API routes 404. PayFast account verification and live payment activation remain separate outstanding work.

## Same-day follow-up: playback control removal

At Nathan's request, removed the visible play/pause button, its styles and controller references. The animation choreography and original assets are unchanged. Autoplay continues normally; manually selecting any grade keeps that grade paused for inspection, as before. Hover/focus/offscreen suspension and reduced-motion behavior remain intact. Independent browser checks at 1440, 768, 390 and 320px passed with no JavaScript errors or overflow; all five grade buttons remain functional and at least 44px high. The 18 source/unit tests pass.

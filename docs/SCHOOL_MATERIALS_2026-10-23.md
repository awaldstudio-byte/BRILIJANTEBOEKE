# School QR images and printable posters

## Included

The saved school's order-link panel now includes school-logo upload, Download QR (PNG) and Download poster (PDF). English/Afrikaans follow the dashboard language. Generated links use the configured application origin, saved school identifier and exact ordering-period ID. There is no external shortener, QR subscription or tracking service.

The QR download is a 1800 x 1800 black/white PNG with a four-module quiet zone. The PDF is a single A4 page using the exact approved Briljante logo, print-ready weights derived from the website's existing Roboto font, optional original school logo, school name, academic year, available grades, closing date, QR and fallback link. No school logo is invented or substituted. Without an uploaded school logo, the school name and Briljante publisher logo remain.

Posters generated for the temporary Vercel preview or without a ready payment/open-school configuration carry a visible preview warning. These are not final distribution copies. Regenerate QR/poster downloads after the final-domain release and whenever the link identifier or printed details change.

## Access and upload controls

- The new API requires an approved authenticated staff session. Administrator and viewer roles can download; only administrators can upload/replace logos. Upload also requires the exact configured origin.
- School/period UUIDs are validated and the period must belong to the school. Resource paths and recipients are not accepted from the request. No order or learner data is queried by this feature.
- Original PNG/JPEG inputs are limited to 2 MB and four million decoded pixels, inspected and re-encoded to bounded PNG. SVG, unsupported formats, malformed data and oversized dimensions are rejected. Original EXIF metadata is not retained.
- Logos use the private briljante-school-logos bucket in the dedicated project cigyxjfzbjlgbrduzcpw, with 2 MB and image/png restrictions, zero client storage policies and deterministic school UUID paths. No public bucket, anonymous upload, signed public URL, schema change or RLS weakening was introduced.
- Bucket was created and read back in the existing authenticated project UI: Public bucket off, size restriction on at 2 MB, MIME restriction image/png. No client logo object has been added by the agent.
- An idempotent setup script is retained for operators with valid runtime credentials and refuses any other project. The local sanitized audit environment is not usable for provisioning; the live bucket was configured through the existing project UI instead. No SMTP credential was retrieved.

## Verified release

Preview deployment dpl_Fk1EErrC3WMyLJWbckxQvRJdTJRT is Ready and assigned to the branded preview alias. Existing marketing domains, accounts, mail, payments and other projects were not changed.

- 125 automated tests pass. New tests cover QR decoding, A4 generation, long names/Afrikaans, image normalization and rejection, staff-first/administrator-only access, origin checks, school-period isolation, fixed storage paths and audit metadata.
- Production dependency audit reports zero vulnerabilities at verification time.
- Actual authenticated dashboard downloads saved test-school-1-2027-qr.png and test-school-1-2027-poster.pdf in the user's Downloads directory. Both succeeded without an uploaded school logo.
- The downloaded PDF is one A4 page, 52,931 bytes, with no JavaScript and Briljante document metadata. Its rendered page was visually reviewed. An independent decoder read the QR from both the actual downloaded PNG and the rendered downloaded PDF; both encode the precise existing test school's 2027 ordering URL.
- Desktop controls visually reviewed at 1280 pixels. Document-width checks passed at 768, 390 and 320 pixels; no physical-device/Safari certification is implied.
- Unsigned materials endpoint returns 401. New internal implementation, scripts and tests return 404. The hosted private-logo read correctly returns no logo for the current test school rather than blocking downloads.
- Evidence: outputs/school-materials/dashboard-materials.png, dashboard-materials-mobile.png, storage-private.png and hosted-poster-1.png in the task workspace. The exact approved publisher logo was inspected before authoring.

## Remaining acceptance

No actual school logo was provided in this turn. Upload/replace behavior was tested with injected storage in the automated suite, not by persisting a substitute logo against the user's test school. The first official school logo should be uploaded and its generated poster reviewed before real distribution. A removed/replaced file recovery UI is not included; retain original approved logos separately.

The QR was decoded in software, not scanned on a physical phone or printed on paper. A final paper/phone check is recommended once the real domain, official school logo, deadline and PayFast are ready.

# Partner Center contact API: limited live probe

Date: 2026-09-08 (Asia/Shanghai)

## Scope and handling

- The user supplied a local Cookie JSON file for this test. Credentials were read locally and sent only to `https://partner.tiktokshop.com` using ordinary HTTPS certificate validation.
- No credentials, creator identifiers, contact values, or account identifiers are recorded here.
- No messages, invitations, or favorites were sent. No production database or installed application files were modified.
- Three distinct Malaysia creator samples were tested. Two creator detail pages were opened only to obtain sample identifiers; the contact requests did not require opening their chat pages.
- No automatic retries, proxy changes, CAPTCHA solving, or quota stress test were performed.

## Observed request contract

1. Read the authorized account context:
   `GET /api/v1/affiliate/partner/info?partner_type=1`
2. Select `data.partner_biz_role_info.market_list` by **market_region**, not `market_id`.
   Malaysia is region `6`. Select the authorized TAP role using `type_list.type === 4` (AffiliatePartner). MCN is type `1`.
3. Read contacts:
   `GET /api_sens/v1/affiliate/cmp/contact`
   with `partner_id` from that authorized role, `creator_oecuid`, and `scene=11`.
4. The successful requests also included `aid=360019`, `app_name=i18n_ecom_alliance`, and `device_platform=web`, matching the published frontend's application context.
5. Use the locally supplied, unexpired, domain/path-applicable Cookie header. Do not treat a creator chat link's `shop_id` as a substitute for the authorized role's `partner_id`.

The first two exploratory contact requests returned HTTP 200 with business code `98001004`. The second explicitly reported `invalid params; detail:miss partner_id`. These were parameter failures, not successful reads. After supplying the authorized role context, all three sample reads returned HTTP 200 and business code `0`.

## Successful sample results

| Anonymous sample | Contact fields returned | Request duration | Verification/challenge header |
| --- | --- | ---: | --- |
| 1 | Email (`field=2`) | 204 ms | Absent |
| 2 | Email (`field=2`) | 200 ms | Absent |
| 3 | WhatsApp (`field=1`) | 229 ms | Absent |

Contact values were present and retained as strings during processing. The successful samples did not contain a `country_code` value. Do not infer a country prefix from the market or convert contact numbers to numeric types.

No HTTP 429, contact-quota business error, or challenge header was observed in these successful reads. This is a small functional test, not evidence of unlimited quota or long-term throughput. Durations exclude account-context requests, discovery, deliberate spacing, persistence, and export. Samples 2 and 3 were deliberately spaced by 10 seconds.

## Field mapping found in the frontend

The published Partner IM frontend defines creator contact fields:

| Field | Meaning | Live sample obtained in this probe |
| ---: | --- | --- |
| 1 | WhatsApp | Yes |
| 2 | Email | Yes |
| 9 | WhatsApp country code | No |
| 31 | LINE | No |
| 32 | Zalo | No |
| 33 | Viber | No |
| 34 | Facebook | No |
| 61 | LINE country code | No |
| 62 | Zalo country code | No |
| 63 | Viber country code | No |

Source inspected: [published Partner IM frontend bundle](https://sf16-website.neutral.ttwstatic.com/obj/tiktok_web_static/i18n/ecom/alliance/partner_im/static/js/main.454f7db0.js).

## Remaining work / limits

- LINE and other contact types still need real populated samples and UI value comparison. This probe verifies presence/types, not value-by-value equality with the UI.
- Existing creator-list responses have not been shown to include all contact values. The verified method is a separate per-creator contact request, without a per-creator chat-page visit.
- No app integration, contact database migration, contact export, packaged release, or installation of this feature has been completed by this probe.
- Contact quota ceilings and reset times remain unverified. Stop on authentication failure, quota errors (`16005003` / `16005005` in the observed frontend), HTTP 429, or a verification challenge.

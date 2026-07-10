## Selected API: Listings And Property Data

- Endpoint: https://www.airbnb.com/api/v3/StaysSearch
- Method: GET
- Auth:
  - Required header: x-airbnb-api-key (read from Airbnb bootstrap api_config.key)
  - Required persisted query extension with sha256 hash
- Operation name: StaysSearch
- Operation ID: 753d97c7b19a1a402d2fa63882ff4d6802004d11f2499647deef923a19a1641a
- Pagination:
  - results.paginationInfo.nextPageCursor
  - pass the token as rawParams `cursor` on subsequent requests
  - decoding cursor to offsets and sending `sectionOffset/itemsOffset` can cause page-loop duplication
- Field count: 25+ listing/property fields per result item

### Fields available (non-exhaustive)

- propertyId, demandStayListing.id, title, subtitle, nameLocalized
- demandStayListing.homeType, localizedCity, roomAndPropertyType, personCapacity
- demandStayListing.hostProfile fields, coordinate fields
- structuredDisplayPrice primary and secondary price lines
- badges, contextualPictures, rating labels
- paginationInfo cursors

## URLScan and candidate analysis

- URLScan search was attempted for Airbnb search routes.
- Public scans did not reliably expose complete persisted query metadata.
- Runtime bootstrap payload and API replay were used to validate the working API contract.

## Why weaker candidates were rejected

- HTML selectors: Rejected to avoid brittle markup parsing and to keep actor API-first.
- Reviews API: Rejected because actor scope is listing/property extraction, not reviews.
- Request without persisted extensions: Rejected (400 invalid_input).

## HTTP-only viability

- StaysSearch API works with direct HTTP requests through got-scraping.
- No browser automation is required for extraction.
- Runtime healing refreshes API key, reuses the canonical bootstrap URL as referer, and attempts operation hash refresh when needed.
- Pagination cursors for broad city queries may still return heavy overlap between pages; source exhaustion before requested count is possible even when `results_wanted` is high.

## Header and rate-limit probe

| Candidate | Header profile | Status/body | Fields | Pagination | Decision |
|---|---|---:|---:|---|---|
| Web GraphQL | iOS Safari bootstrap + web GraphQL headers | 200 JSON | 18 listings on first page | cursor | Selected primary profile |
| Web GraphQL | Firefox desktop + web GraphQL headers | 200 JSON | 18 listings on first page | cursor | Kept as fallback |
| Web GraphQL | Android app-like okhttp headers | 200 JSON | 18 listings on first page | cursor | Kept as last fallback only |

- Request consistency decision: keep the web GraphQL endpoint, but use one coherent mobile Safari browser profile first instead of cycling profiles aggressively.
- 429 handling decision: treat 429 as cadence/session pressure, not a missing-header signal; cool down with randomized delay and do not immediately fan out across alternate header profiles.
- Pacing decision: add jitter between paginated API requests so source pagination does not burst requests back-to-back.

## Runtime Auto-Refresh
- Runtime StaysSearch Operation ID: 753d97c7b19a1a402d2fa63882ff4d6802004d11f2499647deef923a19a1641a
- Last Runtime Refresh UTC: 2026-04-28T06:47:16.727Z
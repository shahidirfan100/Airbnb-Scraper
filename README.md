# Airbnb Listings Scraper

Extract Airbnb listings and property-level details at scale using search URLs. Build clean datasets with ranking, pricing, ratings, host details, and location metadata for analytics and market intelligence.

---

## Features

- **API-first extraction** — Collects Airbnb listing and property data from the listing API response.
- **Flexible inputs** — Run using a full Airbnb search URL.
- **Cursor pagination** — Automatically follows Airbnb pagination cursors to collect more listings.
- **Null-free dataset output** — Excludes empty fields to keep records clean and analysis-ready.
- **Auto-healing runtime context** — Refreshes API key and operation hash context when request shape changes.

---

## Use Cases

### Short-Term Rental Market Research
Track active inventory, pricing, and listing quality in target cities or neighborhoods.

### Competitive Benchmarking
Compare listing rankings, rating signals, and host characteristics across markets.

### Dynamic Pricing Analysis
Monitor nightly and total displayed prices across different search filters and dates.

### Data Pipeline Enrichment
Feed property datasets into BI tools, forecasting workflows, and automated reporting systems.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | String | No | London search prefill | Preferred input. Any Airbnb search URL from `/s/.../homes`. |
| `results_wanted` | Integer | No | `20` | Maximum number of listing records to save. |
| `max_pages` | Integer | No | `5` | Safety cap for pagination depth. |
| `proxyConfiguration` | Object | No | Residential Apify Proxy | Proxy settings for reliability and stability. |

---

## Output Data

Each dataset item contains available listing/property metadata without empty/null fields.

| Field | Type | Description |
|---|---|---|
| `listing_id` | String | Airbnb listing numeric identifier. |
| `listing_url` | String | Airbnb listing URL. |
| `title` | String | Listing title text. |
| `subtitle` | String | Listing subtitle text. |
| `name_localized` | String | Localized listing name. |
| `room_type` | String | Home or room type. |
| `city` | String | Localized city for the listing. |
| `category` | String | Airbnb room/property category label. |
| `person_capacity` | Number | Maximum supported guests. |
| `is_superhost` | Boolean | Host superhost status when available. |
| `host_name` | String | Host name when available. |
| `latitude` | Number | Listing latitude. |
| `longitude` | Number | Listing longitude. |
| `rating` | Number | Average rating value. |
| `reviews_count` | Number | Number of reviews parsed from rating text. |
| `nightly_price` | String | Primary displayed nightly price. |
| `total_price_line` | String | Secondary displayed total/summary line. |
| `badges` | Array | Listing badge labels. |
| `image_urls` | Array | Image URLs from contextual listing pictures. |
| `search_rank` | Number | Rank order in collected search results. |
| `search_context` | String | URL context used in the run. |
| `fetched_at` | String | Extraction timestamp. |

---

## Usage Examples

### Search URL Input

```json
{
  "url": "https://www.airbnb.com/s/London--United-Kingdom/homes?checkin=2026-05-13&checkout=2026-05-14&adults=1",
  "results_wanted": 20,
  "max_pages": 5
}
```

### Proxy Configuration

```json
{
  "url": "https://www.airbnb.com/s/London--United-Kingdom/homes",
  "results_wanted": 20,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "listing_id": "1390856626261696498",
  "listing_url": "https://www.airbnb.com/rooms/1390856626261696498",
  "title": "Flat in Greater London",
  "subtitle": "2 beds",
  "name_localized": "Amazing location by tube",
  "room_type": "Entire rental unit",
  "city": "London",
  "person_capacity": 4,
  "rating": 4.93,
  "reviews_count": 165,
  "nightly_price": "$61",
  "nightly_price_qualifier": "for 1 night",
  "search_rank": 1,
  "search_context": "https://www.airbnb.com/s/London--United-Kingdom/homes?checkin=2026-05-13&checkout=2026-05-14&adults=1",
  "fetched_at": "2026-04-22T12:30:00.000Z"
}
```

---

## Tips For Best Results

### Prefer Direct Search URLs
Use full Airbnb search URLs for the most deterministic filter and location behavior.

### Start With QA-Sized Runs
Run with `results_wanted: 20` and low `max_pages` first, then increase for production jobs.

### Enable Residential Proxy
For best reliability across larger paginated runs, keep residential proxy enabled.

### Use Real Date Context
When analyzing pricing and availability snapshots, use Airbnb search URLs that already include realistic dates.

---

## Integrations

- **Google Sheets** — Build listing and pricing trackers.
- **Airtable** — Create searchable property intelligence databases.
- **Looker Studio / BI tools** — Visualize ranking, rating, and pricing trends.
- **Make / Zapier** — Trigger automated workflows from fresh listing datasets.
- **Webhooks** — Send output to internal APIs and downstream services.

### Export Formats

- **JSON** — For APIs and programmatic workflows.
- **CSV** — For spreadsheet analysis.
- **Excel** — For business reporting.
- **XML** — For compatible legacy systems.

---

## Frequently Asked Questions

### What happens if I do not provide a URL?
The actor uses `INPUT.json` as a local fallback. On Apify production runs, pass a real Airbnb search URL for deterministic behavior.

### Does the actor support pagination?
Yes. It follows Airbnb cursor-based pagination until `results_wanted` or `max_pages` is reached.

### What happens if the API key or operation hash changes?
The actor refreshes runtime API context automatically and retries the request.

### Are null fields included in output?
No. Empty and null values are removed before records are saved.

### Can I use long URLs with many query parameters?
Yes. The actor accepts full Airbnb search URLs with query parameters and uses them as search context.

---

## Support

For issues, enhancements, or feature requests, open a ticket via Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Schedules](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection and analysis workflows. Users are responsible for complying with applicable laws, platform terms, and usage limits.

## What does Airbnb Listings Scraper do?

Airbnb Listings Scraper extracts structured listing data from Airbnb search result pages. Add one or more Airbnb `/s/.../homes` search URLs, choose how many results you want, and get clean records with listing IDs, URLs, titles, room types, cities, guest capacity, ratings, review counts, pricing text, coordinates, badges, images, and search rank.

This Airbnb scraper is useful for short-term rental market research, competitor monitoring, pricing analysis, destination research, and building property datasets for BI dashboards, spreadsheets, AI agents, or internal data pipelines.

## Why use Airbnb Listings Scraper?

- **Market research without manual copy-paste** - Collect Airbnb listing data from selected cities, neighborhoods, dates, and guest filters.
- **Search URL based collection** - Use the same Airbnb search URLs your team already works with, including query parameters for stay dates, guests, and location context.
- **Multiple market support** - Process more than one Airbnb search URL in a single run until your requested result limit is reached.
- **Analysis-ready output** - Export structured records to JSON, CSV, Excel, XML, Google Sheets, or your own systems.
- **Monitoring workflows** - Schedule repeat runs to compare pricing, rating, ranking, and inventory changes over time.
- **Clean records** - Dataset items include available fields only, so downstream analysis does not have to deal with empty values.

## What data can you extract from Airbnb?

| Field | Description |
|-------|-------------|
| `listing_id` | Airbnb listing numeric identifier. |
| `listing_url` | Direct URL to the Airbnb room or property page. |
| `title` | Listing title shown in Airbnb search results. |
| `subtitle` | Short listing subtitle, such as bed or stay summary. |
| `name_localized` | Localized listing name when available. |
| `room_type` | Property or room type, such as entire rental unit or private room. |
| `city` | City or localized place name connected to the listing. |
| `category` | Airbnb room or property category label when available. |
| `bed_label` | Short bed, room, or layout summary. |
| `person_capacity` | Maximum guest capacity published for the listing. |
| `is_superhost` | Whether the host is marked as a superhost when available. |
| `host_name` | Host name when available in the search result data. |
| `latitude` | Listing latitude for mapping and geo analysis. |
| `longitude` | Listing longitude for mapping and geo analysis. |
| `rating` | Average rating score. |
| `reviews_count` | Number of reviews parsed from the listing rating text. |
| `rating_label` | Rating label text when provided by Airbnb. |
| `nightly_price` | Primary displayed nightly price. |
| `nightly_price_qualifier` | Price qualifier, such as the stay length label. |
| `price_accessibility_label` | Expanded price text when available. |
| `total_price_line` | Secondary total price or summary line. |
| `price_display_style` | Price display style label when available. |
| `review_snippet` | Short review snippet from the listing card. |
| `badges` | Listing badge labels, such as guest favorite or rare find. |
| `image_urls` | Image URLs from the listing card. |
| `search_rank` | Rank order in the collected Airbnb search results. |
| `search_context` | Airbnb search URL used as the source context. |
| `fetched_at` | ISO timestamp for when the listing was collected. |

## How to scrape Airbnb listing data

1. Open Airbnb and create a search for your target location, dates, guest count, and filters.
2. Copy the Airbnb search URL from your browser address bar.
3. Open Airbnb Listings Scraper on Apify.
4. Paste one or more URLs into `urls`.
5. Set `results_wanted` to the maximum number of listings you want to save.
6. Run the Actor.
7. Download the dataset or connect it to your workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `urls` | Array of strings | No | London search URL prefill | One or more Airbnb `/s/.../homes` search URLs. The Actor processes the URLs until `results_wanted` is reached or all sources are exhausted. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique listing records to save. Minimum value is `1`. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Optional Apify Proxy settings for runs that need proxy routing. |

## Output Data

Each dataset item represents one Airbnb listing from the supplied search context. Fields may be omitted when Airbnb does not publish that value for a listing.

| Field | Type | Description |
|-------|------|-------------|
| `listing_id` | String | Airbnb listing numeric identifier. |
| `listing_url` | String | Direct Airbnb listing URL. |
| `title` | String | Listing title. |
| `subtitle` | String | Listing subtitle. |
| `name_localized` | String | Localized listing name. |
| `room_type` | String | Property room or home type. |
| `city` | String | Localized city or place name. |
| `category` | String | Airbnb room or property category label. |
| `bed_label` | String | Bed or room summary label. |
| `person_capacity` | Number | Maximum number of guests. |
| `is_superhost` | Boolean | Host superhost status when available. |
| `host_name` | String | Host name when available. |
| `latitude` | Number | Listing latitude. |
| `longitude` | Number | Listing longitude. |
| `rating` | Number | Average rating score. |
| `reviews_count` | Number | Number of reviews. |
| `rating_label` | String | Rating label text. |
| `nightly_price` | String | Primary nightly price text. |
| `nightly_price_qualifier` | String | Nightly price qualifier text. |
| `price_accessibility_label` | String | Expanded price text when available. |
| `total_price_line` | String | Secondary total price line. |
| `price_display_style` | String | Price presentation style. |
| `review_snippet` | String | Short review snippet. |
| `badges` | Array | Listing badge labels. |
| `image_urls` | Array | Listing image URLs. |
| `search_rank` | Number | Rank order in collected search results. |
| `search_context` | String | Airbnb search URL used for the run. |
| `fetched_at` | String | Collection timestamp in ISO format. |

## Usage Examples

### Basic Airbnb Search Extraction

Collect 20 listings from one Airbnb search URL:

```json
{
  "urls": [
    "https://www.airbnb.com/s/London--United-Kingdom/homes?checkin=2026-05-13&checkout=2026-05-14&adults=1"
  ],
  "results_wanted": 20
}
```

### Multiple Airbnb Search URLs

Collect listings from more than one market in the same run:

```json
{
  "urls": [
    "https://www.airbnb.com/s/London--United-Kingdom/homes?checkin=2026-05-13&checkout=2026-05-14&adults=1",
    "https://www.airbnb.com/s/Paris--France/homes?checkin=2026-05-13&checkout=2026-05-14&adults=1"
  ],
  "results_wanted": 50
}
```

### Larger Run With Proxy Configuration

Use Apify Proxy settings when running larger Airbnb collection jobs:

```json
{
  "urls": [
    "https://www.airbnb.com/s/New-York--NY--United-States/homes?checkin=2026-06-10&checkout=2026-06-15&adults=2"
  ],
  "results_wanted": 100,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

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
  "category": "Apartment",
  "bed_label": "2 beds",
  "person_capacity": 4,
  "is_superhost": true,
  "host_name": "Alex",
  "latitude": 51.5072,
  "longitude": -0.1276,
  "rating": 4.93,
  "reviews_count": 165,
  "rating_label": "Rated 4.93 out of 5 from 165 reviews",
  "nightly_price": "$61",
  "nightly_price_qualifier": "for 1 night",
  "total_price_line": "$61 total",
  "badges": [
    "Guest favorite"
  ],
  "image_urls": [
    "https://a0.muscache.com/im/pictures/example.jpg"
  ],
  "search_rank": 1,
  "search_context": "https://www.airbnb.com/s/London--United-Kingdom/homes?checkin=2026-05-13&checkout=2026-05-14&adults=1",
  "fetched_at": "2026-07-29T12:30:00.000Z"
}
```

## Tips for Best Results

- Use complete Airbnb search URLs copied from your browser after setting location, dates, guests, and filters.
- Start with `results_wanted: 20` to confirm the search returns the fields you need.
- Use separate URLs for different cities, neighborhoods, date ranges, or guest counts.
- Keep date filters realistic when collecting pricing and availability snapshots.
- Increase `results_wanted` gradually for larger markets.
- Enable proxy settings when running larger or scheduled collection jobs.
- If some fields are missing, check the original Airbnb search results. Not every listing publishes the same details in search.

## Integrations

- **Google Sheets** - Send Airbnb listing data to spreadsheets for quick review and sharing.
- **CSV and Excel** - Download datasets for market research, pricing models, and reporting.
- **JSON** - Use structured output in apps, dashboards, and AI or RAG workflows.
- **Webhooks** - Trigger downstream processes after each run finishes.
- **Make or Zapier** - Connect new listing data to no-code automation workflows.
- **API** - Access datasets programmatically from your own systems.

## Frequently Asked Questions

### Can I export Airbnb listing data to CSV or Excel?

Yes. Apify datasets can be downloaded in CSV, Excel, JSON, XML, and other supported formats.

### Can I scrape more than one Airbnb location in one run?

Yes. Add multiple Airbnb search URLs to `urls`. The Actor processes them in order until it reaches `results_wanted` or all sources are exhausted.

### Can I control dates, guests, and filters?

Yes. Set the dates, guests, and filters on Airbnb first, then copy the resulting search URL into `urls`.

### Does this Actor collect detailed property page data?

The Actor focuses on listing data available from Airbnb search result contexts. It is best for market-level datasets, ranking analysis, pricing snapshots, and property discovery.

### Why are some output fields missing?

Some fields may be missing because Airbnb does not publish the same values for every listing or search result. The Actor saves available fields and leaves unavailable fields out of the record.

### Can I run Airbnb Listings Scraper on a schedule?

Yes. Use Apify schedules to run the Actor hourly, daily, weekly, or at another interval for monitoring workflows.

### Is this Airbnb scraper suitable for non-technical users?

Yes. You can run it from Apify Console with form-based inputs, then download the dataset without writing code.

### Is it legal to scrape Airbnb?

Scraping public web data can be legal, but you are responsible for complying with applicable laws, Airbnb's terms, privacy rules, and any restrictions that apply to your use case.

## Related Actors

- [Airbnb Reviews Scraper](https://apify.com/shahidirfan/airbnb-reviews-scraper) - Extract Airbnb stay reviews using room URLs or property IDs for reputation monitoring and guest feedback analysis.
- [VRBO Property Scraper](https://apify.com/shahidirfan/vrbo-property-scraper) - Collect vacation rental listings from VRBO for rental market research and competitor tracking.

## Support

For issues, feature requests, or custom Airbnb data extraction work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate data collection from publicly available Airbnb search result pages. Users are responsible for using the data responsibly and complying with applicable laws, website terms, and privacy requirements.

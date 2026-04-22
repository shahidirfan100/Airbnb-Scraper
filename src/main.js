import { readFile, writeFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

const STAYS_SEARCH_OPERATION_NAME = 'StaysSearch';
const DEFAULT_STAYS_SEARCH_OPERATION_ID = '753d97c7b19a1a402d2fa63882ff4d6802004d11f2499647deef923a19a1641a';
const DEFAULT_LOCALE = 'en';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_RESULTS_PER_PAGE_ESTIMATE = 18;
const DEFAULT_CURSOR_VERSION = 1;
const MAX_SYNTHETIC_CURSOR_PROBES = 8;
const MAX_CONSECUTIVE_EMPTY_UNIQUE_PAGES = 10;

const AIRBNB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';

const RAW_PARAM_ALIASES = {
    section_offset: 'sectionOffset',
    items_offset: 'itemsOffset',
    refinement_paths: 'refinementPaths',
    items_per_grid: 'itemsPerGrid',
    cdn_cache_safe: 'cdnCacheSafe',
    tab_id: 'tabId',
};

const safePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const cleanString = (value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
};

const asText = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return cleanString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return cleanString(String(value));
    if (Array.isArray(value)) {
        for (const item of value) {
            const extracted = asText(item);
            if (extracted) return extracted;
        }
        return undefined;
    }
    if (typeof value === 'object') {
        return cleanString(value.localizedStringWithTranslationPreference)
            || cleanString(value.localizedString)
            || cleanString(value.comments)
            || cleanString(value.text)
            || cleanString(value.body)
            || cleanString(value.name)
            || cleanString(value.title)
            || undefined;
    }

    return cleanString(String(value));
};

const compact = (value) => {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const out = value.map(compact).filter((item) => item !== undefined);
        return out.length ? out : undefined;
    }

    if (typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            const compacted = compact(val);
            if (compacted !== undefined) out[key] = compacted;
        }
        return Object.keys(out).length ? out : undefined;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : undefined;
    }

    return value;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const decodeRepeatedURIComponent = (value, maxDepth = 3) => {
    let current = value;

    for (let i = 0; i < maxDepth; i++) {
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current) break;
            current = decoded;
        } catch {
            break;
        }
    }

    return current;
};

const decodeBase64 = (value) => {
    try {
        const decoded = Buffer.from(String(value), 'base64').toString('utf8');
        return decoded || undefined;
    } catch {
        return undefined;
    }
};

const encodeBase64 = (value) => Buffer.from(String(value), 'utf8').toString('base64');

const stripTrailingNoise = (value) => value.replace(/[)\],.]+$/g, '');

const extractAirbnbUrlCandidate = (inputValue) => {
    const raw = cleanString(inputValue);
    if (!raw) return undefined;

    const direct = raw.match(/https?:\/\/(?:www\.)?airbnb\.[^\s"'<>]+/i);
    if (direct?.[0]) return stripTrailingNoise(direct[0]);

    const decoded = decodeRepeatedURIComponent(raw);
    const nested = decoded.match(/https?:\/\/(?:www\.)?airbnb\.[^\s"'<>]+/i);
    if (nested?.[0]) return stripTrailingNoise(nested[0]);

    return undefined;
};

const extractNumericIdFromUrl = (urlString) => {
    try {
        const parsed = new URL(urlString);
        const fromParam = parsed.searchParams.get('room_id')
            || parsed.searchParams.get('roomId')
            || parsed.searchParams.get('listing_id')
            || parsed.searchParams.get('listingId')
            || parsed.searchParams.get('propertyId');
        const fromParamMatch = fromParam?.match(/(\d{6,})/);
        if (fromParamMatch?.[1]) return fromParamMatch[1];

        const roomPath = parsed.pathname.match(/\/rooms\/(\d{6,})(?:[/?#]|$)/i);
        if (roomPath?.[1]) return roomPath[1];
    } catch {
        return undefined;
    }

    return undefined;
};

const extractNumericId = (inputValue) => {
    if (!inputValue) return undefined;

    const raw = String(inputValue).trim();
    if (!raw) return undefined;

    const decoded = decodeBase64(raw);
    const candidateValues = [raw, decodeRepeatedURIComponent(raw), decoded, extractAirbnbUrlCandidate(raw)].filter(Boolean);

    for (const candidate of candidateValues) {
        const direct = candidate.match(/^(\d{6,})$/);
        if (direct?.[1]) return direct[1];

        const prefixed = candidate.match(/(?:StayListing|DemandStayListing):(\d{6,})/i);
        if (prefixed?.[1]) return prefixed[1];

        const fromUrl = extractNumericIdFromUrl(candidate);
        if (fromUrl) return fromUrl;

        const anyLongNumber = candidate.match(/\b(\d{6,})\b/);
        if (anyLongNumber?.[1] && /airbnb|listing|room|property/i.test(candidate)) return anyLongNumber[1];
    }

    return undefined;
};

const loadLocalInputFallback = async () => {
    try {
        const filePath = new URL('../INPUT.json', import.meta.url);
        const content = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const maybeProxyUrl = async (proxyConfiguration) => {
    if (!proxyConfiguration) return undefined;
    return proxyConfiguration.newUrl();
};

const fetchText = async ({ url, proxyConfiguration, accept = 'text/html,application/xhtml+xml' }) => gotScraping.get(url, {
    proxyUrl: await maybeProxyUrl(proxyConfiguration),
    headers: {
        'user-agent': AIRBNB_USER_AGENT,
        accept,
        'accept-language': 'en-US,en;q=0.9',
    },
    timeout: { request: 30000 },
    retry: { limit: 2 },
});

const extractApiKeyFromHtml = (html) => {
    const match = html.match(/"api_config"\s*:\s*\{[\s\S]{0,600}?"key"\s*:\s*"([^"]+)"/);
    return cleanString(match?.[1]);
};

const extractDeferredVariables = (html) => {
    const scriptMatch = html.match(/<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch?.[1]) return undefined;

    try {
        const payload = JSON.parse(scriptMatch[1]);
        const niobeClientData = asArray(payload?.niobeClientData);
        const staysSearchEntry = niobeClientData.find((entry) => typeof entry?.[0] === 'string' && entry[0].startsWith('StaysSearch:'));
        if (!staysSearchEntry) return undefined;

        const key = String(staysSearchEntry[0]);
        const variables = JSON.parse(key.slice('StaysSearch:'.length));
        return variables && typeof variables === 'object' ? variables : undefined;
    } catch {
        return undefined;
    }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findOperationHashNearText = (text, operationName) => {
    const escapedName = escapeRegExp(operationName);
    const patterns = [
        new RegExp(`"${escapedName}"[\\s\\S]{0,600}?(?:sha256Hash|queryId|operationId|id)\\"?\\s*[:=]\\s*\\"([a-f0-9]{64})\\"`, 'i'),
        new RegExp(`(?:sha256Hash|queryId|operationId|id)\\"?\\s*[:=]\\s*\\"([a-f0-9]{64})\\"[\\s\\S]{0,600}?"${escapedName}"`, 'i'),
        new RegExp(`${escapedName}[\\s\\S]{0,300}?([a-f0-9]{64})`, 'i'),
        new RegExp(`([a-f0-9]{64})[\\s\\S]{0,300}?${escapedName}`, 'i'),
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].toLowerCase();
    }

    return undefined;
};

const extractScriptUrls = (html, baseUrl) => {
    const urls = new Set();
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;

    for (const match of html.matchAll(scriptRegex)) {
        const src = cleanString(match[1]);
        if (!src) continue;

        try {
            const absolute = new URL(src, baseUrl).toString();
            if (!/\.js(?:$|\?)/i.test(absolute)) continue;
            if (!/airbnb\./i.test(absolute)) continue;
            urls.add(absolute);
        } catch {
            continue;
        }
    }

    return Array.from(urls);
};

const discoverOperationIdFromBootstrap = async ({ operationName, bootstrapHtml, bootstrapUrl, proxyConfiguration }) => {
    const fromHtml = findOperationHashNearText(bootstrapHtml, operationName);
    if (fromHtml) return fromHtml;

    const scriptUrls = extractScriptUrls(bootstrapHtml, bootstrapUrl);
    for (const scriptUrl of scriptUrls.slice(0, 24)) {
        try {
            const response = await fetchText({
                url: scriptUrl,
                proxyConfiguration,
                accept: '*/*',
            });
            const discovered = findOperationHashNearText(response.body, operationName);
            if (discovered) return discovered;
        } catch {
            continue;
        }
    }

    return undefined;
};

const buildSeedUrl = ({ url }) => {
    const explicitUrl = extractAirbnbUrlCandidate(url);
    if (explicitUrl) return explicitUrl;

    return undefined;
};

const buildRawParamsFromInput = ({ url, adults }) => {
    const explicitUrl = extractAirbnbUrlCandidate(url);
    if (!explicitUrl) return [];

    const parsed = new URL(explicitUrl);
    const grouped = new Map();

    parsed.searchParams.forEach((value, key) => {
        const normalizedKey = key.replace(/\[\]$/g, '');
        const canonicalKey = RAW_PARAM_ALIASES[normalizedKey] || normalizedKey;
        if (!grouped.has(canonicalKey)) grouped.set(canonicalKey, []);
        grouped.get(canonicalKey).push(String(value));
    });

    const pathMatch = parsed.pathname.match(/^\/s\/([^/]+)\/homes/i);
    if (!grouped.has('query') && pathMatch?.[1]) {
        const query = decodeURIComponent(pathMatch[1]).replace(/--/g, ', ').replace(/-/g, ' ');
        grouped.set('query', [query]);
    }

    if (!grouped.has('refinementPaths')) {
        grouped.set('refinementPaths', ['/homes']);
    }

    if (!grouped.has('adults')) {
        grouped.set('adults', [String(safePositiveInt(adults, 1))]);
    }

    const rawParams = [];
    for (const [filterName, filterValues] of grouped.entries()) {
        rawParams.push({
            filterName,
            filterValues: asArray(filterValues).map((item) => String(item)),
        });
    }

    return rawParams;
};

const normalizeRawParams = (rawParamsInput) => {
    const out = [];
    const input = asArray(rawParamsInput);

    for (const entry of input) {
        if (!entry || typeof entry !== 'object') continue;
        const rawFilterName = cleanString(entry.filterName);
        const filterName = rawFilterName ? (RAW_PARAM_ALIASES[rawFilterName] || rawFilterName) : undefined;
        if (!filterName) continue;
        const filterValues = asArray(entry.filterValues).map((item) => String(item));
        if (!filterValues.length) continue;
        out.push({ filterName, filterValues });
    }

    return out;
};

const buildSearchVariables = ({ rawParams }) => {
    const normalized = normalizeRawParams(rawParams);
    const requestShape = {
        metadataOnly: false,
        rawParams: normalized,
    };

    return {
        aiSearchEnabled: false,
        isLeanTreatment: false,
        staysSearchRequest: requestShape,
        staysMapSearchRequestV2: requestShape,
    };
};

const setRawParamValue = (rawParamsInput, name, value) => {
    const canonicalName = RAW_PARAM_ALIASES[name] || name;
    const rawParams = asArray(rawParamsInput).map((entry) => ({ ...entry }));
    const idx = rawParams.findIndex((entry) => entry?.filterName === canonicalName);

    if (value === undefined || value === null || value === '') {
        if (idx >= 0) rawParams.splice(idx, 1);
        return rawParams;
    }

    const valueString = String(value);
    if (idx >= 0) {
        rawParams[idx].filterValues = [valueString];
    } else {
        rawParams.push({ filterName: canonicalName, filterValues: [valueString] });
    }

    return rawParams;
};

const applyCursorToVariables = (variables, cursor) => {
    if (!cursor) return;
    const decoded = decodeBase64(cursor);
    if (!decoded) return;

    let parsed;
    try {
        parsed = JSON.parse(decoded);
    } catch {
        return;
    }

    const sectionOffset = parsed?.section_offset;
    const itemsOffset = parsed?.items_offset;

    for (const requestObject of [variables?.staysSearchRequest, variables?.staysMapSearchRequestV2]) {
        if (!requestObject || typeof requestObject !== 'object') continue;
        const withoutLegacySection = setRawParamValue(requestObject.rawParams, 'section_offset', undefined);
        const withoutLegacyItems = setRawParamValue(withoutLegacySection, 'items_offset', undefined);
        const withSection = setRawParamValue(withoutLegacyItems, 'sectionOffset', sectionOffset);
        requestObject.rawParams = setRawParamValue(withSection, 'itemsOffset', itemsOffset);
    }
};

const decodeCursorPayload = (cursor) => {
    if (!cursor) return undefined;

    const decoded = decodeBase64(cursor);
    if (!decoded) return undefined;

    try {
        const parsed = JSON.parse(decoded);
        const sectionOffset = Number.isFinite(parsed?.section_offset) ? parsed.section_offset : 0;
        const itemsOffset = Number.isFinite(parsed?.items_offset) ? parsed.items_offset : undefined;
        const version = Number.isFinite(parsed?.version) ? parsed.version : DEFAULT_CURSOR_VERSION;
        if (itemsOffset === undefined) return undefined;
        return {
            sectionOffset,
            itemsOffset,
            version,
        };
    } catch {
        return undefined;
    }
};

const buildCursorToken = ({ sectionOffset, itemsOffset, version = DEFAULT_CURSOR_VERSION }) => encodeBase64(JSON.stringify({
    section_offset: sectionOffset,
    items_offset: itemsOffset,
    version,
}));

const getItemsPerGrid = (baseVariables) => {
    const rawParams = asArray(baseVariables?.staysSearchRequest?.rawParams);
    const found = rawParams.find((entry) => entry?.filterName === 'itemsPerGrid' || entry?.filterName === 'items_per_grid');
    const value = found?.filterValues?.[0];
    return safePositiveInt(value, DEFAULT_RESULTS_PER_PAGE_ESTIMATE);
};

// Adds all discovered cursors into a queue while preserving API-returned order.
// This avoids skipping valid cursors that may share the same items_offset.
const collectCursors = (paginationInfo, queue, queuedCursors, visitedCursors) => {
    const next = cleanString(paginationInfo?.nextPageCursor);
    const pages = asArray(paginationInfo?.pageCursors).map((c) => cleanString(c)).filter(Boolean);

    for (const c of [next, ...pages].filter(Boolean)) {
        if (visitedCursors.has(c) || queuedCursors.has(c)) continue;
        queue.push(c);
        queuedCursors.add(c);
    }
};

const takeNextCursor = (queue, queuedCursors, visitedCursors) => {
    while (queue.length > 0) {
        const cursor = queue.shift();
        queuedCursors.delete(cursor);
        if (!visitedCursors.has(cursor)) return cursor;
    }

    return undefined;
};

const buildVariablesForPage = (baseVariables, cursor) => {
    const variables = JSON.parse(JSON.stringify(baseVariables));
    if (cursor) applyCursorToVariables(variables, cursor);
    return variables;
};

const buildExtensions = (operationId) => ({
    persistedQuery: {
        version: 1,
        sha256Hash: operationId,
    },
});

const buildSearchUrl = ({ locale, currency, variables, operationId }) => (
    `https://www.airbnb.com/api/v3/${STAYS_SEARCH_OPERATION_NAME}?operationName=${STAYS_SEARCH_OPERATION_NAME}`
    + `&locale=${encodeURIComponent(locale)}&currency=${encodeURIComponent(currency)}`
    + `&variables=${encodeURIComponent(JSON.stringify(variables))}`
    + `&extensions=${encodeURIComponent(JSON.stringify(buildExtensions(operationId)))}`
);

const requestJson = async ({ url, apiKey, proxyConfiguration, referer }) => {
    const response = await gotScraping.get(url, {
        proxyUrl: await maybeProxyUrl(proxyConfiguration),
        headers: {
            'user-agent': AIRBNB_USER_AGENT,
            'x-airbnb-api-key': apiKey,
            accept: 'application/json',
            'accept-language': 'en-US,en;q=0.9',
            referer,
        },
        timeout: { request: 45000 },
        retry: { limit: 2 },
        throwHttpErrors: false,
    });

    let json;
    try {
        json = JSON.parse(response.body);
    } catch {
        const error = new Error(`Invalid JSON from Airbnb API (HTTP ${response.statusCode}).`);
        error.statusCode = response.statusCode;
        error.responseBody = response.body;
        throw error;
    }

    if (response.statusCode >= 400) {
        const error = new Error(`Airbnb API returned HTTP ${response.statusCode}.`);
        error.statusCode = response.statusCode;
        error.responseBody = response.body;
        error.payload = json;
        throw error;
    }

    if (Array.isArray(json?.errors) && json.errors.length) {
        const error = new Error('Airbnb API returned GraphQL errors.');
        error.statusCode = response.statusCode;
        error.responseBody = response.body;
        error.payload = json;
        throw error;
    }

    return json;
};

const normalizeErrorText = (error) => {
    const payload = error?.payload ? JSON.stringify(error.payload) : '';
    const body = cleanString(error?.responseBody) || '';
    const message = cleanString(error?.message) || '';
    return `${message} ${body} ${payload}`.toLowerCase();
};

const isPersistedQueryIssue = (error) => {
    const text = normalizeErrorText(error);
    return text.includes('persisted') || text.includes('sha256') || text.includes('queryid') || text.includes('validationerror');
};

const isApiKeyIssue = (error) => {
    if (error?.statusCode === 401 || error?.statusCode === 403) return true;
    const text = normalizeErrorText(error);
    return text.includes('api key') || text.includes('x-airbnb-api-key') || text.includes('unauthorized');
};

const getBootstrapData = async ({ seedUrl, proxyConfiguration }) => {
    const candidates = Array.from(new Set([
        cleanString(seedUrl),
        extractAirbnbUrlCandidate(seedUrl),
        'https://www.airbnb.com/s/London--United-Kingdom/homes',
        'https://www.airbnb.com/',
    ].filter(Boolean)));

    let firstSuccessful;

    for (const url of candidates) {
        try {
            const response = await fetchText({ url, proxyConfiguration });
            const html = response.body;
            const apiKey = extractApiKeyFromHtml(html);
            const deferredVariables = extractDeferredVariables(html);
            if (!firstSuccessful) firstSuccessful = { html, url, apiKey, deferredVariables };
            if (apiKey) return { html, url, apiKey, deferredVariables };
        } catch (error) {
            log.warning(`Could not read bootstrap data from ${url}: ${error.message}`);
        }
    }

    if (firstSuccessful) return firstSuccessful;
    throw new Error('Unable to load Airbnb bootstrap page data.');
};

const refreshAirbnbApiContext = async ({
    seedUrl,
    proxyConfiguration,
    existingContext = {},
    refreshHash = true,
    refreshKey = true,
}) => {
    const context = {
        staysSearchOperationId: cleanString(existingContext.staysSearchOperationId),
        apiKey: cleanString(existingContext.apiKey),
        bootstrapUrl: cleanString(existingContext.bootstrapUrl),
        deferredVariables: existingContext.deferredVariables,
    };

    const bootstrap = await getBootstrapData({ seedUrl, proxyConfiguration });
    context.bootstrapUrl = bootstrap.url;
    context.deferredVariables = bootstrap.deferredVariables;

    if (refreshKey || !context.apiKey) {
        context.apiKey = cleanString(bootstrap.apiKey) || context.apiKey;
    }

    if (refreshHash || !context.staysSearchOperationId) {
        const discoveredHash = await discoverOperationIdFromBootstrap({
            operationName: STAYS_SEARCH_OPERATION_NAME,
            bootstrapHtml: bootstrap.html,
            bootstrapUrl: bootstrap.url,
            proxyConfiguration,
        });
        context.staysSearchOperationId = discoveredHash || context.staysSearchOperationId;
    }

    context.staysSearchOperationId = context.staysSearchOperationId || DEFAULT_STAYS_SEARCH_OPERATION_ID;

    if (!context.apiKey) {
        throw new Error('Unable to discover Airbnb API key from bootstrap data.');
    }

    return context;
};

const refreshApiDiscoveryFile = async ({ staysSearchOperationId }) => {
    try {
        const filePath = 'API_DISCOVERY.md';
        const content = await readFile(filePath, 'utf8');

        let next = content.replace(
            /(- Operation name:\s*StaysSearch[\s\S]*?- Operation ID:\s*)([a-f0-9]{64})/i,
            `$1${staysSearchOperationId}`,
        );

        const runtimeSection = [
            '## Runtime Auto-Refresh',
            `- Runtime StaysSearch Operation ID: ${staysSearchOperationId}`,
            `- Last Runtime Refresh UTC: ${new Date().toISOString()}`,
        ].join('\n');

        if (/## Runtime Auto-Refresh/i.test(next)) {
            next = next.replace(/## Runtime Auto-Refresh[\s\S]*$/i, runtimeSection);
        } else {
            next = `${next.trim()}\n\n${runtimeSection}\n`;
        }

        if (next !== content) {
            await writeFile(filePath, next, 'utf8');
        }
    } catch {
        // Keep runtime resilient even when docs cannot be updated in read-only deployments.
    }
};

const parseRating = (value) => {
    const text = cleanString(value);
    if (!text) return { rating: undefined, reviewsCount: undefined };

    const rating = Number.parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] || '');
    const reviewsCount = Number.parseInt(text.match(/\((\d+)\)/)?.[1] || '', 10);
    return {
        rating: Number.isFinite(rating) ? rating : undefined,
        reviewsCount: Number.isFinite(reviewsCount) ? reviewsCount : undefined,
    };
};

const mapListingItem = ({ item, rank, searchContext }) => {
    const propertyId = extractNumericId(item?.propertyId) || extractNumericId(item?.demandStayListing?.id);
    const ratingData = parseRating(item?.avgRatingLocalized || item?.avgRatingA11yLabel);
    const titleText = asText(item?.title);
    const subtitleText = asText(item?.subtitle);
    const inferredRoomType = cleanString(titleText?.split(' in ')[0]);
    const inferredCity = cleanString(titleText?.split(' in ').slice(1).join(' in '));

    return compact({
        listing_id: propertyId,
        listing_url: propertyId ? `https://www.airbnb.com/rooms/${propertyId}` : undefined,
        title: titleText,
        subtitle: subtitleText,
        name_localized: asText(item?.nameLocalized) || asText(item?.demandStayListing?.description?.name),
        room_type: asText(item?.demandStayListing?.homeType) || inferredRoomType,
        city: asText(item?.demandStayListing?.localizedCity) || inferredCity,
        category: asText(item?.demandStayListing?.roomAndPropertyType) || asText(item?.listingParamOverrides?.categoryTag),
        bed_label: asText(item?.demandStayListing?.bedLabel) || asText(item?.structuredContent?.primaryLine),
        person_capacity: item?.demandStayListing?.personCapacity || item?.listingParamOverrides?.adults,
        is_superhost: item?.demandStayListing?.hostProfile?.isSuperhost,
        host_name: asText(item?.demandStayListing?.hostProfile?.name),
        latitude: item?.demandStayListing?.location?.coordinate?.latitude || item?.demandStayListing?.coordinate?.latitude,
        longitude: item?.demandStayListing?.location?.coordinate?.longitude || item?.demandStayListing?.coordinate?.longitude,
        rating: ratingData.rating,
        reviews_count: ratingData.reviewsCount,
        rating_label: item?.avgRatingA11yLabel,
        nightly_price: item?.structuredDisplayPrice?.primaryLine?.price,
        nightly_price_qualifier: item?.structuredDisplayPrice?.primaryLine?.qualifier,
        price_accessibility_label: item?.structuredDisplayPrice?.primaryLine?.accessibilityLabel,
        total_price_line: item?.structuredDisplayPrice?.secondaryLine?.price,
        price_display_style: item?.structuredDisplayPrice?.displayPriceStyle,
        review_snippet: asText(item?.structuredContent?.reviewSnippet),
        badges: asArray(item?.badges).map((badge) => badge?.text || badge?.title || badge?.label).filter(Boolean),
        image_urls: asArray(item?.contextualPictures).map((picture) => picture?.picture).filter(Boolean),
        search_rank: rank,
        search_context: searchContext,
        fetched_at: new Date().toISOString(),
    });
};

const buildDedupKey = (mapped) => {
    const listingId = cleanString(mapped?.listing_id);
    if (listingId) return `id:${listingId}`;

    const listingUrl = cleanString(mapped?.listing_url);
    if (listingUrl) return `url:${listingUrl}`;

    const title = cleanString(mapped?.title);
    const nightlyPrice = cleanString(mapped?.nightly_price);
    const lat = Number.isFinite(mapped?.latitude) ? mapped.latitude : undefined;
    const lng = Number.isFinite(mapped?.longitude) ? mapped.longitude : undefined;
    const coordinateKey = lat !== undefined && lng !== undefined ? `${lat},${lng}` : undefined;

    const fallback = [title, coordinateKey, nightlyPrice].filter(Boolean);
    return fallback.length ? `fallback:${fallback.join('|')}` : undefined;
};

const fetchListings = async ({
    targetCount,
    maxPages,
    locale,
    currency,
    apiContext,
    proxyConfiguration,
    searchContext,
    seedUrl,
    baseVariables,
}) => {
    const rows = [];
    const seenListingKeys = new Set();
    // visitedCursors: tokens we have already used to make a request.
    const visitedCursors = new Set();
    // Cursors that are discovered but not requested yet.
    const cursorQueue = [];
    const queuedCursors = new Set();
    const syntheticOffsetsUsed = new Set();
    const itemsPerGrid = getItemsPerGrid(baseVariables);
    let maxObservedItemsOffset = 0;
    let syntheticProbeCount = 0;
    let consecutiveNoNewPages = 0;
    let currentCursor;   // undefined = first page (no cursor)
    let page = 1;

    while (rows.length < targetCount && page <= maxPages) {
        // Mark current cursor used so we never re-request the same page.
        visitedCursors.add(currentCursor ?? '');

        const variables = buildVariablesForPage(baseVariables, currentCursor);

        const runRequest = async () => requestJson({
            url: buildSearchUrl({
                locale,
                currency,
                variables,
                operationId: apiContext.staysSearchOperationId,
            }),
            apiKey: apiContext.apiKey,
            proxyConfiguration,
            referer: apiContext.bootstrapUrl || seedUrl,
        });

        let json;
        try {
            json = await runRequest();
        } catch (error) {
            const refreshHash = isPersistedQueryIssue(error);
            const refreshKey = isApiKeyIssue(error) || !apiContext.apiKey;
            if (!refreshHash && !refreshKey) throw error;

            const previousHash = apiContext.staysSearchOperationId;
            const previousKey = apiContext.apiKey;
            const refreshed = await refreshAirbnbApiContext({
                seedUrl,
                proxyConfiguration,
                existingContext: apiContext,
                refreshHash,
                refreshKey,
            });

            Object.assign(apiContext, refreshed);
            const contextChanged = previousHash !== apiContext.staysSearchOperationId || previousKey !== apiContext.apiKey;
            if (!contextChanged) throw error;

            log.warning(`Auto-healed Airbnb API context (hash refreshed: ${refreshHash}, key refreshed: ${refreshKey}).`);
            await refreshApiDiscoveryFile({ staysSearchOperationId: apiContext.staysSearchOperationId });
            json = await runRequest();
        }

        const results = json?.data?.presentation?.staysSearch?.results;
        const items = asArray(results?.searchResults);

        // Harvest cursor tokens before item handling so queue state is always current.
        collectCursors(results?.paginationInfo, cursorQueue, queuedCursors, visitedCursors);

        const observedCursors = asArray(results?.paginationInfo?.pageCursors)
            .map((cursor) => decodeCursorPayload(cleanString(cursor)))
            .filter(Boolean);
        for (const payload of observedCursors) {
            maxObservedItemsOffset = Math.max(maxObservedItemsOffset, payload.itemsOffset);
        }

        if (!items.length) {
            // API returned genuinely empty results — no listings at all on this page.
            log.debug(`Page ${page} returned no listings from API.`);
            consecutiveNoNewPages++;
        } else {
            const beforePageCount = rows.length;

            for (const item of items) {
                const mapped = mapListingItem({ item, rank: rows.length + 1, searchContext });
                if (!mapped) continue;

                const dedupKey = buildDedupKey(mapped);
                if (dedupKey && seenListingKeys.has(dedupKey)) continue;
                if (dedupKey) seenListingKeys.add(dedupKey);

                rows.push(mapped);
                if (rows.length >= targetCount) break;
            }

            const newThisPage = rows.length - beforePageCount;
            log.info(`Processed page ${page}: ${newThisPage} new listing(s), ${rows.length} total unique.`);
            consecutiveNoNewPages = newThisPage > 0 ? 0 : consecutiveNoNewPages + 1;

            if (rows.length >= targetCount) break;
        }

        const next = takeNextCursor(cursorQueue, queuedCursors, visitedCursors);
        if (next) {
            currentCursor = next;
            page++;
            continue;
        }

        const nextSyntheticOffset = maxObservedItemsOffset + itemsPerGrid;
        if (
            page >= maxPages
            || syntheticOffsetsUsed.has(nextSyntheticOffset)
            || syntheticProbeCount >= MAX_SYNTHETIC_CURSOR_PROBES
            || consecutiveNoNewPages >= MAX_CONSECUTIVE_EMPTY_UNIQUE_PAGES
        ) {
            log.info(`All available cursors exhausted after page ${page}. Source fully scraped.`);
            break;
        }

        syntheticOffsetsUsed.add(nextSyntheticOffset);
        syntheticProbeCount++;
        maxObservedItemsOffset = nextSyntheticOffset;
        currentCursor = buildCursorToken({ sectionOffset: 0, itemsOffset: nextSyntheticOffset });
        log.info(`Cursor pool exhausted; probing additional offset ${nextSyntheticOffset}.`);
        page++;
    }

    if (rows.length < targetCount) {
        log.info(`Source exhausted before target count. Saved ${rows.length} unique listing(s) out of requested ${targetCount}.`);
    }

    return rows;
};

await Actor.main(async () => {
    const actorInput = (await Actor.getInput()) || {};
    const fallbackInput = await loadLocalInputFallback();
    const input = {
        ...fallbackInput,
        ...actorInput,
    };

    const {
        url,
        adults = 1,
        results_wanted: resultsWantedInput = 20,
        max_pages: maxPagesInput = 5,
        locale = DEFAULT_LOCALE,
        currency = DEFAULT_CURRENCY,
        proxyConfiguration,
    } = input;

    const runtimeUrl = cleanString(url);
    if (!runtimeUrl) {
        throw new Error('Provide a valid Airbnb search url, or set one in INPUT.json for fallback runs.');
    }

    const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

    const resultsWanted = safePositiveInt(resultsWantedInput, 20);
    const userProvidedMaxPages = Object.hasOwn(input, 'max_pages');  // check merged input, not just actorInput
    const configuredMaxPages = safePositiveInt(maxPagesInput, 5);
    // Allow enough pages: each real Airbnb page holds ~18 listings, but the API may return
    // duplicate pages between real ones, so we triple the estimate to account for skipped pages.
    const maxPages = userProvidedMaxPages
        ? configuredMaxPages
        : Math.max(configuredMaxPages, Math.ceil((resultsWanted / DEFAULT_RESULTS_PER_PAGE_ESTIMATE) * 3) + 5);

    log.info(`Starting scrape: resultsWanted=${resultsWanted}, maxPages=${maxPages}, url=${runtimeUrl}`);

    const seedUrl = buildSeedUrl({ url: runtimeUrl });
    const searchContext = runtimeUrl || seedUrl;

    const apiContext = await refreshAirbnbApiContext({
        seedUrl,
        proxyConfiguration: proxyConfig,
        existingContext: {
            staysSearchOperationId: DEFAULT_STAYS_SEARCH_OPERATION_ID,
        },
        refreshHash: true,
        refreshKey: true,
    });

    await refreshApiDiscoveryFile({ staysSearchOperationId: apiContext.staysSearchOperationId });

    const deferredVariables = apiContext.deferredVariables && typeof apiContext.deferredVariables === 'object'
        ? apiContext.deferredVariables
        : undefined;

    const baseVariables = deferredVariables || buildSearchVariables({
        rawParams: buildRawParamsFromInput({ url: runtimeUrl, adults }),
    });

    const listings = await fetchListings({
        targetCount: resultsWanted,
        maxPages,
        locale: cleanString(locale) || DEFAULT_LOCALE,
        currency: cleanString(currency) || DEFAULT_CURRENCY,
        apiContext,
        proxyConfiguration: proxyConfig,
        searchContext,
        seedUrl,
        baseVariables,
    });

    if (!listings.length) {
        throw new Error('No listings found. Try another Airbnb search URL or broader search filters.');
    }

    await Actor.pushData(listings);
    log.info(`Saved ${listings.length} listing(s).`);
});

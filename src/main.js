import { readFile, writeFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

const STAYS_SEARCH_OPERATION_NAME = 'StaysSearch';
const DEFAULT_STAYS_SEARCH_OPERATION_ID = '753d97c7b19a1a402d2fa63882ff4d6802004d11f2499647deef923a19a1641a';
const DEFAULT_LOCALE = 'en';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_RESULTS_PER_PAGE_ESTIMATE = 18;
const DEFAULT_CURSOR_VERSION = 1;
const BASE_MAX_SYNTHETIC_CURSOR_PROBES = 8;
const MAX_CONSECUTIVE_EMPTY_UNIQUE_PAGES = 10;
const PROGRESS_LOG_INTERVAL_PAGES = 5;
const AUTO_MAX_PAGES_MIN = 12;
const AUTO_MAX_PAGES_MAX = 200;
const API_REQUEST_MAX_ATTEMPTS = 4;
const API_BOOTSTRAP_MAX_ATTEMPTS = 3;
const API_REQUEST_RETRY_BASE_MS = 2000;
const API_REQUEST_MIN_DELAY_MS = 1400;
const API_REQUEST_MAX_DELAY_MS = 3200;
const API_RATE_LIMIT_MIN_DELAY_MS = 12000;
const API_RATE_LIMIT_MAX_DELAY_MS = 45000;
const AIRBNB_BASE_ORIGIN = 'https://www.airbnb.com';
const MAX_URL_EXTRACTION_DEPTH = 3;
const URL_WRAPPER_PARAM_KEYS = ['url', 'u', 'q', 'target', 'dest', 'destination', 'redirect', 'next', 'continue'];
const HEALABLE_HEADER_DEFAULTS = {
    'x-airbnb-graphql-platform': 'web',
    'x-airbnb-graphql-platform-client': 'minimalist-niobe',
    'x-csrf-without-token': '1',
    'x-airbnb-supports-airlock-v2': 'true',
    'x-niobe-short-circuited': 'true',
    origin: AIRBNB_BASE_ORIGIN,
};
const HEADER_DISCOVERY_KEYS = [
    'x-airbnb-graphql-platform',
    'x-airbnb-graphql-platform-client',
    'x-csrf-without-token',
    'x-airbnb-supports-airlock-v2',
    'x-niobe-short-circuited',
    'x-client-version',
];

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

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const randomInt = (min, max) => Math.floor(min + (Math.random() * ((max - min) + 1)));

const sleepJitter = async (minMs, maxMs) => {
    await sleep(randomInt(minMs, maxMs));
};

const getCaseInsensitiveEntry = (object, key) => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
    const expected = String(key).toLowerCase();
    return Object.entries(object).find(([name]) => name.toLowerCase() === expected);
};

const getCaseInsensitiveValue = (object, key) => getCaseInsensitiveEntry(object, key)?.[1];


const getRawParamAlias = (name) => {
    const normalized = cleanString(name);
    if (!normalized) return undefined;
    const direct = RAW_PARAM_ALIASES[normalized];
    if (direct) return direct;

    const lower = normalized.toLowerCase();
    const aliasEntry = Object.entries(RAW_PARAM_ALIASES).find(([alias, canonical]) => (
        alias.toLowerCase() === lower || canonical.toLowerCase() === lower
    ));
    return aliasEntry?.[1] || normalized;
};

const getSearchParamCaseInsensitive = (searchParams, names) => {
    const expected = asArray(names).map((name) => String(name).toLowerCase());
    for (const [key, value] of searchParams.entries()) {
        if (expected.includes(key.toLowerCase())) return value;
    }

    return undefined;
};

const deleteSearchParamsCaseInsensitive = (searchParams, names) => {
    const expected = new Set(asArray(names).map((name) => String(name).toLowerCase()));
    for (const key of Array.from(searchParams.keys())) {
        if (expected.has(key.toLowerCase())) searchParams.delete(key);
    }
};

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

const decodeHtmlEntitiesLite = (value) => value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, '\'')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

const normalizeHeaderName = (value) => cleanString(value)?.toLowerCase();

const normalizeAirbnbUrlCandidate = (candidate) => {
    const cleaned = cleanString(candidate);
    if (!cleaned) return undefined;

    const withoutTrail = stripTrailingNoise(cleaned)
        .replace(/\\\//g, '/')
        .replace(/^["'`([]+/, '')
        .replace(/["'`)\]]+$/, '');
    let withProtocol;
    if (/^(?:https?:)?\/\//i.test(withoutTrail)) {
        withProtocol = withoutTrail;
    } else if (/^(?:www\.|m\.)?airbnb\./i.test(withoutTrail)) {
        withProtocol = `https://${withoutTrail}`;
    }
    const finalCandidate = withProtocol || (/^\/s\//i.test(withoutTrail) ? `${AIRBNB_BASE_ORIGIN}${withoutTrail}` : undefined);
    if (!finalCandidate) return undefined;

    try {
        const parsed = new URL(finalCandidate.startsWith('//') ? `https:${finalCandidate}` : finalCandidate);
        if (!/(\.|^)airbnb\./i.test(parsed.hostname)) return undefined;
        parsed.protocol = 'https:';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return undefined;
    }
};

const collectNestedUrlCandidates = (raw) => {
    const out = [];
    const seen = new Set();
    const queue = [cleanString(raw)];

    while (queue.length) {
        const value = cleanString(queue.shift());
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);

        const decoded = decodeRepeatedURIComponent(value);
        if (decoded && !seen.has(decoded)) queue.push(decoded);

        const htmlDecoded = decodeHtmlEntitiesLite(value);
        if (htmlDecoded && !seen.has(htmlDecoded)) queue.push(htmlDecoded);

        try {
            const possibleUrl = /^(?:https?:)?\/\//i.test(value) ? value : undefined;
            const parsed = possibleUrl ? new URL(possibleUrl.startsWith('//') ? `https:${possibleUrl}` : possibleUrl) : undefined;
            if (!parsed) continue;
            for (const key of URL_WRAPPER_PARAM_KEYS) {
                const paramValue = cleanString(parsed.searchParams.get(key));
                if (paramValue && !seen.has(paramValue)) queue.push(paramValue);
            }
        } catch {
            continue;
        }
    }

    return out;
};

const extractAirbnbUrlCandidate = (inputValue, depth = 0) => {
    const raw = cleanString(inputValue);
    if (!raw || depth > MAX_URL_EXTRACTION_DEPTH) return undefined;

    const candidates = collectNestedUrlCandidates(raw);
    for (const candidate of candidates) {
        const direct = candidate.match(/https?:\/\/(?:www\.|m\.)?airbnb\.[^\s"'<>]+/i)
            || candidate.match(/(?:www\.|m\.)?airbnb\.[^\s"'<>]+/i);
        if (direct?.[0]) {
            const normalized = normalizeAirbnbUrlCandidate(direct[0]);
            if (normalized) return normalized;
        }

        const normalizedWhole = normalizeAirbnbUrlCandidate(candidate);
        if (normalizedWhole) return normalizedWhole;
    }

    return undefined;
};

const buildSearchUrlFromLooseText = (inputValue) => {
    const raw = cleanString(inputValue);
    if (!raw) return undefined;

    const normalized = decodeHtmlEntitiesLite(decodeRepeatedURIComponent(raw))
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\bairbnb\b/gi, ' ')
        .replace(/[^\p{L}\p{N}\s,.-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized.length < 3) return undefined;

    const safe = normalized
        .replace(/\s*,\s*/g, '--')
        .replace(/[.\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!safe) return undefined;

    return `${AIRBNB_BASE_ORIGIN}/s/${encodeURIComponent(safe)}/homes`;
};

const normalizeInputUrls = ({ urls, url }) => {
    const candidates = [];
    const pushCandidate = (value) => {
        if (value === null || value === undefined) return;
        const str = cleanString(value);
        if (str) candidates.push(str);
    };

    if (Array.isArray(urls)) {
        for (const item of urls) pushCandidate(item);
    } else {
        pushCandidate(urls);
    }

    // Backward compatibility for older tasks that still send a single `url`.
    pushCandidate(url);

    const normalized = [];
    const seen = new Set();
    for (const candidate of candidates) {
        const extracted = extractAirbnbUrlCandidate(candidate);
        const resilient = extracted || buildSearchUrlFromLooseText(candidate);
        if (!resilient) {
            log.warning('Skipped an invalid Airbnb URL input.');
            continue;
        }
        if (seen.has(resilient)) continue;
        seen.add(resilient);
        normalized.push({
            inputValue: candidate,
            runtimeUrl: resilient,
            wasInferred: !extracted,
        });
    }

    return normalized;
};

const computeAutoMaxPages = (targetCount) => {
    const estimate = Math.ceil(Math.max(1, targetCount) / DEFAULT_RESULTS_PER_PAGE_ESTIMATE);
    const buffered = (estimate * 4) + 10;
    return Math.min(AUTO_MAX_PAGES_MAX, Math.max(AUTO_MAX_PAGES_MIN, buffered));
};

const extractNumericIdFromUrl = (urlString) => {
    try {
        const parsed = new URL(urlString);
        const fromParam = getSearchParamCaseInsensitive(parsed.searchParams, [
            'room_id',
            'roomId',
            'listing_id',
            'listingId',
            'propertyId',
        ]);
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

const isTransientError = (error) => {
    const statusCode = Number(error?.statusCode || error?.response?.statusCode);
    if (statusCode === 408 || statusCode === 429 || statusCode >= 500) return true;

    const code = cleanString(error?.code)?.toUpperCase();
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;

    const text = cleanString(error?.message)?.toLowerCase() || '';
    return text.includes('timeout') || text.includes('timed out') || text.includes('socket hang up');
};

const isRateLimitError = (error) => Number(error?.statusCode || error?.response?.statusCode) === 429;

const getHeaderValue = (headers, name) => {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name);

    const expected = name.toLowerCase();
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
    return entry?.[1];
};

const getRetryDelayMs = (attempt, error) => {
    const rawRetryAfter = getHeaderValue(error?.response?.headers, 'retry-after')
        || getHeaderValue(error?.headers, 'retry-after');
    const retryAfter = Number(rawRetryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter * 1000, API_RATE_LIMIT_MAX_DELAY_MS);
    }

    if (isRateLimitError(error)) {
        return randomInt(API_RATE_LIMIT_MIN_DELAY_MS, API_RATE_LIMIT_MAX_DELAY_MS);
    }

    const base = API_REQUEST_RETRY_BASE_MS * (2 ** (attempt - 1));
    return randomInt(base, Math.min(base * 2, 12000));
};

const fetchText = async ({ client, url, accept = 'text/html,application/xhtml+xml' }) => {
    let lastError;

    for (let attempt = 1; attempt <= API_BOOTSTRAP_MAX_ATTEMPTS; attempt++) {
        try {
            const response = await client.fetch(url, {
                method: 'GET',
                headers: {
                    accept,
                    'accept-language': 'en-US,en;q=0.9',
                    ...(accept.includes('text/html') && {
                        'sec-fetch-site': 'none',
                        'sec-fetch-mode': 'navigate',
                        'sec-fetch-user': '?1',
                        'sec-fetch-dest': 'document',
                    }),
                },
            });

            const body = await response.text();
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status} when fetching ${url}`);
                error.statusCode = response.status;
                error.headers = response.headers;
                error.responseBody = body;
                throw error;
            }

            return {
                body,
                statusCode: response.status,
                headers: response.headers,
            };
        } catch (error) {
            lastError = error;
        }

        if (!isTransientError(lastError) || attempt >= API_BOOTSTRAP_MAX_ATTEMPTS) break;

        const delayMs = getRetryDelayMs(attempt, lastError);
        log.warning(`Temporary Airbnb bootstrap failure (${lastError.message}); retrying in ${delayMs}ms.`);
        await sleep(delayMs);
    }

    throw lastError || new Error('Airbnb bootstrap request failed.');
};

const extractApiKeyFromHtml = (html) => {
    const match = html.match(/"api[_-]?config"\s*:\s*\{[\s\S]{0,4000}?"key"\s*:\s*"([^"]+)"/i);
    return cleanString(match?.[1]);
};

const extractDeferredVariables = (html) => {
    const scriptMatch = html.match(/<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch?.[1]) return undefined;

    try {
        const payload = JSON.parse(scriptMatch[1]);
        const niobeClientData = asArray(getCaseInsensitiveValue(payload, 'niobeClientData'));
        const staysSearchEntry = niobeClientData.find((entry) => (
            typeof entry?.[0] === 'string'
            && entry[0].toLowerCase().startsWith(`${STAYS_SEARCH_OPERATION_NAME.toLowerCase()}:`)
        ));
        if (!staysSearchEntry) return undefined;

        const key = String(staysSearchEntry[0]);
        const variables = JSON.parse(key.slice(STAYS_SEARCH_OPERATION_NAME.length + 1));
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

const discoverOperationIdFromBootstrap = async ({ client, operationName, bootstrapHtml, bootstrapUrl }) => {
    const fromHtml = findOperationHashNearText(bootstrapHtml, operationName);
    if (fromHtml) return fromHtml;

    const scriptUrls = extractScriptUrls(bootstrapHtml, bootstrapUrl);
    for (const scriptUrl of scriptUrls.slice(0, 24)) {
        try {
            const response = await fetchText({
                client,
                url: scriptUrl,
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

const extractHeaderHintsFromHtml = (html, bootstrapUrl) => {
    const hints = {};
    const body = cleanString(html) || '';

    for (const headerName of HEADER_DISCOVERY_KEYS) {
        const escaped = escapeRegExp(headerName);
        const pattern = new RegExp(`["']${escaped}["']\\s*[:=]\\s*["']([^"']+)["']`, 'i');
        const match = body.match(pattern);
        const value = cleanString(match?.[1]);
        if (value) hints[headerName] = value;
    }

    const clientVersion = cleanString(body.match(/["']clientVersion["']\s*[:=]\s*["']([a-f0-9]{20,})["']/i)?.[1]);
    if (clientVersion && !hints['x-client-version']) {
        hints['x-client-version'] = clientVersion;
    }

    const referer = extractAirbnbUrlCandidate(bootstrapUrl);
    if (referer) {
        hints.referer = referer;
    }

    try {
        const origin = referer ? new URL(referer).origin : AIRBNB_BASE_ORIGIN;
        hints.origin = origin;
    } catch {
        hints.origin = AIRBNB_BASE_ORIGIN;
    }

    return hints;
};

const buildHeaderFallbacksForMissing = ({ missingHeaders = [], referer }) => {
    const out = {};
    const origin = (() => {
        try {
            return referer ? new URL(referer).origin : AIRBNB_BASE_ORIGIN;
        } catch {
            return AIRBNB_BASE_ORIGIN;
        }
    })();

    for (const headerName of missingHeaders) {
        const normalized = normalizeHeaderName(headerName);
        if (!normalized) continue;
        if (normalized === 'referer') out[normalized] = referer || AIRBNB_BASE_ORIGIN;
        else if (normalized === 'origin') out[normalized] = origin;
        else if (HEALABLE_HEADER_DEFAULTS[normalized]) out[normalized] = HEALABLE_HEADER_DEFAULTS[normalized];
    }

    return out;
};

const buildSeedUrl = ({ url }) => {
    const explicitUrl = extractAirbnbUrlCandidate(url);
    if (explicitUrl) return explicitUrl;

    const inferred = buildSearchUrlFromLooseText(url);
    if (inferred) return inferred;

    return AIRBNB_BASE_ORIGIN;
};

const buildRawParamsFromInput = ({ url, adults }) => {
    const explicitUrl = extractAirbnbUrlCandidate(url);
    if (!explicitUrl) return [];

    const parsed = new URL(explicitUrl);
    deleteSearchParamsCaseInsensitive(parsed.searchParams, [
        'source_impression_id',
        'source',
        'tracking_id',
        'guests',
        'children',
        'infants',
        'pets',
    ]);
    const grouped = new Map();

    parsed.searchParams.forEach((value, key) => {
        const normalizedKey = key.replace(/\[\]$/g, '');
        const canonicalKey = getRawParamAlias(normalizedKey);
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
        const rawFilterName = cleanString(getCaseInsensitiveValue(entry, 'filterName'));
        const filterName = getRawParamAlias(rawFilterName);
        if (!filterName) continue;
        const filterValues = asArray(getCaseInsensitiveValue(entry, 'filterValues')).map((item) => String(item));
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
    const canonicalName = getRawParamAlias(name);
    const rawParams = asArray(rawParamsInput).map((entry) => ({ ...entry }));
    const idx = rawParams.findIndex((entry) => cleanString(getCaseInsensitiveValue(entry, 'filterName'))?.toLowerCase() === canonicalName.toLowerCase());

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

    for (const requestObject of [
        getCaseInsensitiveValue(variables, 'staysSearchRequest'),
        getCaseInsensitiveValue(variables, 'staysMapSearchRequestV2'),
    ]) {
        if (!requestObject || typeof requestObject !== 'object') continue;
        // Airbnb StaysSearch expects token pagination through `cursor`,
        // not raw numeric offset params. Offsets cause page loops/duplication.
        const rawParams = getCaseInsensitiveValue(requestObject, 'rawParams');
        const withoutLegacySection = setRawParamValue(rawParams, 'section_offset', undefined);
        const withoutLegacyItems = setRawParamValue(withoutLegacySection, 'items_offset', undefined);
        const withoutCamelSection = setRawParamValue(withoutLegacyItems, 'sectionOffset', undefined);
        const withoutCamelItems = setRawParamValue(withoutCamelSection, 'itemsOffset', undefined);
        requestObject.rawParams = setRawParamValue(withoutCamelItems, 'cursor', cursor);
    }
};

const decodeCursorPayload = (cursor) => {
    if (!cursor) return undefined;

    const decoded = decodeBase64(cursor);
    if (!decoded) return undefined;

    try {
        const parsed = JSON.parse(decoded);
        const rawSectionOffset = getCaseInsensitiveValue(parsed, 'section_offset') ?? getCaseInsensitiveValue(parsed, 'sectionOffset');
        const rawItemsOffset = getCaseInsensitiveValue(parsed, 'items_offset') ?? getCaseInsensitiveValue(parsed, 'itemsOffset');
        const rawVersion = getCaseInsensitiveValue(parsed, 'version');
        const sectionOffset = Number.isFinite(rawSectionOffset) ? rawSectionOffset : 0;
        const itemsOffset = Number.isFinite(rawItemsOffset) ? rawItemsOffset : undefined;
        const version = Number.isFinite(rawVersion) ? rawVersion : DEFAULT_CURSOR_VERSION;
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

const getCursorKey = (cursor) => {
    if (!cursor) return 'first-page';

    const payload = decodeCursorPayload(cursor);
    if (!payload) return `token:${cursor}`;

    return `offset:${payload.sectionOffset}:${payload.itemsOffset}:${payload.version}`;
};

const getCursorOffset = (cursor) => {
    const payload = decodeCursorPayload(cursor);
    return Number.isFinite(payload?.itemsOffset) ? payload.itemsOffset : Number.MAX_SAFE_INTEGER;
};

const getItemsPerGrid = (baseVariables) => {
    const request = getCaseInsensitiveValue(baseVariables, 'staysSearchRequest');
    const rawParams = asArray(getCaseInsensitiveValue(request, 'rawParams'));
    const found = rawParams.find((entry) => {
        const filterName = getRawParamAlias(getCaseInsensitiveValue(entry, 'filterName'));
        return filterName === 'itemsPerGrid';
    });
    const value = getCaseInsensitiveValue(found, 'filterValues')?.[0];
    return safePositiveInt(value, DEFAULT_RESULTS_PER_PAGE_ESTIMATE);
};

// Adds discovered cursors into a queue, deduped by canonical offset key and ordered by offset.
const collectCursors = (paginationInfo, queue, queuedCursorKeys, visitedCursorKeys, maxObservedItemsOffset) => {
    const pages = asArray(getCaseInsensitiveValue(paginationInfo, 'pageCursors')).map((c) => cleanString(c)).filter(Boolean);

    for (const c of pages) {
        const key = getCursorKey(c);
        if (visitedCursorKeys.has(key) || queuedCursorKeys.has(key)) continue;

        const payload = decodeCursorPayload(c);
        if (payload?.sectionOffset === 0 && Number.isFinite(payload?.itemsOffset) && payload.itemsOffset <= maxObservedItemsOffset) {
            continue;
        }

        queue.push(c);
        queuedCursorKeys.add(key);
    }

    queue.sort((a, b) => getCursorOffset(a) - getCursorOffset(b));
};

const takeNextCursor = (queue, queuedCursorKeys, visitedCursorKeys) => {
    while (queue.length > 0) {
        const cursor = queue.shift();
        const key = getCursorKey(cursor);
        queuedCursorKeys.delete(key);
        if (!visitedCursorKeys.has(key)) return cursor;
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

const mergeHeaders = (...maps) => {
    const out = {};
    for (const map of maps) {
        if (!map || typeof map !== 'object') continue;
        for (const [name, value] of Object.entries(map)) {
            const normalizedName = normalizeHeaderName(name);
            const normalizedValue = cleanString(value);
            if (!normalizedName || !normalizedValue) continue;
            out[normalizedName] = normalizedValue;
        }
    }
    return out;
};

const buildRequestHeaderProfiles = ({ apiKey, referer, headerHints }) => {
    const base = {
        'x-airbnb-api-key': apiKey,
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        referer,
    };

    const softBrowserHeaders = {
        origin: (() => {
            try {
                return referer ? new URL(referer).origin : AIRBNB_BASE_ORIGIN;
            } catch {
                return AIRBNB_BASE_ORIGIN;
            }
        })(),
        'content-type': 'application/json',
        'x-csrf-without-token': '1',
    };

    return [
        mergeHeaders(base, HEALABLE_HEADER_DEFAULTS, softBrowserHeaders, headerHints),
    ];
};

const parseResponseError = ({ response, fallbackMessage }) => {
    let json;
    try {
        json = JSON.parse(response.body);
    } catch {
        const error = new Error(`${fallbackMessage} (HTTP ${response.statusCode}).`);
        error.statusCode = response.statusCode;
        error.headers = response.headers;
        error.responseBody = response.body;
        return error;
    }

    if (response.statusCode >= 400) {
        const error = new Error(`Airbnb API returned HTTP ${response.statusCode}.`);
        error.statusCode = response.statusCode;
        error.headers = response.headers;
        error.responseBody = response.body;
        error.payload = json;
        return error;
    }

    if (Array.isArray(json?.errors) && json.errors.length) {
        const error = new Error('Airbnb API returned GraphQL errors.');
        error.statusCode = response.statusCode;
        error.headers = response.headers;
        error.responseBody = response.body;
        error.payload = json;
        return error;
    }

    return { json };
};

const requestWithBackoff = async ({ client, url, headers }) => {
    let lastError;

    for (let attempt = 1; attempt <= API_REQUEST_MAX_ATTEMPTS; attempt++) {
        try {
            const response = await client.fetch(url, {
                method: 'GET',
                headers,
            });

            const bodyText = await response.text();
            const parsed = parseResponseError({
                response: {
                    statusCode: response.status,
                    body: bodyText,
                    headers: response.headers,
                },
                fallbackMessage: 'Invalid JSON from Airbnb API',
            });

            if (parsed?.json) return parsed.json;
            lastError = parsed;
        } catch (error) {
            lastError = error;
        }

        if (!isTransientError(lastError) || attempt >= API_REQUEST_MAX_ATTEMPTS) break;

        const delayMs = getRetryDelayMs(attempt, lastError);
        log.warning(`Temporary Airbnb API failure (${lastError.message}); retrying in ${delayMs}ms.`);
        await sleep(delayMs);
    }

    throw lastError || new Error('Airbnb API request failed.');
};

const requestJson = async ({ client, url, apiKey, referer, headerHints = {} }) => {
    const profiles = buildRequestHeaderProfiles({ apiKey, referer, headerHints });
    const attempted = new Set();
    let lastError;

    for (const headers of profiles) {
        const signature = JSON.stringify(headers);
        if (attempted.has(signature)) continue;
        attempted.add(signature);

        try {
            return await requestWithBackoff({ client, url, headers });
        } catch (error) {
            lastError = error;
            if (isTransientError(error)) {
                log.warning(`Airbnb API request failed after retries for one header profile: ${error.message}`);
                if (isRateLimitError(error)) break;
            }
        }
    }

    throw lastError || new Error('Airbnb API request failed for all header profiles.');
};

const normalizeErrorText = (error) => {
    const payload = error?.payload ? JSON.stringify(error.payload) : '';
    const body = cleanString(error?.responseBody) || '';
    const message = cleanString(error?.message) || '';
    return `${message} ${body} ${payload}`.toLowerCase();
};

const extractMissingHeaderNames = (error) => {
    const text = normalizeErrorText(error);
    const names = new Set();
    const missingPattern = /(?:missing|required|invalid)[\w\s:-]{0,60}?(x-[a-z0-9-]+|referer|origin|content-type)/gi;

    for (const match of text.matchAll(missingPattern)) {
        const headerName = normalizeHeaderName(match?.[1]);
        if (headerName) names.add(headerName);
    }

    return Array.from(names);
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

const isHeaderIssue = (error) => {
    const text = normalizeErrorText(error);
    if (extractMissingHeaderNames(error).length > 0) return true;
    return text.includes('header')
        || text.includes('csrf')
        || text.includes('forbidden')
        || text.includes('bad request')
        || text.includes('invalid_request');
};

const getStaysSearchResults = (json, sourceLabel) => {
    const data = getCaseInsensitiveValue(json, 'data');
    const presentation = getCaseInsensitiveValue(data, 'presentation');
    const staysSearch = getCaseInsensitiveValue(presentation, 'staysSearch');
    const results = getCaseInsensitiveValue(staysSearch, 'results');
    if (results && typeof results === 'object') return results;

    const keys = (value) => value && typeof value === 'object' ? Object.keys(value).join(', ') : 'none';
    log.warning(
        `[${sourceLabel}] Airbnb API response did not include staysSearch results. `
        + `Top-level keys: ${keys(json)}; data keys: ${keys(data)}; `
        + `presentation keys: ${keys(presentation)}; staysSearch keys: ${keys(staysSearch)}.`,
    );
    return undefined;
};

const getBootstrapData = async ({ client, seedUrl }) => {
    const candidates = Array.from(new Set([
        cleanString(seedUrl),
        extractAirbnbUrlCandidate(seedUrl),
        `${AIRBNB_BASE_ORIGIN}/`,
    ].filter(Boolean)));

    let firstSuccessful;

    for (const url of candidates) {
        try {
            const response = await fetchText({ client, url });
            const html = response.body;
            const apiKey = extractApiKeyFromHtml(html);
            const deferredVariables = extractDeferredVariables(html);
            const headerHints = extractHeaderHintsFromHtml(html, url);
            if (!firstSuccessful) firstSuccessful = {
                html,
                url,
                apiKey,
                deferredVariables,
                headerHints,
                statusCode: response.statusCode,
                contentType: getHeaderValue(response.headers, 'content-type'),
            };
            if (apiKey) return {
                html, url, apiKey, deferredVariables, headerHints,
            };
        } catch (error) {
            log.warning(`Could not read bootstrap data from ${url}: ${error.message}`);
        }
    }

    if (firstSuccessful) {
        const hasApiConfigMarker = /"api[_-]?config"/i.test(firstSuccessful.html);
        log.warning(
            `Airbnb bootstrap did not expose api_config.key (status=${firstSuccessful.statusCode}, `
            + `content_type=${firstSuccessful.contentType || 'unknown'}, bytes=${firstSuccessful.html.length}, `
            + `api_config=${hasApiConfigMarker ? 'present' : 'absent'}).`,
        );
        return firstSuccessful;
    }
    throw new Error('Unable to load Airbnb bootstrap page data.');
};

const refreshAirbnbApiContext = async ({
    client,
    seedUrl,
    existingContext = {},
    refreshHash = true,
    refreshKey = true,
    refreshHeaders = true,
    requiredHeaderNames = [],
}) => {
    const context = {
        staysSearchOperationId: cleanString(existingContext.staysSearchOperationId),
        apiKey: cleanString(existingContext.apiKey),
        bootstrapUrl: cleanString(existingContext.bootstrapUrl),
        deferredVariables: existingContext.deferredVariables,
        headerHints: mergeHeaders(existingContext.headerHints),
    };

    const bootstrap = await getBootstrapData({ client, seedUrl });
    context.bootstrapUrl = bootstrap.url;
    context.deferredVariables = bootstrap.deferredVariables;

    if (refreshKey || !context.apiKey) {
        context.apiKey = cleanString(bootstrap.apiKey) || context.apiKey;
    }

    if (refreshHash || !context.staysSearchOperationId) {
        const discoveredHash = await discoverOperationIdFromBootstrap({
            client,
            operationName: STAYS_SEARCH_OPERATION_NAME,
            bootstrapHtml: bootstrap.html,
            bootstrapUrl: bootstrap.url,
        });
        context.staysSearchOperationId = discoveredHash || context.staysSearchOperationId;
    }

    if (refreshHeaders || !Object.keys(context.headerHints).length) {
        const fallbackHints = buildHeaderFallbacksForMissing({
            missingHeaders: requiredHeaderNames,
            referer: bootstrap.url || seedUrl,
        });
        context.headerHints = mergeHeaders(
            HEALABLE_HEADER_DEFAULTS,
            context.headerHints,
            bootstrap.headerHints,
            fallbackHints,
        );
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
    client,
    targetCount,
    maxPages,
    locale,
    currency,
    apiContext,
    searchContext,
    seedUrl,
    baseVariables,
    sourceLabel = 'source',
    onBatchSaved = async (rows) => rows.length,
}) => {
    const rows = [];
    let persistedCount = 0;
    const seenListingKeys = new Set();
    // visitedCursorKeys: canonical cursor keys we have already requested.
    const visitedCursorKeys = new Set([
        getCursorKey(undefined),
        getCursorKey(buildCursorToken({ sectionOffset: 0, itemsOffset: 0 })),
    ]);
    // Cursors that are discovered but not requested yet.
    const cursorQueue = [];
    const queuedCursorKeys = new Set();
    const syntheticOffsetsUsed = new Set();
    const itemsPerGrid = getItemsPerGrid(baseVariables);
    // Keep synthetic probing budget adaptive to user intent (`results_wanted`).
    // A fixed low cap can end deep pagination too early on broad markets.
    const maxSyntheticCursorProbes = Math.max(
        BASE_MAX_SYNTHETIC_CURSOR_PROBES,
        maxPages,
        Math.ceil(targetCount / Math.max(1, itemsPerGrid)),
    );
    let maxObservedItemsOffset = 0;
    let syntheticProbeCount = 0;
    let consecutiveNoNewPages = 0;
    let missingResultsRecoveryAttempted = false;
    let currentCursor;   // undefined = first page (no cursor)
    let page = 1;

    while (persistedCount < targetCount && page <= maxPages) {
        // Mark current cursor used so we never re-request the same page.
        visitedCursorKeys.add(getCursorKey(currentCursor));

        if (page > 1) {
            await sleepJitter(API_REQUEST_MIN_DELAY_MS, API_REQUEST_MAX_DELAY_MS);
        }

        const variables = buildVariablesForPage(baseVariables, currentCursor);

        const runRequest = async () => requestJson({
            client,
            url: buildSearchUrl({
                locale,
                currency,
                variables,
                operationId: apiContext.staysSearchOperationId,
            }),
            apiKey: apiContext.apiKey,
            referer: apiContext.bootstrapUrl || seedUrl,
            headerHints: apiContext.headerHints,
        });

        let json;
        try {
            json = await runRequest();
        } catch (error) {
            const missingHeaders = extractMissingHeaderNames(error);
            const refreshHash = isPersistedQueryIssue(error);
            const refreshKey = isApiKeyIssue(error) || !apiContext.apiKey;
            const refreshHeaders = isHeaderIssue(error);
            if (!refreshHash && !refreshKey && !refreshHeaders) throw error;

            const previousHash = apiContext.staysSearchOperationId;
            const previousKey = apiContext.apiKey;
            const previousHeaders = JSON.stringify(apiContext.headerHints || {});
            const refreshed = await refreshAirbnbApiContext({
                client,
                seedUrl,
                existingContext: apiContext,
                refreshHash,
                refreshKey,
                refreshHeaders,
                requiredHeaderNames: missingHeaders,
            });

            Object.assign(apiContext, refreshed);
            const nextHeaders = JSON.stringify(apiContext.headerHints || {});
            const contextChanged = previousHash !== apiContext.staysSearchOperationId
                || previousKey !== apiContext.apiKey
                || previousHeaders !== nextHeaders;
            if (!contextChanged) throw error;

            log.warning(`Auto-healed Airbnb API context (hash: ${refreshHash}, key: ${refreshKey}, headers: ${refreshHeaders}).`);
            await refreshApiDiscoveryFile({ staysSearchOperationId: apiContext.staysSearchOperationId });
            json = await runRequest();
        }

        let results = getStaysSearchResults(json, sourceLabel);
        if (!results && !missingResultsRecoveryAttempted) {
            missingResultsRecoveryAttempted = true;
            log.warning(`[${sourceLabel}] Refreshing Airbnb context after an unexpected result shape.`);
            const refreshed = await refreshAirbnbApiContext({
                client,
                seedUrl,
                existingContext: apiContext,
                refreshHash: true,
                refreshKey: true,
                refreshHeaders: true,
            });
            Object.assign(apiContext, refreshed);
            json = await runRequest();
            results = getStaysSearchResults(json, sourceLabel);
        }
        if (!results) {
            log.warning(`[${sourceLabel}] Stopping source because Airbnb returned no usable staysSearch results.`);
            break;
        }

        const items = asArray(getCaseInsensitiveValue(results, 'searchResults'));

        const currentCursorPayload = decodeCursorPayload(currentCursor);
        if (Number.isFinite(currentCursorPayload?.itemsOffset)) {
            maxObservedItemsOffset = Math.max(maxObservedItemsOffset, currentCursorPayload.itemsOffset);
        }

        // Harvest cursor tokens before item handling so queue state is always current.
        collectCursors(
            getCaseInsensitiveValue(results, 'paginationInfo'),
            cursorQueue,
            queuedCursorKeys,
            visitedCursorKeys,
            maxObservedItemsOffset,
        );
        const paginationInfo = getCaseInsensitiveValue(results, 'paginationInfo');
        const directNextCursor = cleanString(getCaseInsensitiveValue(paginationInfo, 'nextPageCursor'));

        const observedCursors = asArray(getCaseInsensitiveValue(paginationInfo, 'pageCursors'))
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
            const newRowsThisPage = [];

            for (const item of items) {
                let mapped;
                try {
                    mapped = mapListingItem({ item, rank: rows.length + 1, searchContext });
                } catch (error) {
                    log.warning(`[${sourceLabel}] skipped malformed listing item: ${error.message}`);
                    continue;
                }
                if (!mapped) {
                    log.debug(`[${sourceLabel}] skipped empty listing item.`);
                    continue;
                }

                const dedupKey = buildDedupKey(mapped);
                if (dedupKey && seenListingKeys.has(dedupKey)) continue;
                if (dedupKey) seenListingKeys.add(dedupKey);

                rows.push(mapped);
                newRowsThisPage.push(mapped);
            }

            const newThisPage = rows.length - beforePageCount;
            if (newRowsThisPage.length > 0) {
                const accepted = Number(await onBatchSaved(newRowsThisPage)) || 0;
                persistedCount += Math.max(0, accepted);
            }
            consecutiveNoNewPages = newThisPage > 0 ? 0 : consecutiveNoNewPages + 1;
            const shouldLogProgress = page === 1
                || page % PROGRESS_LOG_INTERVAL_PAGES === 0
                || persistedCount >= targetCount
                || (newThisPage === 0 && consecutiveNoNewPages % 3 === 0);
            if (shouldLogProgress) {
                log.info(`[${sourceLabel}] page ${page}: +${newThisPage} new, ${rows.length} unique source, ${persistedCount} pushed.`);
            }

            if (persistedCount >= targetCount) break;
        }

        const directNextKey = getCursorKey(directNextCursor);
        if (directNextCursor && !visitedCursorKeys.has(directNextKey) && !queuedCursorKeys.has(directNextKey)) {
            currentCursor = directNextCursor;
            page++;
            continue;
        }

        const next = takeNextCursor(cursorQueue, queuedCursorKeys, visitedCursorKeys);
        if (next) {
            currentCursor = next;
            page++;
            continue;
        }

        const nextSyntheticOffset = maxObservedItemsOffset + itemsPerGrid;
        const reachedSyntheticProbeLimit = syntheticProbeCount >= maxSyntheticCursorProbes;
        const reachedNoNewLimit = consecutiveNoNewPages >= MAX_CONSECUTIVE_EMPTY_UNIQUE_PAGES;
        if (
            page >= maxPages
            || syntheticOffsetsUsed.has(nextSyntheticOffset)
            || reachedSyntheticProbeLimit
            || reachedNoNewLimit
        ) {
            if (reachedSyntheticProbeLimit) {
                log.info(`[${sourceLabel}] stopped synthetic probing at limit ${maxSyntheticCursorProbes}.`);
            }
            if (reachedNoNewLimit) {
                log.info(`[${sourceLabel}] stopped after ${MAX_CONSECUTIVE_EMPTY_UNIQUE_PAGES} consecutive no-new pages.`);
            }
            log.info(`[${sourceLabel}] source exhausted after page ${page}.`);
            break;
        }

        syntheticOffsetsUsed.add(nextSyntheticOffset);
        syntheticProbeCount++;
        maxObservedItemsOffset = nextSyntheticOffset;
        currentCursor = buildCursorToken({ sectionOffset: 0, itemsOffset: nextSyntheticOffset });
        log.debug(`[${sourceLabel}] cursor pool exhausted; probing offset ${nextSyntheticOffset}.`);
        page++;
    }

    if (persistedCount < targetCount) {
        log.info(`[${sourceLabel}] pushed ${persistedCount}/${targetCount} requested unique listings before exhaustion.`);
    }

    return {
        sourceUniqueCount: rows.length,
        persistedCount,
    };
};

const createBatchSaver = ({ globalSeenListingKeys, resultsWanted, savedState }) => async (pageRows) => {
    const counter = savedState;
    if (!pageRows.length || counter.savedCount >= resultsWanted) return 0;

    const accepted = [];
    for (const listing of pageRows) {
        if (counter.savedCount >= resultsWanted) break;
        const key = buildDedupKey(listing);
        if (key && globalSeenListingKeys.has(key)) continue;
        if (key) globalSeenListingKeys.add(key);
        accepted.push(listing);
        counter.savedCount++;
    }

    if (accepted.length > 0) {
        await Actor.pushData(accepted);
    }

    return accepted.length;
};
const resolveProxyConfiguration = async (proxyConfiguration) => {
    if (!proxyConfiguration) return undefined;

    const isApifyCloud = Actor.isAtHome();
    const hasApifyToken = Boolean(process.env.APIFY_TOKEN);
    const shouldUseApifyProxy = Boolean(proxyConfiguration?.useApifyProxy);
    const hasCustomProxyUrls = Array.isArray(proxyConfiguration?.proxyUrls) && proxyConfiguration.proxyUrls.length > 0;

    if (hasCustomProxyUrls) {
        return Actor.createProxyConfiguration(proxyConfiguration);
    }

    if (shouldUseApifyProxy) {
        if (isApifyCloud || hasApifyToken) {
            try {
                return await Actor.createProxyConfiguration(proxyConfiguration);
            } catch (error) {
                log.warning(`Could not initialize Apify Proxy: ${error.message}`);
                return undefined;
            }
        }
        log.warning('Apify Proxy requested but running outside Apify platform without APIFY_TOKEN. Continuing without proxy.');
        return undefined;
    }

    return undefined;
};

await Actor.main(async () => {
    const actorInput = (await Actor.getInput()) || {};
    const fallbackInput = Actor.isAtHome() ? {} : await loadLocalInputFallback();
    const input = {
        ...fallbackInput,
        ...actorInput,
    };

    const {
        urls,
        url,
        adults = 1,
        results_wanted: resultsWantedInput = 20,
        locale = DEFAULT_LOCALE,
        currency = DEFAULT_CURRENCY,
        proxyConfiguration,
    } = input;

    const inputUrls = normalizeInputUrls({ urls, url });
    if (!inputUrls.length) {
        throw new Error('Provide at least one valid Airbnb search URL in `urls`.');
    }

    for (const source of inputUrls) {
        if (source.wasInferred) {
            log.warning(`Input URL looked malformed; inferred resilient URL: ${source.runtimeUrl}`);
        }
    }

    const proxyConfig = await resolveProxyConfiguration(proxyConfiguration);
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    if (proxyUrl) {
        log.info('Proxy initialized successfully for HTTP client session.');
    } else {
        log.warning('Running without proxy. Airbnb requires residential proxies for reliable access.');
    }

    const client = new Impit({
        browser: 'ios18',
        timeout: 45000,
        ...(proxyUrl && { proxyUrl }),
    });

    const resultsWanted = safePositiveInt(resultsWantedInput, 20);
    log.info(`Starting scrape: resultsWanted=${resultsWanted}, sources=${inputUrls.length}.`);

    const firstSourceSeed = buildSeedUrl({ url: inputUrls[0].runtimeUrl });

    const apiContext = await refreshAirbnbApiContext({
        client,
        seedUrl: firstSourceSeed,
        existingContext: {
            staysSearchOperationId: DEFAULT_STAYS_SEARCH_OPERATION_ID,
        },
        refreshHash: true,
        refreshKey: true,
    });

    await refreshApiDiscoveryFile({ staysSearchOperationId: apiContext.staysSearchOperationId });

    const globalState = { savedCount: 0 };
    const globalSeenListingKeys = new Set();

    for (let i = 0; i < inputUrls.length; i++) {
        if (globalState.savedCount >= resultsWanted) break;

        const source = inputUrls[i];
        const sourceSeedUrl = buildSeedUrl({ url: source.runtimeUrl });
        const remainingTarget = resultsWanted - globalState.savedCount;
        const sourceMaxPages = computeAutoMaxPages(remainingTarget);
        const sourceLabel = `source ${i + 1}/${inputUrls.length}`;

        log.info(`[${sourceLabel}] target=${remainingTarget}, autoMaxPages=${sourceMaxPages}`);

        try {
            // Refresh source bootstrap/deferred variables while retaining healed API context.
            // The initial bootstrap already contains this source's variables; avoid repeating it.
            const sourceContext = i === 0
                ? apiContext
                : await refreshAirbnbApiContext({
                    client,
                    seedUrl: sourceSeedUrl,
                    existingContext: apiContext,
                    refreshHash: false,
                    refreshKey: false,
                    refreshHeaders: false,
                });

            Object.assign(apiContext, sourceContext);

            const sourceDeferredVariables = sourceContext.deferredVariables && typeof sourceContext.deferredVariables === 'object'
                ? sourceContext.deferredVariables
                : undefined;
            const baseVariables = sourceDeferredVariables || buildSearchVariables({
                rawParams: buildRawParamsFromInput({ url: source.runtimeUrl, adults }),
            });

            const onBatchSaved = createBatchSaver({
                globalSeenListingKeys,
                resultsWanted,
                savedState: globalState,
            });

            const sourceResult = await fetchListings({
                client,
                targetCount: remainingTarget,
                maxPages: sourceMaxPages,
                locale: cleanString(locale) || DEFAULT_LOCALE,
                currency: cleanString(currency) || DEFAULT_CURRENCY,
                apiContext,
                searchContext: source.runtimeUrl || sourceSeedUrl || source.inputValue,
                seedUrl: sourceSeedUrl,
                baseVariables,
                sourceLabel,
                onBatchSaved,
            });

            log.info(`[${sourceLabel}] contributed ${sourceResult.persistedCount} listing(s), global total ${globalState.savedCount}/${resultsWanted}.`);
        } catch (error) {
            log.warning(`[${sourceLabel}] skipped after recoverable failure: ${error.message}`);
        }
    }

    if (!globalState.savedCount) {
        log.warning('No listings were saved. Try another Airbnb search URL or broader search filters.');
        return;
    }

    log.info(`Saved ${globalState.savedCount} listing(s).`);
});

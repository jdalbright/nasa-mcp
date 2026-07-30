const NASA_BASE = "https://api.nasa.gov";
const MEDIA_BASE = "https://images-api.nasa.gov";
const EONET_BASE = "https://eonet.gsfc.nasa.gov/api/v3";
const EPIC_BASE = "https://epic.gsfc.nasa.gov";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ERROR_BODY = 600;

export type JsonObject = Record<string, any>;

type ApiResponse<T = any> = {
  data: T;
  source: string;
  rate_limit?: {
    limit: number | null;
    remaining: number | null;
  };
};

export const TOOLS = [
  {
    name: "nasa_daily_brief",
    description: "Get a compact NASA daily brief: today's astronomy image, recent space-weather notices, active Earth events, and the latest DSCOVR full-disc Earth image. Returns partial results if an upstream NASA service is down.",
    inputSchema: {
      type: "object",
      properties: {
        lookback_days: { type: "integer", minimum: 1, maximum: 14, default: 3, description: "Days of space-weather and Earth-event history to include." },
        earth_event_limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nasa_apod",
    description: "Get NASA's Astronomy Picture of the Day for a date, or a small random sample. Returns image/video URLs, title, credit, and a bounded explanation.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date in YYYY-MM-DD format." },
        count: { type: "integer", minimum: 1, maximum: 10, description: "Optional random sample size. Cannot be combined with date." },
        include_hd: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nasa_search_media",
    description: "Search NASA's public image, video, and audio library. Returns compact metadata plus preview/original links and NASA media IDs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "Free-text search query." },
        media_type: { type: "string", enum: ["image", "video", "audio"], default: "image" },
        year_start: { type: "integer", minimum: 1900, maximum: 2200 },
        year_end: { type: "integer", minimum: 1900, maximum: 2200 },
        page: { type: "integer", minimum: 1, maximum: 100, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "nasa_media_asset",
    description: "Resolve a NASA media ID to its downloadable image, video, audio, caption, and metadata files.",
    inputSchema: {
      type: "object",
      properties: {
        nasa_id: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["nasa_id"],
      additionalProperties: false,
    },
  },
  {
    name: "nasa_earth_events",
    description: "Find current or recent natural events from NASA EONET, including storms, wildfires, volcanoes, floods, sea/lake ice, dust, drought, and landslides. Returns latest coordinates and source links.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        days: { type: "integer", minimum: 1, maximum: 365, default: 14 },
        category: { type: "string", minLength: 1, maxLength: 80, description: "Optional EONET category ID, such as wildfires, severeStorms, volcanoes, floods, or seaLakeIce." },
        bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "Optional [west, north, east, south] bounding box." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 15 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nasa_space_weather",
    description: "Get recent NASA DONKI space-weather reports: notifications, solar flares, CMEs, geomagnetic storms, solar energetic particles, interplanetary shocks, magnetopause crossings, radiation-belt enhancements, or high-speed streams.",
    inputSchema: {
      type: "object",
      properties: {
        event_type: { type: "string", enum: ["notifications", "flares", "cmes", "geomagnetic_storms", "solar_particles", "shocks", "magnetopause_crossings", "radiation_belt", "high_speed_streams"], default: "notifications" },
        start_date: { type: "string", description: "Optional YYYY-MM-DD start date. Defaults from days." },
        end_date: { type: "string", description: "Optional YYYY-MM-DD end date. Defaults to today UTC." },
        days: { type: "integer", minimum: 1, maximum: 30, default: 7, description: "Lookback used when start_date is omitted." },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nasa_epic_earth",
    description: "Get DSCOVR/EPIC full-disc Earth images with direct PNG/JPG/thumbnail URLs and spacecraft geometry. Keyless NASA endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", enum: ["natural", "enhanced", "aerosol", "cloud"], default: "natural" },
        date: { type: "string", description: "Optional YYYY-MM-DD archive date. Omit for the latest images." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 6 },
      },
      additionalProperties: false,
    },
  },
] as const;

function boundedInt(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

const TOOL_ARG_KEYS: Record<string, Set<string>> = {
  nasa_daily_brief: new Set(["lookback_days", "earth_event_limit"]),
  nasa_apod: new Set(["date", "count", "include_hd"]),
  nasa_search_media: new Set(["query", "media_type", "year_start", "year_end", "page", "limit"]),
  nasa_media_asset: new Set(["nasa_id"]),
  nasa_earth_events: new Set(["status", "days", "category", "bbox", "limit"]),
  nasa_space_weather: new Set(["event_type", "start_date", "end_date", "days", "limit"]),
  nasa_epic_earth: new Set(["collection", "date", "limit"]),
};

function assertToolArgs(name: string, args: unknown): asserts args is JsonObject {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("tool arguments must be an object");
  const allowed = TOOL_ARG_KEYS[name];
  if (!allowed) throw new Error(`Unknown tool: ${name}`);
  const extras = Object.keys(args).filter((key) => !allowed.has(key));
  if (extras.length) throw new Error(`unexpected argument${extras.length === 1 ? "" : "s"}: ${extras.join(", ")}`);
}

export function boundedTextInput(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const result = value.trim();
  if (!result) throw new Error(`${name} is required`);
  if (result.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return result;
}

function enumInput(value: unknown, fallback: string, choices: readonly string[], name: string): string {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "string" || !choices.includes(result)) {
    throw new Error(`${name} must be one of: ${choices.join(", ")}`);
  }
  return result;
}

function text(value: unknown, max = 1500): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function redactApiKey(value: string): string {
  let redacted = value.replace(/([?&]api_key=)[^&\s]+/gi, "$1[redacted]");
  const key = process.env.NASA_API_KEY;
  if (key && key !== "DEMO_KEY") redacted = redacted.split(key).join("[redacted]");
  return redacted;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function validateDate(value: unknown, name = "date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`);
  }
  return value;
}

export function validateApodDate(value: unknown): string {
  const date = validateDate(value, "date");
  if (date < "1995-06-16") throw new Error("date must be on or after APOD's first publication: 1995-06-16");
  if (date > isoToday()) throw new Error("date cannot be in the future");
  return date;
}

export function validateDateRange(startValue: unknown, endValue: unknown, maxDays = 30): { start: string; end: string } {
  const start = validateDate(startValue, "start_date");
  const end = validateDate(endValue, "end_date");
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  if (span < 0) throw new Error("end_date must be on or after start_date");
  if (span > maxDays) throw new Error(`date range must be at most ${maxDays} days`);
  return { start, end };
}

export function compactValue(value: any, depth = 0, arrayLimit = 5): any {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value);
  if (depth >= 3) return "[nested data omitted]";
  if (Array.isArray(value)) {
    const items = value.slice(0, arrayLimit).map((item) => compactValue(item, depth + 1, arrayLimit));
    if (value.length > arrayLimit) items.push(`… ${value.length - arrayLimit} more`);
    return items;
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 24).map(([k, v]) => [k, compactValue(v, depth + 1, arrayLimit)]));
  }
  return String(value);
}

async function fetchJson<T = any>(url: URL, source: string): Promise<ApiResponse<T>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "nasa-mcp/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = redactApiKey(text(await response.text(), MAX_ERROR_BODY) ?? "");
        const rate = response.headers.get("x-ratelimit-remaining");
        const error = new Error(`${source} returned HTTP ${response.status}${rate !== null ? ` (rate remaining: ${rate})` : ""}: ${body}`);
        if (response.status >= 500 && attempt === 0) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw error;
      }
      const limit = response.headers.get("x-ratelimit-limit");
      const remaining = response.headers.get("x-ratelimit-remaining");
      return {
        data: await response.json() as T,
        source: redactApiKey(url.toString()),
        ...(limit !== null || remaining !== null ? {
          rate_limit: {
            limit: limit === null ? null : Number(limit),
            remaining: remaining === null ? null : Number(remaining),
          },
        } : {}),
      };
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error(`${source} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`);
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 0 && /fetch failed|ECONNRESET|ENOTFOUND/.test(lastError.message)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error(`${source} request failed`);
}

async function nasaGet(path: string, params: Record<string, string> = {}): Promise<ApiResponse> {
  const url = new URL(`${NASA_BASE}${path}`);
  url.searchParams.set("api_key", process.env.NASA_API_KEY || "DEMO_KEY");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchJson(url, `NASA ${path}`);
}

async function keylessGet(base: string, path: string, params: Record<string, string>, source: string): Promise<ApiResponse> {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchJson(url, source);
}

export function normalizeApodItem(item: JsonObject, includeHd: boolean): JsonObject {
  return {
    date: item.date ?? null,
    title: item.title ?? null,
    media_type: item.media_type ?? null,
    copyright: item.copyright ?? null,
    explanation: text(item.explanation, 2400),
    url: item.url ?? null,
    thumbnail_url: item.thumbnail_url ?? null,
    ...(includeHd ? { hdurl: item.hdurl ?? null } : {}),
    service_version: item.service_version ?? null,
  };
}

async function getApod(args: JsonObject): Promise<JsonObject> {
  if (args.include_hd !== undefined && typeof args.include_hd !== "boolean") throw new Error("include_hd must be a boolean");
  const includeHd = args.include_hd !== false;
  if (args.date !== undefined && args.count !== undefined) throw new Error("date and count cannot be combined");
  const params: Record<string, string> = { thumbs: "true" };
  if (args.date !== undefined) params.date = validateApodDate(args.date);
  if (args.count !== undefined) params.count = String(boundedInt(args.count, 1, 1, 10, "count"));
  const response = await nasaGet("/planetary/apod", params);
  const items = Array.isArray(response.data) ? response.data : [response.data];
  return {
    key_mode: process.env.NASA_API_KEY ? "personal" : "DEMO_KEY",
    rate_limit: response.rate_limit ?? null,
    items: items.map((item) => normalizeApodItem(item, includeHd)),
    source: response.source,
  };
}

export function normalizeMediaSearch(data: JsonObject): { total_hits: number; items: JsonObject[] } {
  const collection = data?.collection ?? {};
  const items = (collection.items ?? []).map((item: JsonObject) => {
    const metadata = item.data?.[0] ?? {};
    const links = item.links ?? [];
    const preview = links.find((link: JsonObject) => link.rel === "preview")?.href ?? null;
    const original = links.find((link: JsonObject) => link.rel === "canonical")?.href ?? null;
    return {
      nasa_id: metadata.nasa_id ?? null,
      title: metadata.title ?? null,
      media_type: metadata.media_type ?? null,
      date_created: metadata.date_created ?? null,
      center: metadata.center ?? null,
      photographer: metadata.photographer ?? metadata.secondary_creator ?? null,
      description: text(metadata.description ?? metadata.description_508, 1200),
      keywords: Array.isArray(metadata.keywords) ? metadata.keywords.slice(0, 12) : [],
      preview_url: preview,
      original_url: original,
      asset_manifest: item.href ?? null,
    };
  });
  return { total_hits: Number(collection.metadata?.total_hits ?? items.length), items };
}

async function searchMedia(args: JsonObject): Promise<JsonObject> {
  const query = boundedTextInput(args.query, "query", 200);
  const limit = boundedInt(args.limit, 8, 1, 20, "limit");
  const page = boundedInt(args.page, 1, 1, 100, "page");
  const mediaType = enumInput(args.media_type, "image", ["image", "video", "audio"], "media_type");
  const params: Record<string, string> = { q: query, media_type: mediaType, page: String(page), page_size: String(limit) };
  if (args.year_start !== undefined) params.year_start = String(boundedInt(args.year_start, 1900, 1900, 2200, "year_start"));
  if (args.year_end !== undefined) params.year_end = String(boundedInt(args.year_end, 2200, 1900, 2200, "year_end"));
  if (params.year_start && params.year_end && Number(params.year_end) < Number(params.year_start)) throw new Error("year_end must be on or after year_start");
  const response = await keylessGet(MEDIA_BASE, "/search", params, "NASA media search");
  return { query, media_type: mediaType, page, ...normalizeMediaSearch(response.data), source: response.source };
}

async function getMediaAsset(args: JsonObject): Promise<JsonObject> {
  const nasaId = boundedTextInput(args.nasa_id, "nasa_id", 200);
  const response = await keylessGet(MEDIA_BASE, `/asset/${encodeURIComponent(nasaId)}`, {}, "NASA media asset");
  const files = normalizeAssetLinks(response.data?.collection?.items ?? []);
  return { nasa_id: nasaId, file_count: files.length, files, source: response.source };
}

export function normalizeAssetLinks(items: JsonObject[]): string[] {
  return items
    .map((item: JsonObject) => typeof item.href === "string" ? item.href.replace(/^http:\/\/images-assets\.nasa\.gov\//, "https://images-assets.nasa.gov/") : null)
    .filter((value): value is string => Boolean(value))
    .slice(0, 80);
}

export function normalizeEarthEvents(data: JsonObject): { total: number; events: JsonObject[] } {
  const events = (data?.events ?? []).map((event: JsonObject) => {
    const geometry = Array.isArray(event.geometry) ? event.geometry : [];
    const latest = geometry.length ? geometry[geometry.length - 1] : null;
    return {
      id: event.id ?? null,
      title: event.title ?? null,
      status: event.closed ? "closed" : "open",
      closed: event.closed ?? null,
      categories: (event.categories ?? []).map((c: JsonObject) => ({ id: c.id, title: c.title })),
      latest_location: latest ? compactValue(latest, 0, 6) : null,
      geometry_points: geometry.length,
      sources: (event.sources ?? []).slice(0, 8).map((s: JsonObject) => ({ id: s.id, url: s.url })),
      eonet_link: event.link ?? null,
    };
  });
  return { total: events.length, events };
}

async function getEarthEvents(args: JsonObject): Promise<JsonObject> {
  const status = enumInput(args.status, "open", ["open", "closed", "all"], "status");
  const days = boundedInt(args.days, 14, 1, 365, "days");
  const limit = boundedInt(args.limit, 15, 1, 50, "limit");
  const params: Record<string, string> = { status, days: String(days), limit: String(limit) };
  let category: string | null = null;
  if (args.category !== undefined) {
    category = boundedTextInput(args.category, "category", 80);
    if (!/^[A-Za-z0-9,_-]+$/.test(category)) throw new Error("category must contain only EONET category IDs");
    params.category = category;
  }
  if (args.bbox !== undefined) {
    if (!Array.isArray(args.bbox) || args.bbox.length !== 4 || args.bbox.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error("bbox must contain four numbers: [west, north, east, south]");
    }
    params.bbox = args.bbox.join(",");
  }
  const response = await keylessGet(EONET_BASE, "/events", params, "NASA EONET");
  return { status, days, category, ...normalizeEarthEvents(response.data), source: response.source };
}

const DONKI_PATHS: Record<string, string> = {
  notifications: "notifications",
  flares: "FLR",
  cmes: "CME",
  geomagnetic_storms: "GST",
  solar_particles: "SEP",
  shocks: "IPS",
  magnetopause_crossings: "MPC",
  radiation_belt: "RBE",
  high_speed_streams: "HSS",
};

function eventTime(item: JsonObject): string {
  return item.messageIssueTime ?? item.beginTime ?? item.startTime ?? item.eventTime ?? item.activityID ?? "";
}

async function getSpaceWeather(args: JsonObject): Promise<JsonObject> {
  const eventType = enumInput(args.event_type, "notifications", Object.keys(DONKI_PATHS), "event_type");
  const path = DONKI_PATHS[eventType];
  const days = boundedInt(args.days, 7, 1, 30, "days");
  const endDefault = isoToday();
  const end = args.end_date === undefined ? endDefault : validateDate(args.end_date, "end_date");
  const start = args.start_date === undefined ? daysBefore(end, days - 1) : validateDate(args.start_date, "start_date");
  validateDateRange(start, end, 30);
  const limit = boundedInt(args.limit, 10, 1, 30, "limit");
  const params: Record<string, string> = { startDate: start, endDate: end };
  if (eventType === "notifications") params.type = "all";
  const response = await nasaGet(`/DONKI/${path}`, params);
  const records = (Array.isArray(response.data) ? response.data : []).sort((a, b) => eventTime(b).localeCompare(eventTime(a))).slice(0, limit);
  return {
    event_type: eventType,
    start_date: start,
    end_date: end,
    total_returned: records.length,
    events: records.map((item) => compactValue(item, 0, 6)),
    key_mode: process.env.NASA_API_KEY ? "personal" : "DEMO_KEY",
    rate_limit: response.rate_limit ?? null,
    source: response.source,
  };
}

export function buildEpicImageUrls(collection: string, image: string, date: string): JsonObject {
  const day = date.slice(0, 10).replace(/-/g, "/");
  const archive = `${EPIC_BASE}/archive/${collection}/${day}`;
  return {
    png: `${archive}/png/${image}.png`,
    jpg: `${archive}/jpg/${image}.jpg`,
    thumbnail: `${archive}/thumbs/${image}.jpg`,
  };
}

async function getEpicEarth(args: JsonObject): Promise<JsonObject> {
  const collection = enumInput(args.collection, "natural", ["natural", "enhanced", "aerosol", "cloud"], "collection");
  const limit = boundedInt(args.limit, 6, 1, 20, "limit");
  const date = args.date === undefined ? null : validateDate(args.date);
  const path = date ? `/api/${collection}/date/${date}` : `/api/${collection}`;
  const response = await keylessGet(EPIC_BASE, path, {}, "NASA EPIC");
  const raw = Array.isArray(response.data) ? response.data : [];
  const images = raw.slice(-limit).reverse().map((item: JsonObject) => ({
    identifier: item.identifier ?? null,
    date: item.date ?? null,
    caption: text(item.caption, 800),
    centroid_coordinates: item.centroid_coordinates ?? null,
    dscovr_j2000_position: item.dscovr_j2000_position ?? null,
    lunar_j2000_position: item.lunar_j2000_position ?? null,
    sun_j2000_position: item.sun_j2000_position ?? null,
    urls: buildEpicImageUrls(collection, item.image, item.date),
  }));
  return { collection, requested_date: date, available_images: raw.length, images, source: response.source };
}

async function getDailyBrief(args: JsonObject): Promise<JsonObject> {
  const lookback = boundedInt(args.lookback_days, 3, 1, 14, "lookback_days");
  const eventLimit = boundedInt(args.earth_event_limit, 8, 1, 20, "earth_event_limit");
  const jobs: Array<[string, Promise<JsonObject>]> = [
    ["astronomy_picture", getApod({ include_hd: true })],
    ["space_weather", getSpaceWeather({ event_type: "notifications", days: lookback, limit: 6 })],
    ["earth_events", getEarthEvents({ status: "open", days: lookback, limit: eventLimit })],
    ["earth_image", getEpicEarth({ collection: "natural", limit: 1 })],
  ];
  const settled = await Promise.allSettled(jobs.map(([, promise]) => promise));
  const sections: JsonObject = {};
  const warnings: string[] = [];
  settled.forEach((result, index) => {
    const name = jobs[index][0];
    if (result.status === "fulfilled") sections[name] = result.value;
    else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      sections[name] = { unavailable: true, error: message };
      warnings.push(`${name}: ${message}`);
    }
  });
  return {
    generated_at: new Date().toISOString(),
    lookback_days: lookback,
    partial: warnings.length > 0,
    warnings,
    ...sections,
  };
}

export async function handleTool(name: string, args: JsonObject = {}): Promise<JsonObject> {
  assertToolArgs(name, args);
  switch (name) {
    case "nasa_daily_brief": return getDailyBrief(args);
    case "nasa_apod": return getApod(args);
    case "nasa_search_media": return searchMedia(args);
    case "nasa_media_asset": return getMediaAsset(args);
    case "nasa_earth_events": return getEarthEvents(args);
    case "nasa_space_weather": return getSpaceWeather(args);
    case "nasa_epic_earth": return getEpicEarth(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEpicImageUrls,
  boundedTextInput,
  compactValue,
  normalizeApodItem,
  normalizeAssetLinks,
  normalizeEarthEvents,
  normalizeMediaSearch,
  validateApodDate,
  validateDate,
  validateDateRange,
} from "../dist/nasa.js";

test("boundedTextInput trims normal input and rejects context-flooding values", () => {
  assert.equal(boundedTextInput("  Apollo 11  ", "query", 200), "Apollo 11");
  assert.throws(() => boundedTextInput("x".repeat(201), "query", 200), /at most 200/);
  assert.throws(() => boundedTextInput({ q: "Apollo" }, "query", 200), /must be a string/);
});

test("tool handlers enforce JSON-schema types and reject unknown arguments", async () => {
  const { handleTool } = await import("../dist/nasa.js");
  await assert.rejects(() => handleTool("nasa_search_media", { query: 123 }), /must be a string/);
  await assert.rejects(() => handleTool("nasa_search_media", { query: "Apollo", limit: "1" }), /must be an integer/);
  await assert.rejects(() => handleTool("nasa_search_media", { query: "Apollo", media_type: true }), /media_type must be one of/);
  await assert.rejects(() => handleTool("nasa_search_media", { query: "Apollo", bogus: true }), /unexpected argument/);
  await assert.rejects(() => handleTool("nasa_apod", { include_hd: "false" }), /must be a boolean/);
  await assert.rejects(() => handleTool("nasa_earth_events", { bbox: ["-80", 40, -70, 30] }), /four numbers/);
});

test("NASA API errors redact registered keys from upstream bodies", async () => {
  const { handleTool } = await import("../dist/nasa.js");
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.NASA_API_KEY;
  const fakeKey = "unit-test-secret-nasa-key";
  process.env.NASA_API_KEY = fakeKey;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ url: `https://api.nasa.gov/x?api_key=${fakeKey}`, token: fakeKey }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
  try {
    await assert.rejects(
      () => handleTool("nasa_apod", {}),
      (error) => error instanceof Error && !error.message.includes(fakeKey) && error.message.includes("[redacted]"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NASA_API_KEY;
    else process.env.NASA_API_KEY = originalKey;
  }
});

test("validateDate accepts ISO dates and rejects malformed dates", () => {
  assert.equal(validateDate("2026-07-30", "date"), "2026-07-30");
  assert.throws(() => validateDate("07/30/2026", "date"), /YYYY-MM-DD/);
  assert.throws(() => validateDate("2026-02-30", "date"), /valid calendar date/);
});

test("APOD dates respect NASA publication bounds", () => {
  assert.equal(validateApodDate("1995-06-16"), "1995-06-16");
  assert.throws(() => validateApodDate("1995-06-15"), /first publication/);
  assert.throws(() => validateApodDate("2200-01-01"), /future/);
});

test("video APOD results retain thumbnails and optional HD URLs", () => {
  const item = normalizeApodItem({
    date: "2026-07-30",
    title: "Video",
    media_type: "video",
    url: "https://example.test/video",
    thumbnail_url: "https://example.test/thumb.jpg",
    hdurl: "https://example.test/hd.jpg",
  }, true);
  assert.equal(item.thumbnail_url, "https://example.test/thumb.jpg");
  assert.equal(item.hdurl, "https://example.test/hd.jpg");
});

test("NASA asset manifests upgrade only the known asset host to HTTPS", () => {
  const links = normalizeAssetLinks([
    { href: "http://images-assets.nasa.gov/image/x.jpg" },
    { href: "http://example.test/leave-alone.jpg" },
  ]);
  assert.equal(links[0], "https://images-assets.nasa.gov/image/x.jpg");
  assert.equal(links[1], "http://example.test/leave-alone.jpg");
});

test("Earth-event category output matches the normalized upstream value", async () => {
  const { handleTool } = await import("../dist/nasa.js");
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await handleTool("nasa_earth_events", { category: "  wildfires  " });
    assert.equal(result.category, "wildfires");
    assert.equal(new URL(requestedUrl).searchParams.get("category"), "wildfires");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateDateRange rejects reversed and oversized windows", () => {
  assert.deepEqual(validateDateRange("2026-07-01", "2026-07-07", 30), {
    start: "2026-07-01",
    end: "2026-07-07",
  });
  assert.throws(() => validateDateRange("2026-07-08", "2026-07-07", 30), /on or after/);
  assert.throws(() => validateDateRange("2026-01-01", "2026-07-01", 30), /at most 30 days/);
});

test("compactValue bounds strings, arrays, and object depth", () => {
  const result = compactValue({ text: "x".repeat(2000), list: [1, 2, 3, 4] }, 0, 3);
  assert.equal(result.text.length, 1501);
  assert.deepEqual(result.list, [1, 2, 3, "… 1 more"]);
});

test("EPIC URLs use zero-padded archive paths", () => {
  const urls = buildEpicImageUrls("natural", "epic_1b_20260730003633", "2026-07-30 00:36:33");
  assert.equal(urls.png, "https://epic.gsfc.nasa.gov/archive/natural/2026/07/30/png/epic_1b_20260730003633.png");
  assert.match(urls.thumbnail, /\/thumbs\/epic_1b_20260730003633\.jpg$/);
});

test("media search keeps useful fields and direct asset links", () => {
  const result = normalizeMediaSearch({ collection: { metadata: { total_hits: 1 }, items: [{
    href: "https://example/collection.json",
    data: [{ nasa_id: "ID-1", title: "Moon", media_type: "image", description: "A moon" }],
    links: [{ rel: "preview", href: "https://example/thumb.jpg" }, { rel: "canonical", href: "https://example/orig.jpg" }],
  }] } });
  assert.equal(result.total_hits, 1);
  assert.equal(result.items[0].nasa_id, "ID-1");
  assert.equal(result.items[0].original_url, "https://example/orig.jpg");
});

test("Earth events use the latest geometry and retain source URLs", () => {
  const result = normalizeEarthEvents({ events: [{
    id: "EONET_1", title: "Storm", closed: null,
    categories: [{ id: "severeStorms", title: "Severe Storms" }],
    sources: [{ id: "NOAA", url: "https://example/storm" }],
    geometry: [
      { date: "2026-07-29T00:00:00Z", type: "Point", coordinates: [1, 2] },
      { date: "2026-07-30T00:00:00Z", type: "Point", coordinates: [3, 4] },
    ],
  }] });
  assert.deepEqual(result.events[0].latest_location.coordinates, [3, 4]);
  assert.equal(result.events[0].sources[0].url, "https://example/storm");
});

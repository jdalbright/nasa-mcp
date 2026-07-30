# NASA MCP

A local stdio MCP server that turns NASA's public APIs into compact, assistant-friendly tools instead of pouring raw telemetry into the context window.

## Tools

- `nasa_daily_brief` — APOD, recent space-weather notices, current Earth events, and the latest full-disc Earth image in one fault-tolerant call.
- `nasa_apod` — Astronomy Picture of the Day by date or random sample.
- `nasa_search_media` — search NASA's image, video, and audio library.
- `nasa_media_asset` — retrieve downloadable files for a NASA media ID.
- `nasa_earth_events` — current/recent wildfires, storms, volcanoes, icebergs, floods, and other EONET events.
- `nasa_space_weather` — DONKI notifications or event feeds such as flares, CMEs, and geomagnetic storms.
- `nasa_epic_earth` — recent DSCOVR/EPIC full-disc Earth imagery with direct image URLs.
- `nasa_power_daily` — historical daily weather, solar-resource, and agricultural data for a latitude/longitude in compact columnar series.
- `nasa_power_climatology` — monthly and annual climate normals for a location using NASA POWER's standard 2001–2020 baseline.

NASA POWER tools provide `weather`, `solar`, and `agriculture` presets, or up to ten explicitly selected parameter codes. The agriculture preset defaults to POWER's `AG` community; other requests default to `RE`, with `SB` also available when community-specific units are needed. Daily requests are limited to 366 calendar days and 2,000 parameter-day values, radiation parameters begin on 1984-01-01, and responses clearly identify the data as historical rather than a forecast.

## Setup

```bash
npm install
npm test
npm run smoke
```

The smoke test always exercises the six keyless live tools. It exercises APOD, DONKI, and the combined daily brief only when a registered `NASA_API_KEY` is configured; degraded API-keyed sections do not receive a false green.

`NASA_API_KEY` is optional. Without it, the server uses NASA's `DEMO_KEY` (30 requests/hour and 50/day per IP). EONET, EPIC, NASA POWER, and the NASA media library are keyless. For regular use, create a free key at <https://api.nasa.gov/> and expose it as `NASA_API_KEY` in the MCP server environment.

## Run

```bash
NASA_API_KEY=... node dist/index.js
```

The server speaks MCP over stdio. Logs go to stderr; stdout is reserved for protocol frames.

## Data behavior

- Date ranges, numeric limits, enum values, and extra arguments are strictly validated.
- Free-text and ID inputs are length-limited; outputs are normalized, truncated, and capped to avoid context flooding.
- Requests are restricted to fixed NASA HTTPS origins, use 20-second timeouts, and retry transient 5xx responses once.
- `nasa_daily_brief` returns partial results when one upstream API is unavailable, including shared `DEMO_KEY` throttling.
- NASA API keys are redacted from returned source URLs; rate-limit headers are surfaced when available.

Sources: NASA Open APIs, NASA Image and Video Library, EONET v3, DONKI, EPIC, and NASA POWER.

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env, NODE_ENV: "test" },
  stderr: "pipe",
});
const client = new Client({ name: "nasa-mcp-smoke", version: "1.0.0" });

function parse(result) {
  assert.equal(result.isError, undefined, result.content?.[0]?.text ?? "tool error");
  assert.equal(result.content?.[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 9);

  const oversized = await client.callTool({
    name: "nasa_search_media",
    arguments: { query: "x".repeat(201) },
  });
  assert.equal(oversized.isError, true, "oversized search queries should be rejected before reaching NASA");

  const invalidPower = await client.callTool({
    name: "nasa_power_daily",
    arguments: {
      latitude: 91,
      longitude: -78.6382,
      start_date: "2025-07-01",
      end_date: "2025-07-03",
    },
  });
  assert.equal(invalidPower.isError, true, "out-of-range POWER coordinates should be rejected before reaching NASA");

  const media = parse(await client.callTool({
    name: "nasa_search_media",
    arguments: { query: "Artemis II", media_type: "image", limit: 2 },
  }));
  assert.ok(media.total_hits >= 1);
  assert.ok(media.items[0]?.nasa_id);

  const asset = parse(await client.callTool({
    name: "nasa_media_asset",
    arguments: { nasa_id: media.items[0].nasa_id },
  }));
  assert.ok(asset.file_count >= 1);
  assert.ok(asset.files.every((url) => !url.startsWith("http://images-assets.nasa.gov/")));

  const earth = parse(await client.callTool({
    name: "nasa_earth_events",
    arguments: { status: "open", days: 7, limit: 3 },
  }));
  assert.ok(Array.isArray(earth.events));

  const epic = parse(await client.callTool({
    name: "nasa_epic_earth",
    arguments: { collection: "natural", limit: 1 },
  }));
  assert.ok(epic.images.length >= 1);

  const powerDaily = parse(await client.callTool({
    name: "nasa_power_daily",
    arguments: {
      latitude: 35.7796,
      longitude: -78.6382,
      start_date: "2025-07-01",
      end_date: "2025-07-03",
      profile: "weather",
    },
  }));
  assert.equal(powerDaily.forecast, false);
  assert.equal(powerDaily.data.periods.length, 3);
  assert.equal(powerDaily.data.series.T2M.length, 3);
  assert.equal(powerDaily.parameters.T2M.units, "C");

  const powerClimatology = parse(await client.callTool({
    name: "nasa_power_climatology",
    arguments: { latitude: 35.7796, longitude: -78.6382, profile: "solar" },
  }));
  assert.equal(powerClimatology.forecast, false);
  assert.ok(powerClimatology.data.periods.includes("ANN"));
  assert.match(powerClimatology.climatology_range, /2001.*2020/);

  const hasRegisteredKey = Boolean(process.env.NASA_API_KEY && process.env.NASA_API_KEY !== "DEMO_KEY");
  let apiKeyedReadiness = "skipped: set NASA_API_KEY for APOD/DONKI readiness";
  if (hasRegisteredKey) {
    const brief = parse(await client.callTool({
      name: "nasa_daily_brief",
      arguments: { lookback_days: 2, earth_event_limit: 3 },
    }));
    assert.equal(brief.partial, false, `registered-key readiness failed: ${(brief.warnings ?? []).join("; ")}`);
    apiKeyedReadiness = "passed";
  }

  console.log(JSON.stringify({
    tools_discovered: listed.tools.length,
    malformed_input_rejected: true,
    keyless_live_tools: ["nasa_search_media", "nasa_media_asset", "nasa_earth_events", "nasa_epic_earth", "nasa_power_daily", "nasa_power_climatology"],
    api_keyed_readiness: apiKeyedReadiness,
    media_hits: media.total_hits,
    media_sample: media.items[0].nasa_id,
    asset_files: asset.file_count,
    active_earth_events_returned: earth.events.length,
    epic_images_returned: epic.images.length,
    power_daily_periods: powerDaily.data.periods.length,
    power_climatology_periods: powerClimatology.data.periods.length,
  }, null, 2));
} finally {
  await client.close();
}

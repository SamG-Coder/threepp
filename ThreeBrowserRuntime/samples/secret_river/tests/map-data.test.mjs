import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAP_DATA } from "../src/game/map-data.generated.mjs";

const sourceRoot = new URL("../assets/maps/source/", import.meta.url);

test("bundled NSW map slice contains the connected named waterways and ferries", async () => {
  const [hydro, roads, ferries] = await Promise.all([
    readFile(new URL("nsw-hydro-area-main.geojson", sourceRoot), "utf8").then(JSON.parse),
    readFile(new URL("nsw-road-segments.geojson", sourceRoot), "utf8").then(JSON.parse),
    readFile(new URL("nsw-ferry-routes.geojson", sourceRoot), "utf8").then(JSON.parse),
  ]);

  assert.equal(hydro.features.length, 5);
  assert.equal(roads.features.length, 195);
  assert.equal(ferries.features.length, 2);
  assert.ok(hydro.features.some(feature => feature.properties.hydroname === "HAWKESBURY"));
  assert.ok(hydro.features.some(feature => feature.properties.hydroname === "MACDONALD"));
  assert.ok(ferries.features.some(feature => feature.properties.generalname === "WISEMANS FERRY"));
});

test("generated display map is compact, attributed and pins the authoritative confluence", async () => {
  assert.ok(MAP_DATA.waterways.some(waterway => waterway.name === "Hawkesbury River"));
  assert.ok(MAP_DATA.waterways.some(waterway => waterway.name === "Macdonald River"));
  assert.ok(MAP_DATA.roads.length >= 30);
  assert.equal(MAP_DATA.ferries.length, 2);
  assert.deepEqual(
    MAP_DATA.landmarks.find(landmark => landmark.id === "first-branch").coordinate,
    [150.984994, -33.3783594],
  );

  const attribution = await readFile(new URL("../assets/maps/MAP_SOURCES.md", import.meta.url), "utf8");
  assert.match(attribution, /State of New South Wales/i);
  assert.match(attribution, /Creative Commons Attribution/i);
  assert.match(attribution, /scripts\/build-map-data\.mjs/);
});

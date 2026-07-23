import test from "node:test";
import assert from "node:assert/strict";

import {
  lowerTerrainGeometryProvider,
  TerrainFlightControllerNode,
  terrainFlightControllerProcess,
} from "../js/libraries/terrain-engine/index.js";

test("terrain flight animation is a reusable phase-continuous node independent from rendering", () => {
  const state = {};
  const first = terrainFlightControllerProcess({
    componentTime: 2,
    flightSpeed: 1,
    turn: 0,
    altitude: 4,
    terrainScale: 0.5,
  }, { state }).flight;
  const outputIdentity = first;
  const second = terrainFlightControllerProcess({
    componentTime: 3,
    flightSpeed: 2,
    turn: 0,
    altitude: 4,
    terrainScale: 1.25,
  }, { state }).flight;

  assert.strictEqual(second, outputIdentity);
  assert.equal(second.flightTime, 4);
  assert.equal(second.altitude, 4);
  assert.equal(second.cameraAnchor[1] * second.terrainScale + second.terrainPhase[1], second.cameraAnchor[1] * 0.5);
  assert.equal(TerrainFlightControllerNode.capabilities.includes("graph-placeable"), true);
  assert.equal(TerrainFlightControllerNode.capabilities.includes("live-fast-path"), true);
});

test("terrain geometry providers lower reusable height-field and planar-grid semantics before rendering", () => {
  const authored = { mountainHeight: 4, gridWidth: 48 };
  assert.strictEqual(
    lowerTerrainGeometryProvider(authored, "terrain-height-field"),
    authored,
  );
  assert.deepEqual(
    lowerTerrainGeometryProvider(authored, "planar-grid"),
    { mountainHeight: 0, gridWidth: 48 },
  );
  assert.throws(
    () => lowerTerrainGeometryProvider(authored, "unknown"),
    /TERRAIN_GEOMETRY_PROVIDER_UNSUPPORTED:unknown/,
  );
});

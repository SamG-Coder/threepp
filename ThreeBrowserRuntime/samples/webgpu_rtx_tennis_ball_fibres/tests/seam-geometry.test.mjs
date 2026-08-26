import assert from "node:assert/strict";
import test from "node:test";
import {
  createDepressedBallGeometry,
  createGlobalUndercoatGeometry,
  createSeamGeometry,
} from "../src/tennis-ball.mjs";

test("the regulation seam ribbon closes continuously with outward normals", () => {
  const segments = 96;
  const crossSegments = 8;
  const radius = 0.9895;
  const edgeLift = 0.0022;
  const geometry = createSeamGeometry({ radius, edgeLift, halfWidth: 0.046, segments, crossSegments });
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  const lanes = crossSegments + 1;
  assert.equal(positions.count, (segments + 1) * lanes);
  assert.equal(index.count, segments * crossSegments * 6);

  for (let lane = 0; lane < lanes; ++lane) {
    const first = lane;
    const last = segments * lanes + lane;
    const distance = Math.hypot(
      positions.getX(first) - positions.getX(last),
      positions.getY(first) - positions.getY(last),
      positions.getZ(first) - positions.getZ(last),
    );
    assert.ok(distance < 1e-5, `seam closure gap ${distance}`);
  }
  for (let vertex = 0; vertex < positions.count; vertex += 17) {
    const vertexRadius = Math.hypot(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    const normalLength = Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
    const alignment = positions.getX(vertex) * normals.getX(vertex) +
      positions.getY(vertex) * normals.getY(vertex) +
      positions.getZ(vertex) * normals.getZ(vertex);
    assert.ok(vertexRadius >= radius - 0.0002 && vertexRadius <= radius + edgeLift + 0.0002);
    assert.ok(Math.abs(normalLength - 1) < 1e-5);
    assert.ok(alignment / vertexRadius > 0.99);
  }
  geometry.dispose();
});

test("the ball backing is physically depressed under the seam", () => {
  const geometry = createDepressedBallGeometry({ widthSegments: 64, heightSegments: 40 });
  const positions = geometry.getAttribute("position");
  let minimumRadius = Infinity;
  let maximumRadius = 0;
  for (let vertex = 0; vertex < positions.count; ++vertex) {
    const radius = Math.hypot(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    minimumRadius = Math.min(minimumRadius, radius);
    maximumRadius = Math.max(maximumRadius, radius);
  }
  assert.ok(minimumRadius < 0.989);
  assert.ok(maximumRadius > 0.9999);
  geometry.dispose();
});

test("global micro-felt is deterministic and keeps seam candidates buried", () => {
  const first = createGlobalUndercoatGeometry({ count: 512, seed: 0x12345678 });
  const second = createGlobalUndercoatGeometry({ count: 512, seed: 0x12345678 });
  assert.deepEqual(first.getAttribute("position").array, second.getAttribute("position").array);
  assert.equal(first.getAttribute("position").count, 512 * 5);
  assert.equal(first.getIndex().count, 512 * 9);
  let buried = 0;
  const positions = first.getAttribute("position");
  for (let fibre = 0; fibre < 512; ++fibre) {
    const vertex = fibre * 5;
    const radius = Math.hypot(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    if (radius < 0.98) buried += 1;
  }
  assert.ok(buried > 0, "expected the seam band to contain buried, non-visible topology");
  first.dispose();
  second.dispose();
});

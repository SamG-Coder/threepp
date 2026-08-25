import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import cmd, {
  RTX_MAX_INSTANCE_GROUP_CAPACITY as COMMAND_MAX_CAPACITY,
} from "../../host/ThreeBrowser/web/three-webgpu-cmd.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterUrl = pathToFileURL(path.resolve(
  here,
  "../../host/ThreeBrowser/web/three-webgpu-gpu.js",
));

test("RTX instance-group JavaScript contract accepts 8,192 slots and rejects 8,193", async () => {
  const {
    RTX_MAX_INSTANCE_GROUP_CAPACITY,
    rtxInstanceGroupCapacity,
    rtxInstanceMatrices,
    rtxInstanceMasks,
  } = await import(`${adapterUrl.href}?instance-group-capacity-test`);

  assert.equal(COMMAND_MAX_CAPACITY, 8192);
  assert.equal(RTX_MAX_INSTANCE_GROUP_CAPACITY, COMMAND_MAX_CAPACITY);
  assert.equal(rtxInstanceGroupCapacity(8192), 8192);
  assert.throws(() => rtxInstanceGroupCapacity(8193), /\[1, 8192\]/);
  assert.throws(() => rtxInstanceGroupCapacity(1.5), /\[1, 8192\]/);

  const matrices = rtxInstanceMatrices(
    new Float32Array(RTX_MAX_INSTANCE_GROUP_CAPACITY * 12),
    RTX_MAX_INSTANCE_GROUP_CAPACITY,
  );
  const masks = rtxInstanceMasks(undefined, RTX_MAX_INSTANCE_GROUP_CAPACITY);
  assert.equal(matrices.length, RTX_MAX_INSTANCE_GROUP_CAPACITY * 12);
  assert.equal(masks.length, RTX_MAX_INSTANCE_GROUP_CAPACITY);
  assert.equal(masks[RTX_MAX_INSTANCE_GROUP_CAPACITY - 1], 0xff);

  assert.throws(
    () => rtxInstanceMatrices(
      new Float32Array(RTX_MAX_INSTANCE_GROUP_CAPACITY * 12 - 1),
      RTX_MAX_INSTANCE_GROUP_CAPACITY,
    ),
    /98304 floats/,
  );
  assert.throws(
    () => rtxInstanceMasks(
      new Uint32Array(RTX_MAX_INSTANCE_GROUP_CAPACITY - 1),
      RTX_MAX_INSTANCE_GROUP_CAPACITY,
    ),
    /exactly 8192/,
  );
});

test("RTX instance-group command payload is bounded at 8,192 slots", () => {
  const capacity = COMMAND_MAX_CAPACITY;
  const matrices = new Float32Array(capacity * 12);
  const masks = new Uint32Array(capacity);
  const commandBytes = 24 + capacity * (12 * 4 + 4);
  cmd.attach(new ArrayBuffer(commandBytes + 64));

  cmd.rtxSceneInstanceGroup({
    id: 9,
    capacity,
    vertexOffset: 0,
    vertexCount: 4,
    indexOffset: 0,
    indexCount: 6,
    primitiveBase: 0,
  });
  assert.equal(cmd.used(), 40);
  cmd.submitNow(true);

  cmd.rtxInstanceGroupUpdate(7, 9, matrices, masks);
  assert.equal(cmd.used(), commandBytes);
  cmd.submitNow(true);

  assert.throws(
    () => cmd.rtxSceneInstanceGroup({ id: 9, capacity: capacity + 1 }),
    /\[1, 8192\]/,
  );
  assert.throws(
    () => cmd.rtxInstanceGroupUpdate(
      7,
      9,
      new Float32Array((capacity + 1) * 12),
      new Uint32Array(capacity + 1),
    ),
    /\[1, 8192\]/,
  );
});

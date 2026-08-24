import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const addon = path.resolve(here, "../build/bin/three_browser_runtime.node");

test("native Canvas2D rasterizes generated textures without a window", {
  skip: fs.existsSync(addon) ? false : `native addon not built at ${addon}`,
}, async testContext => {
  const native = createRequire(import.meta.url)(addon);
  if (typeof native.canvas2dCreate !== "function") {
    testContext.skip("native addon predates the Canvas2D implementation");
    return;
  }
  process.env.THREEBROWSER_RUNTIME_ADDON = addon;
  await import(`${pathToFileURL(path.join(here, "browser-host.mjs")).href}?canvas2d-test`);

  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");

  const gradient = context.createLinearGradient(0, 0, 96, 0);
  gradient.addColorStop(0, "#301008");
  gradient.addColorStop(1, "hsl(24, 86%, 67%)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 96, 96);

  context.save();
  context.globalAlpha = 0.75;
  context.translate(48, 48);
  context.rotate(0.2);
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.beginPath();
  context.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.strokeStyle = "#101820";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(4, 80);
  context.bezierCurveTo(25, 45, 70, 90, 92, 58);
  context.stroke();

  context.font = "700 14px Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#00ff80";
  context.fillText("MARS 241", 5, 18);
  assert.ok(context.measureText("MARS 241").width > 20);

  const source = document.createElement("canvas");
  source.width = 8;
  source.height = 8;
  const sourceContext = source.getContext("2d");
  sourceContext.fillStyle = "rgb(10, 200, 30)";
  sourceContext.fillRect(0, 0, 8, 8);
  context.save();
  context.translate(24, 24);
  context.scale(2, 2);
  context.drawImage(source, 0, 0);
  context.restore();

  const marker = new ImageData(new Uint8ClampedArray([240, 10, 20, 255]), 1, 1);
  context.putImageData(marker, 95, 95);
  const image = context.getImageData(0, 0, 96, 96);
  const pixel = (x, y) => Array.from(image.data.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 4));
  assert.deepEqual(pixel(28, 28), [10, 200, 30, 255]);
  assert.deepEqual(pixel(95, 95), [240, 10, 20, 255]);
  assert.notDeepEqual(pixel(2, 40), pixel(90, 40));

  const flipSource = document.createElement("canvas");
  flipSource.width = 2;
  flipSource.height = 2;
  const flipSourceContext = flipSource.getContext("2d");
  flipSourceContext.fillStyle = "#ff0000";
  flipSourceContext.fillRect(0, 0, 2, 1);
  flipSourceContext.fillStyle = "#0000ff";
  flipSourceContext.fillRect(0, 1, 2, 1);
  const flipped = document.createElement("canvas");
  flipped.width = 2;
  flipped.height = 2;
  const flippedContext = flipped.getContext("2d");
  flippedContext.translate(0, 2);
  flippedContext.scale(1, -1);
  flippedContext.drawImage(flipSource, 0, 0);
  assert.deepEqual(Array.from(flippedContext.getImageData(0, 0, 1, 1).data), [0, 0, 255, 255]);
  assert.deepEqual(Array.from(flippedContext.getImageData(0, 1, 1, 1).data), [255, 0, 0, 255]);

  context.globalAlpha = 0.25;
  canvas.width = 96;
  assert.equal(context.globalAlpha, 1);
  assert.deepEqual(Array.from(context.getImageData(0, 0, 1, 1).data), [0, 0, 0, 0]);
  assert.match(canvas.toDataURL(), /^data:image\/png;base64,/);
});

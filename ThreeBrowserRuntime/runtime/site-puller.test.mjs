import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const puller = fileURLToPath(new URL("./site-puller.mjs", import.meta.url));

test("inline module references resolve from the document and rewrite from the extracted module", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/nested/index.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<script type="module">import { marker } from "./src/app.js"; globalThis.marker = marker;</script>');
      return;
    }
    if (request.url === "/nested/src/app.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end('export const marker = "localized";');
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threebrowser-site-puller-"));
  const destination = path.join(temporaryRoot, "pull");
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.equal(typeof address, "object");
    const source = `http://127.0.0.1:${address.port}/nested/index.html`;

    await execFileAsync(process.execPath, [puller, source, destination]);

    assert.ok(requests.includes("/nested/src/app.js"));
    assert.ok(!requests.includes("/nested/__inline__/src/app.js"));
    const manifest = JSON.parse(await readFile(path.join(destination, "threebrowser.pull.json"), "utf8"));
    assert.ok(manifest.files.some(file => file.url === `${new URL(source).origin}/nested/src/app.js`));
    const inline = await readFile(path.join(destination, "__inline__", "entry-1.mjs"), "utf8");
    assert.match(inline, /from "\.\.\/nested\/src\/app\.mjs"/);
    assert.equal(manifest.search, "");
    assert.deepEqual(manifest.searchParams, {});
    assert.equal(manifest.compatibility.minified, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("preserves the requested query string after a document redirect", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/?tile=nyc") {
      response.writeHead(302, { location: "/" });
      response.end();
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<script type="module">globalThis.ready = true;</script>');
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threebrowser-site-puller-"));
  const destination = path.join(temporaryRoot, "pull");
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.equal(typeof address, "object");
    const source = `http://127.0.0.1:${address.port}/?tile=nyc`;

    await execFileAsync(process.execPath, [puller, source, destination]);

    const manifest = JSON.parse(await readFile(path.join(destination, "threebrowser.pull.json"), "utf8"));
    assert.equal(manifest.source, source);
    assert.equal(manifest.search, "?tile=nyc");
    assert.deepEqual(manifest.searchParams, { tile: "nyc" });
    assert.equal(new URL(manifest.resolved).pathname, "/");
    assert.equal(new URL(manifest.resolved).search, "");
    const entry = await readFile(path.join(destination, "site-entry.mjs"), "utf8");
    assert.match(entry, /__threeBrowserSourceURL = "http:\/\/127\.0\.0\.1:\d+\/\?tile=nyc"/);
    assert.match(entry, /__threeBrowserSearch = "\?tile=nyc"/);
    assert.match(entry, /__threeBrowserSearchParams = \{"tile":"nyc"\}/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("records a minified production Three.js chunk in compatibility metadata", async () => {
  const minified = `${"const a=class{constructor(){this.isWebGLRenderer=!0}};const b=new a;".repeat(40)}`;
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<script type="module" src="./assets/index-CSHUrFCZ.js"></script>');
      return;
    }
    if (request.url === "/assets/index-CSHUrFCZ.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(minified);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threebrowser-site-puller-"));
  const destination = path.join(temporaryRoot, "pull");
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.equal(typeof address, "object");
    const source = `http://127.0.0.1:${address.port}/`;

    await execFileAsync(process.execPath, [puller, source, destination]);

    const manifest = JSON.parse(await readFile(path.join(destination, "threebrowser.pull.json"), "utf8"));
    assert.equal(manifest.compatibility.minified, true);
    assert.ok(manifest.compatibility.minifySignals.includes("mangled-three-constructors"));
    assert.ok(manifest.compatibility.minifySignals.includes("content-hashed-filename"));
    assert.ok(manifest.findings.some(finding => /Minified JavaScript detected/.test(finding)));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

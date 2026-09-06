import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const puller = fileURLToPath(new URL("./site-puller.mjs", import.meta.url));

test("optional beautification preserves module behaviour and shader strings", async () => {
  const source = 'export const shader=`void main(){gl_FragColor=vec4(1.);}`;export function compute(x){return {value:x+2,pattern:/a+b/.source}};';
  const server = createServer((request,response) => {
    response.writeHead(200,{"content-type":request.url === '/' ? 'text/html' : 'text/javascript'});
    response.end(request.url === '/' ? '<script type="module" src="/app.js"></script>' : source);
  });
  const temporaryRoot = await mkdtemp(path.join(tmpdir(),'threebrowser-beautify-'));
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const enabled of [false,true]) {
      const destination=path.join(temporaryRoot,String(enabled));
      await execFileAsync(process.execPath,[puller,url,...(enabled?['--beautify-js']:[]),destination]);
      const output=await readFile(path.join(destination,'app.mjs'),'utf8');
      const manifest=JSON.parse(await readFile(path.join(destination,'threebrowser.pull.json'),'utf8'));
      assert.equal(manifest.exportOptions.beautifyJavaScript,enabled);
      if(enabled){
        assert.ok(output.split('\n').length>3);
        assert.deepEqual(manifest.beautifiedFiles,['app.mjs','site-entry.mjs']);
      } else assert.equal(output,source);
      const module=await import(pathToFileURL(path.join(destination,'app.mjs')).href);
      assert.deepEqual(module.compute(3),{value:5,pattern:'a+b'});
      assert.equal(module.shader,'void main(){gl_FragColor=vec4(1.);}');
    }
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(temporaryRoot,{recursive:true,force:true});
  }
});

test("classic dynamic imports and glTF dependencies are usable offline", async () => {
  const server = createServer((request, response) => {
    const routes = {
      "/nested/": ["text/html", '<script>import("/assets/start.js")</script>'],
      "/assets/start.js": ["text/javascript", 'globalThis.offlineBootstrap = 42; const model = "/models/tree.gltf";'],
      "/models/tree.gltf": ["model/gltf+json", JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "tree.bin" }], images: [{ uri: "textures/leaf.png" }, { uri: "data:image/png;base64,AA==" }] })],
      "/models/tree.bin": ["application/octet-stream", "buffer"],
      "/models/textures/leaf.png": ["image/png", "pixels"],
    };
    const route = routes[request.url];
    response.writeHead(route ? 200 : 404, { "content-type": route?.[0] ?? "text/plain" });
    response.end(route?.[1] ?? "missing");
  });
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threebrowser-classic-import-"));
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    await execFileAsync(process.execPath, [puller, `http://127.0.0.1:${server.address().port}/nested/`, temporaryRoot]);
    const manifest = JSON.parse(await readFile(path.join(temporaryRoot, "threebrowser.pull.json"), "utf8"));
    assert.ok(manifest.files.some(file => file.path === "models/tree.bin"));
    assert.ok(manifest.files.some(file => file.path === "models/textures/leaf.png"));
    await new Promise(resolve => server.close(resolve));
    const entry = pathToFileURL(path.join(temporaryRoot, "site-entry.mjs")).href;
    await execFileAsync(process.execPath, ["--input-type=module", "-e", `globalThis.document={body:{children:[{}]}}; await import(${JSON.stringify(entry)}); await new Promise(r=>setTimeout(r,30)); if(globalThis.offlineBootstrap!==42) process.exit(1);`]);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("preserves structured HTML gates for runtime interaction hydration", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><body>
      <section id="login-gate" data-screen="login">
        <form><label for="email">Email address</label><input id="email" type="email" required>
        <button data-action="continue">Continue</button></form>
      </section><script>globalThis.siteLoaded = true;</script>
    </body>`);
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
    await execFileAsync(process.execPath, [puller, `http://127.0.0.1:${address.port}/`, destination]);

    const entry = await readFile(path.join(destination, "site-entry.mjs"), "utf8");
    assert.match(entry, /__threeBrowserHydrateDocument/);
    assert.match(entry, /Email address/);
    assert.match(entry, /data-screen=\\\"login\\\"/);
    assert.doesNotMatch(entry, /document\.createElement\("input"\)/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

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

test("preserves JSON module paths and import attributes", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<script type="module" src="./app.js"></script>');
      return;
    }
    if (request.url === "/app.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end('import config from "./config.json" with { type: "json" }; globalThis.config = config;');
      return;
    }
    if (request.url === "/config.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"enabled":true}');
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

    await execFileAsync(process.execPath, [puller, `http://127.0.0.1:${address.port}/`, destination]);

    const app = await readFile(path.join(destination, "app.mjs"), "utf8");
    assert.match(app, /from "\.\/config\.json" with \{ type: "json" \}/);
    assert.equal(await readFile(path.join(destination, "config.json"), "utf8"), '{"enabled":true}');
    const manifest = JSON.parse(await readFile(path.join(destination, "threebrowser.pull.json"), "utf8"));
    assert.ok(manifest.files.some(file => file.path === "config.json" && file.type === "json"));
    assert.ok(!manifest.files.some(file => file.path === "config.json.mjs"));
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

import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "acorn";
import { detectBundledRendererUsage, detectMinifiedJavaScript, relinkViteChunk } from "./vite-relinker.mjs";

function validModule(source) {
  parse(source, { ecmaVersion: "latest", sourceType: "module" });
}

test("relinks a mangled class declaration by its semantic renderer marker", () => {
  const input = "class a{constructor(){this.isWebGLRenderer=!0}render(){return 1}}const b=new a;";
  const result = relinkViteChunk(input, "vite-class.mjs");
  assert.equal(result.changed, true);
  assert.deepEqual(result.renderers, ["a"]);
  assert.deepEqual(result.types, ["WebGLRenderer"]);
  assert.match(result.source, /import \* as __TB_THREE from "three"/);
  assert.match(result.source, /const a=__TB_relink\("WebGLRenderer",class\{/);
  assert.match(result.source, /render\(\)\{return 1\}/);
  validModule(result.source);
});

test("relinks a renderer held in a minified function expression", () => {
  const input = "const x=function(){this.isWebGLRenderer=true;this.render=()=>0};new x;";
  const result = relinkViteChunk(input, "vite-function.mjs");
  assert.equal(result.changed, true);
  assert.match(result.source, /const x=__TB_relink\("WebGLRenderer",function/);
  validModule(result.source);
});

test("relinks the scene model spine together with the renderer", () => {
  const input = [
    "class a{constructor(){this.isObject3D=!0}}",
    "class b extends a{constructor(){super();this.isScene=!0}}",
    "class c extends a{constructor(){super();this.isMesh=!0}}",
    "class d{constructor(){this.isBufferGeometry=!0}}",
    "class e{constructor(){this.isMaterial=!0}}",
    "class f extends e{constructor(){super();this.isMeshStandardMaterial=!0}}",
    "class g{constructor(){this.isWebGLRenderer=!0}}",
    "export{b,c,d,f,g};",
  ].join("");
  const result = relinkViteChunk(input, "vite-model.mjs");
  assert.equal(result.changed, true);
  assert.deepEqual(new Set(result.types), new Set([
    "Object3D", "Scene", "Mesh", "BufferGeometry", "Material",
    "MeshStandardMaterial", "WebGLRenderer",
  ]));
  assert.match(result.source, /const b=__TB_relink\("Scene",class extends a/);
  assert.match(result.source, /const c=__TB_relink\("Mesh",class extends a/);
  assert.match(result.source, /const f=__TB_relink\("MeshStandardMaterial",class extends e/);
  validModule(result.source);
});

test("preserves custom subclasses that reuse a core semantic marker", () => {
  const input = [
    "class Mesh{constructor(){this.isMesh=!0}}",
    "class InstancedMesh extends Mesh{}",
    "class SkinnedMesh extends Mesh{constructor(){super();this.isSkinnedMesh=!0}}",
    "class CharacterMesh extends InstancedMesh{constructor(actions){super();this.isSkinnedMesh=!0;this.actions=actions}}",
    "class Renderer{constructor(){this.isWebGLRenderer=!0}}",
    "export{CharacterMesh,Renderer};",
  ].join("");
  const result = relinkViteChunk(input, "vite-custom-subclass.mjs");
  assert.equal(result.changed, true);
  assert.match(result.source, /const SkinnedMesh=__TB_relink\("SkinnedMesh"/);
  assert.doesNotMatch(result.source, /const CharacterMesh=__TB_relink/);
  assert.match(result.source, /class CharacterMesh extends InstancedMesh/);
  validModule(result.source);
});

test("relinks core InstancedMesh so instance transforms cross the native boundary", () => {
  const input = [
    "class Mesh{constructor(){this.isMesh=!0}}",
    "class InstancedMesh extends Mesh{constructor(count){super();this.isInstancedMesh=!0;this.count=count}}",
    "class Renderer{constructor(){this.isWebGLRenderer=!0}}",
    "export{InstancedMesh,Renderer};",
  ].join("");
  const result = relinkViteChunk(input, "vite-instanced.mjs");
  assert.equal(result.changed, true);
  assert.match(result.source, /const InstancedMesh=__TB_relink\("InstancedMesh",class extends Mesh/);
  assert.ok(result.types.includes("InstancedMesh"));
  validModule(result.source);
});

test("leaves unrelated Vite chunks untouched", () => {
  const input = "const renderer={isWebGLRenderer:false};export default renderer;";
  const result = relinkViteChunk(input, "unrelated.mjs");
  assert.equal(result.changed, false);
  assert.equal(result.source, input);
});

test("detects a constructed minified WebGPU renderer by its semantic marker", () => {
  const input = [
    "class uj{constructor(){this.isWebGPURenderer=!0}}",
    "const renderer=new uj({antialias:true});",
  ].join("");
  assert.deepEqual(detectBundledRendererUsage(input), {
    hasWebGL: false,
    hasWebGPU: true,
    usesWebGL: false,
    usesWebGPU: true,
  });
});

test("detects a long single-line production chunk as minified", () => {
  const input = `export default {${"k:1,".repeat(200)}}`;
  const result = detectMinifiedJavaScript(input, "chunk.js");
  assert.equal(result.minified, true);
  assert.ok(result.signals.includes("dense-lines"));
});

test("detects a dense Vite production chunk as minified", () => {
  const input = `${"const a=class{constructor(){this.isWebGLRenderer=!0}};const b=new a;".repeat(40)}`;
  const result = detectMinifiedJavaScript(input, "assets/index-CSHUrFCZ.js");
  assert.equal(result.minified, true);
  assert.ok(result.signals.includes("mangled-three-constructors"));
  assert.ok(result.signals.includes("content-hashed-filename"));
});

test("does not treat a pretty Three.js module as minified because one shader line is long", () => {
  const input = [
    "import { WebGLRenderer } from \"three\";",
    "export function createRenderer() {",
    "  return new WebGLRenderer({ antialias: true });",
    "}",
    `const fragment = \`${"a".repeat(600)}\`;`,
    ...Array.from({ length: 24 }, (_, index) => `export const n${index} = ${index};`),
    "",
  ].join("\n");
  const result = detectMinifiedJavaScript(input, "src/main.mjs");
  assert.equal(result.minified, false);
  assert.ok(result.signals.includes("long-lines"));
  assert.ok(!result.signals.includes("mangled-three-constructors"));
});

test("does not treat an unused bundled renderer definition as application usage", () => {
  const input = "const Renderer=class{constructor(){this.isWebGPURenderer=true}};export{Renderer};";
  assert.deepEqual(detectBundledRendererUsage(input), {
    hasWebGL: false,
    hasWebGPU: true,
    usesWebGL: false,
    usesWebGPU: false,
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "acorn";
import { relinkViteChunk } from "./vite-relinker.mjs";

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
  assert.match(result.source, /const a=__TB_THREE\.WebGLRenderer;/);
  assert.doesNotMatch(result.source, /render\(\)\{return 1\}/);
  validModule(result.source);
});

test("relinks a renderer held in a minified function expression", () => {
  const input = "const x=function(){this.isWebGLRenderer=true;this.render=()=>0};new x;";
  const result = relinkViteChunk(input, "vite-function.mjs");
  assert.equal(result.changed, true);
  assert.match(result.source, /const x=__TB_THREE\.WebGLRenderer/);
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
  assert.match(result.source, /const b=__TB_THREE\.Scene;/);
  assert.match(result.source, /const c=__TB_THREE\.Mesh;/);
  assert.match(result.source, /const f=__TB_THREE\.MeshStandardMaterial;/);
  validModule(result.source);
});

test("leaves unrelated Vite chunks untouched", () => {
  const input = "const renderer={isWebGLRenderer:false};export default renderer;";
  const result = relinkViteChunk(input, "unrelated.mjs");
  assert.equal(result.changed, false);
  assert.equal(result.source, input);
});

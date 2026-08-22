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
  assert.match(result.source, /import \{ WebGLRenderer as __TB_WebGLRenderer \} from "three"/);
  assert.match(result.source, /const a=__TB_WebGLRenderer;/);
  assert.doesNotMatch(result.source, /render\(\)\{return 1\}/);
  validModule(result.source);
});

test("relinks a renderer held in a minified function expression", () => {
  const input = "const x=function(){this.isWebGLRenderer=true;this.render=()=>0};new x;";
  const result = relinkViteChunk(input, "vite-function.mjs");
  assert.equal(result.changed, true);
  assert.match(result.source, /const x=__TB_WebGLRenderer/);
  validModule(result.source);
});

test("leaves unrelated Vite chunks untouched", () => {
  const input = "const renderer={isWebGLRenderer:false};export default renderer;";
  const result = relinkViteChunk(input, "unrelated.mjs");
  assert.equal(result.changed, false);
  assert.equal(result.source, input);
});

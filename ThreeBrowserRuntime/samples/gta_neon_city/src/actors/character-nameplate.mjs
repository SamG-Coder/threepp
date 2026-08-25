import * as THREE from "three/webgpu";

const GLYPHS = Object.freeze({
  A: ["01110", "10001", "11111", "10001", "10001"],
  D: ["11110", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "11111"],
  H: ["10001", "10001", "11111", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "10010", "01100"],
  L: ["10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "11110", "10100", "10010"],
  U: ["10001", "10001", "10001", "10001", "01110"],
});

export function createCharacterNameplate(parent, label, {
  color = 0xffd46c,
  y = 2.65,
  geometries = null,
  materials = null,
  objectName = null,
} = {}) {
  const text = String(label ?? "").trim().toUpperCase();
  const patterns = [...text].map(letter => GLYPHS[letter]).filter(Boolean);
  if (!parent || !patterns.length) return null;
  const cells = patterns.reduce((total, pattern) =>
    total + pattern.join("").split("").filter(value => value === "1").length, 0);
  const geometry = new THREE.BoxGeometry(0.055, 0.055, 0.018);
  const material = new THREE.MeshBasicNodeMaterial({ color, depthWrite: false });
  geometries?.push?.(geometry);
  materials?.push?.(material);
  const tag = new THREE.InstancedMesh(geometry, material, cells);
  tag.name = objectName ?? `${text} floating character name tag`;
  const width = patterns.length * 6 - 1;
  const matrix = new THREE.Matrix4();
  let cell = 0;
  for (let letter = 0; letter < patterns.length; ++letter) {
    for (let row = 0; row < 5; ++row) {
      for (let column = 0; column < 5; ++column) {
        if (patterns[letter][row][column] !== "1") continue;
        matrix.makeTranslation((letter * 6 + column - (width - 1) * 0.5) * 0.062, (4 - row) * 0.062, 0);
        tag.setMatrixAt(cell++, matrix);
      }
    }
  }
  tag.position.y = y;
  tag.frustumCulled = false;
  parent.add(tag);
  return tag;
}

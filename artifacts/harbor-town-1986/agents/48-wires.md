```js
function addOverheadWires(scene) {
  const y = 8.5;
  const sag = 0.4;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.94, metalness: 0 });
  const geo = new THREE.CylinderGeometry(0.02, 0.02, 1, 5);

  function poleXs(onCurb) {
    const xs = [];
    for (const row of INSTANCES) {
      if (row.asset === "telephone-pole" && onCurb(row.z)) xs.push(row.x);
    }
    for (const row of ORBIT_SUBJECTS) {
      if (row.id === "telephone-pole" && onCurb(row.z)) xs.push(row.x);
    }
    xs.sort((a, b) => a - b);
    return xs;
  }

  function addSeg(x0, y0, x1, y1, z) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "overhead wire";
    mesh.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, z);
    mesh.scale.set(1, len, 1);
    mesh.rotation.z = Math.atan2(x0 - x1, y1 - y0);
    scene.add(mesh);
  }

  function stringCurb(xs, z) {
    for (let i = 1; i < xs.length; i++) {
      const x0 = xs[i - 1];
      const x1 = xs[i];
      let px = x0;
      let py = y;
      for (let s = 1; s <= 3; s++) {
        const t = s / 3;
        const x = x0 + (x1 - x0) * t;
        const yy = y - sag * 4 * t * (1 - t);
        addSeg(px, py, x, yy, z);
        px = x;
        py = yy;
      }
    }
  }

  stringCurb(poleXs(z => z < 0), -6.4);
  stringCurb(poleXs(z => z > 4 && z < 8), 6.4);
}
```

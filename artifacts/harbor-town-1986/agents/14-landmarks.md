# Scout LANDMARKS — street-distance cameras

Drop-in for `scout.mjs`. Do not stand on shop origins: 55° vFOV at ~10 m fills a 7 m facade (see `sakae-north.png`).

Convention: +X east, +Z south. `yaw = 0` looks +Z (south). `yaw = Math.PI` looks −Z (north).
Look ray: `(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch))`. Eye y is ground + 1.62 unless set.

North-row shops (yaw 0, fronts face south) sit at z = −8.5. Footprint is ~realWidth on XZ, so south facades are about z = −5. Florist at (−6, 8.6), yaw π, north face about z = 5.3 — it sits directly south of Yaoya, so `produce` is a SW angle, not due south.

```js
export const LANDMARKS = Object.freeze({
  // Suzume-zaka path: timber house to the right, stone stairs and Sakae-dori downhill ahead.
  spawn: { x: -22, z: -28, yaw: 0.58, pitch: -0.12 },
  // Park grass above the house, looking south-east down onto the shopping street.
  hill: { x: -22, z: -32, yaw: 0.42, pitch: -0.14 },
  // 17 m from the Suzume-zaka house, path in the foreground, tiled roof and genkan readable.
  house: { x: -17.5, z: -19.5, yaw: -2.51, pitch: 0.12 },
  // Same hill, turned away from the house: Sakae-dori then Amihama warehouses and water.
  town: { x: -20, z: -36, yaw: 0.54, pitch: -0.14 },
  // Top of the stone stairs, looking down onto west Sakae (tobacco / soba).
  stairs: { x: -18, z: -14, yaw: 0.18, pitch: -0.18 },
  // West mouth of Sakae-dori looking east: tobacco then soba, produce, arcade, records receding on the left.
  "street-east": { x: -38, z: 1.8, yaw: Math.PI / 2 + 0.16, pitch: -0.08 },
  // Pulled south of the florist (~23 m from the north row): soba, Yaoya, arcade, records as four fronts, van on the asphalt.
  sakae: { x: 6, z: 14.5, yaw: Math.PI + 0.12, pitch: -0.06 },
  // ~16 m from Kamimura's south facade, slight 3/4, pole to the right, hill behind the roof.
  tobacco: { x: -20, z: 10.5, yaw: Math.PI + 0.26, pitch: 0.02 },
  // Across the street from Nishiya, full noren and two floors, florist out of frame to the east.
  soba: { x: -14, z: 10.5, yaw: Math.PI, pitch: 0.02 },
  // SW of Yaoya (~18 m): greengrocer front with crates, Nishiya neighbour on the left, florist not covering the facade.
  produce: { x: -15, z: 8.5, yaw: Math.PI - 0.57, pitch: 0.02 },
  // ~17 m 3/4 on Starlight Arcade: Space Invader sign and tiled side, van left on the street, records further right.
  arcade: { x: 14, z: 11.5, yaw: Math.PI + 0.29, pitch: 0.02 },
  // ~16 m 3/4 on Minato-machi records, crate bins and OPEN neon, alley mouth to the right.
  records: { x: 16, z: 11, yaw: Math.PI - 0.20, pitch: 0.02 },
  // East mouth of Sakae-dori looking west: records then arcade, produce, soba, tobacco receding on the right.
  "street-west": { x: 30, z: 2.0, yaw: -Math.PI / 2 - 0.16, pitch: -0.08 },
  // 5 m SE 3/4 of the Carry: front chrome and passenger side, north-row shops behind.
  van: { x: 7.8, z: 7.2, yaw: -2.33, pitch: -0.05 },
  // North sidewalk looking south at Midori's north facade (awning, 花屋 sign), street asphalt in the foreground.
  flower: { x: -8, z: -2.2, yaw: 0.18, pitch: 0.04 },
  // 3/4 of the green NTT booth from the south sidewalk, arcade in the distance.
  booth: { x: 5.4, z: 8.6, yaw: -2.25, pitch: 0.04 },
  // SE end of Yokobori cobbles, 3/4 on Galaxy sakaba (noren + vertical 銀河酒場), alley walls either side.
  bar: { x: 34, z: 27, yaw: Math.PI + 0.68, pitch: -0.05 },
  // Harbor gate looking south: Warehouse 8 left, Warehouse 3 right, quay and water beyond.
  harbor: { x: 0, z: 46, yaw: 0.08, pitch: -0.02 },
  // ~17 m 3/4 of Warehouse 8's north doors (倉42), dock concrete in the foreground.
  warehouse: { x: 4, z: 54, yaw: -0.73, pitch: 0.00 },
  // On the quay looking east along bollards: water to the right, warehouse roofs to the left.
  quay: { x: -16, z: 84.5, yaw: Math.PI * 0.5, pitch: -0.08 },
});
```

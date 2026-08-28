/** Convert the serialisable NSW-map location profile into path.mjs curves. */
export function runtimePathProfile(location) {
  const profile = location?.pathProfile;
  if (!profile || !Array.isArray(profile.knots)) {
    throw new TypeError("A game location needs a serialisable path profile.");
  }
  return Object.freeze({
    id: profile.id,
    shoreKnots: profile.knots.map(knot => [knot.x, knot.shoreZ]),
    roadKnots: profile.knots.map(knot => [knot.x, knot.roadCenterZ]),
    bankHeightKnots: profile.knots.map(knot => [knot.x, knot.bankHeight]),
    pathMinZ: profile.playableZ[0],
    pathMaxZ: profile.playableZ[1],
    shoreDetail: location.id.includes("first-branch") ? 0.52 : 0.28,
    shoreFrequency: location.id.includes("first-branch") ? 0.15 : 0.09,
    noiseOffset: (profile.seed % 997) / 997,
    inlandSlope: location.id.includes("first-branch") ? 0.068 : 0.036,
    farBankZ: location.id.includes("first-branch") ? 42 : 49,
  });
}

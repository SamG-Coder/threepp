export function meshExtents(mesh) {
  const positions = mesh?.positions;
  if (!positions || positions.length < 3) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, width: 0, height: 0, depth: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const widthX = maxX - minX;
  const depthZ = maxZ - minZ;
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    width: Math.max(widthX, depthZ),
    depth: Math.min(widthX, depthZ),
    height: maxY - minY,
  };
}

/**
 * Uniform-per-axis scale so the reconstructed mesh matches real-world
 * height (Y) and width/diameter (XZ) in metres.
 */
export function realWorldScale(mesh, subject) {
  const extents = meshExtents(mesh);
  const realHeight = Number(subject?.realHeight) || 1;
  const realWidth = Number(subject?.realWidth) || realHeight;
  const sy = realHeight / Math.max(1e-6, extents.height);
  const sxz = realWidth / Math.max(1e-6, extents.width);
  return {
    x: sxz,
    y: sy,
    z: sxz,
    extents,
    realHeight,
    realWidth,
  };
}

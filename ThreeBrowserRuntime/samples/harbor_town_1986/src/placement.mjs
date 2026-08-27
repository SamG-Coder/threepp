/** Pure footprint support calculations shared by static and moving 2D-derived assets. */

export function footprintSupport(pose, subject, heightAt) {
  const height = typeof heightAt === "function" ? heightAt : () => 0;
  const x = Number(pose?.x) || 0;
  const z = Number(pose?.z) || 0;
  const width = Number(subject?.realWidth);
  const depth = Number(subject?.realDepth);
  const yaw = Number(pose?.yaw) || 0;
  const samples = [];

  function sample(px, pz) {
    const value = Number(height(px, pz));
    if (Number.isFinite(value)) samples.push({ x: px, z: pz, y: value });
  }

  sample(x, z);
  if (width > 0 && depth > 0) {
    const hx = width * 0.5;
    const hz = depth * 0.5;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const lx of [-hx, hx]) {
      for (const lz of [-hz, hz]) {
        sample(x + lx * c + lz * s, z - lx * s + lz * c);
      }
    }
  }

  if (!samples.length) samples.push({ x, z, y: 0 });
  const ys = samples.map(point => point.y);
  return {
    min: Math.min(...ys),
    max: Math.max(...ys),
    center: samples[0].y,
    samples,
  };
}

/**
 * Keep a rigid reconstructed asset above every sampled terrain corner.
 * A caller-supplied pose.y is authoritative for waterborne/flying assets.
 */
export function footprintSeatY(pose, subject, heightAt) {
  const explicit = Number(pose?.y);
  if (Number.isFinite(explicit)) return explicit;
  return footprintSupport(pose, subject, heightAt).max;
}

import { DEFAULT_ORBIT_FRAME_LIMITS } from "../../texture_2ds_to_3ds/src/silhouette.mjs";

export const ORBIT_FRAME_LIMITS = DEFAULT_ORBIT_FRAME_LIMITS;

export const RECONSTRUCTION_LIMITS = Object.freeze({
  triangles: 200,
  filled: 96,
  meanIoU: 0.32,
  minIoU: 0.05,
});

export function assessReconstruction(report, limits = RECONSTRUCTION_LIMITS) {
  const reasons = [];
  if (report?.frame && report.frame.ok === false) {
    for (const reason of report.frame.reasons ?? []) reasons.push(`frame ${reason}`);
  }
  if (!(Number(report?.triangles) >= limits.triangles)) reasons.push(`triangles ${report?.triangles ?? 0}`);
  if (!(Number(report?.filled) >= limits.filled)) reasons.push(`filled ${report?.filled ?? 0}`);
  if (!(Number(report?.meanIoU) >= limits.meanIoU)) {
    reasons.push(`meanIoU ${Number(report?.meanIoU || 0).toFixed(3)}`);
  }
  if (!(Number(report?.minIoU) >= limits.minIoU)) {
    reasons.push(`minIoU ${Number(report?.minIoU || 0).toFixed(3)}`);
  }
  return Object.freeze({ ok: reasons.length === 0, reasons: Object.freeze(reasons) });
}

import { CARDINAL_VIEWS, CYLINDER_VIEWS, HUMANOID_VIEWS } from "./catalog.mjs";
import { ORBIT_FRAME_LIMITS } from "./asset-quality.mjs";

export function orbitCatalogFor(subject) {
  // View count is an image-source contract, independent from the visual-hull
  // shape. Grok supplies four cardinal stills for every reusable module,
  // including custom wheels, bodywork, and gabled roof slices.
  if (subject.viewSet === "cardinal") return CARDINAL_VIEWS;
  if (subject.kind === "cylinder") return CYLINDER_VIEWS;
  if (subject.kind === "humanoid" || subject.kind === "custom") return HUMANOID_VIEWS;
  return CARDINAL_VIEWS;
}

export function reconstructionOptionsFor(subject, assetRoot) {
  const catalog = orbitCatalogFor(subject);
  let resolution = 64;
  let silhouetteSize = 128;
  if (subject.kind === "custom" || subject.kind === "humanoid") {
    resolution = 64;
    silhouetteSize = 128;
  } else if (subject.id === "phone-booth" || subject.kind === "cylinder") {
    resolution = 32;
    silhouetteSize = 64;
  }
  return {
    assetRoot,
    folder: subject.folder,
    catalog,
    resolution,
    silhouetteSize,
    mapSize: 128,
    // Harbor projects the keyed Grok stills directly onto seam-split triangles;
    // skip the lower-detail shared voxel-map bake that would be discarded.
    bakeMaps: false,
    forceCount: catalog.length,
    frameLimits: ORBIT_FRAME_LIMITS,
    rejectFrameIssues: true,
    photoIterations: subject.kind === "rectangle" || subject.kind === "square" ? 0 : 4,
    smoothIterations:
      subject.kind === "rectangle" || subject.kind === "square"
        ? 2
        : subject.kind === "humanoid"
          ? 4
          : 5,
    smoothLambda:
      subject.kind === "rectangle" || subject.kind === "square"
        ? 0.26
        : subject.kind === "humanoid"
          ? 0.32
          : 0.36,
    shape: {
      kind: subject.kind,
      generic: subject.kind !== "custom" && subject.kind !== "humanoid",
      recommendedCount: catalog.length,
    },
  };
}

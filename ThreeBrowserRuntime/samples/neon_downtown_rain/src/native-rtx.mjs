import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "../../webgpu_rtx_light_transport_observatory/src/native-reflections.mjs";

export { prepareReflectionGuideMaterials };

function renderDimension(value) {
  const dimension = Math.trunc(Number(value));
  return Number.isFinite(dimension) && dimension > 0 ? dimension : 1;
}

/**
 * Native reflection presentation for the all-2D downtown.
 *
 * The shared observatory renderer normally treats an available DLSS-SR bridge
 * as permission to configure the complete adaptive SR/RR/FG presentation path.
 * This sample explicitly requests those features off: its image-card motion
 * has no reliable per-texel motion vectors, and the normal full-resolution
 * native reflection output is the truthful path. Returning a disabled adaptive
 * configuration prevents configure() and resize() from re-enabling Streamline
 * while retaining the generic renderer's native reflection and raster fallback.
 */
export class DowntownReflectionRenderer extends NativeReflectionRenderer {
  _adaptiveSettings(outputWidth, outputHeight) {
    return {
      options: null,
      width: renderDimension(outputWidth),
      height: renderDimension(outputHeight),
      enabled: false,
    };
  }
}

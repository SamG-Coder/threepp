import * as THREE from "three/webgpu";
import { buildMegacity } from "./city.mjs";
import { createAerialTraffic } from "./traffic.mjs";
import { createMegacityAtmosphere } from "./atmosphere.mjs";
import { createMegacityMicroDetail } from "./microdetail.mjs";

/**
 * Composes the independent JS-authored city systems behind one intentionally
 * small main-loop API. The static RTX roots remain immutable after creation;
 * aircraft movement is supplied through the generic bridge's instance-group
 * contract and all translucent atmosphere stays raster-only.
 */
export function buildMegacityOverlook(scene, camera, materials) {
  const city = buildMegacity(scene, materials);
  const traffic = createAerialTraffic({ THREE, scene });
  const atmosphere = createMegacityAtmosphere({ THREE, scene, camera });
  const microdetail = createMegacityMicroDetail({ THREE, scene, materials });

  let trafficEnabled = true;
  let fogEnabled = true;

  function update(elapsed, delta) {
    city.update(elapsed, delta);
    traffic.update(elapsed, delta);
    atmosphere.update(elapsed, delta);
    microdetail.update(elapsed);
  }

  function setNativeMode(enabled) {
    city.setNativeMode(enabled);
  }

  function setTrafficEnabled(enabled) {
    trafficEnabled = Boolean(enabled);
    traffic.setEnabled(trafficEnabled);
  }

  function setFogEnabled(enabled) {
    fogEnabled = Boolean(enabled);
    atmosphere.setEnabled(fogEnabled);
  }

  function rayTracingInstanceUpdates() {
    // The traffic descriptors deliberately carry both their immutable BLAS
    // streams and the mutable fixed-capacity matrices/masks. Reusing the same
    // arrays avoids allocation and is the generic bridge's update contract.
    if (Array.isArray(traffic.instanceGroups) && traffic.instanceGroups.length > 0) {
      return traffic.instanceGroups;
    }
    if (typeof traffic.rayTracingInstanceUpdate === "function") {
      const updateValue = traffic.rayTracingInstanceUpdate();
      return updateValue ? [updateValue] : [];
    }
    if (typeof traffic.getInstanceUpdates === "function") {
      return traffic.getInstanceUpdates() ?? [];
    }
    const groups = traffic.instanceGroups ?? [];
    return groups
      .map(group => group?.update ?? group?.instanceUpdate ?? null)
      .filter(Boolean);
  }

  function dispose() {
    atmosphere.dispose();
    traffic.dispose();
    microdetail.dispose();
    city.dispose();
  }

  return {
    city,
    traffic,
    atmosphere,
    microdetail,
    staticRoots: city.staticRoots,
    staticLights: city.staticLights,
    instanceGroups: traffic.instanceGroups ?? [],
    stormLight: city.stormLight,
    stats: {
      city: city.stats,
      traffic: traffic.stats,
      atmosphere: atmosphere.stats,
      microdetail: microdetail.stats,
    },
    update,
    setNativeMode,
    setTrafficEnabled,
    setFogEnabled,
    rayTracingInstanceUpdates,
    dispose,
  };
}

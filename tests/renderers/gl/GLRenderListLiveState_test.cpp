#include "threepp/core/BufferGeometry.hpp"
#include "threepp/materials/MeshBasicMaterial.hpp"
#include "threepp/materials/MeshPhysicalMaterial.hpp"
#include "threepp/renderers/gl/GLRenderLists.hpp"

#include <stdexcept>

using namespace threepp;

int main() {
    gl::GLProperties properties;
    gl::GLRenderList cached(properties);
    RenderList generic;
    Object3D object;
    BufferGeometry geometry;
    auto physical = MeshPhysicalMaterial::create();
    auto basic = MeshBasicMaterial::create();
    const auto require = [](bool condition) {
        if (!condition) throw std::runtime_error("Render-list live material classification failed");
    };
    // Check the optimized GL resolver against the generic implementation.
    // Rebuild the lists as for consecutive passes, without needsUpdate calls.
    for (unsigned pass = 0; pass < 100; ++pass) {
        physical->transmission = pass % 3 == 1 ? .5f : 0.f;
        physical->transparent = pass % 3 == 2;
        basic->transparent = (pass % 2) != 0;
        cached.init(); generic.init();
        for (auto* list : {static_cast<RenderList*>(&cached), &generic}) {
            for (unsigned i = 0; i < 32; ++i)
                list->push(&object, &geometry, physical.get(), 0, float(i), std::nullopt);
            list->push(&object, &geometry, basic.get(), 0, 0, std::nullopt);
        }
        require(cached.opaque.size() == generic.opaque.size());
        require(cached.transparent.size() == generic.transparent.size());
        require(cached.transmissive.size() == generic.transmissive.size());
        require(cached.transmissive.size() == (physical->transmission > 0 ? 32u : 0u));
        // A second change in the same pass must also be observed immediately.
        physical->transmission = .8f;
        const auto previousTransmissive = cached.transmissive.size();
        cached.push(&object, &geometry, physical.get(), 0, 0, std::nullopt);
        require(cached.transmissive.size() == previousTransmissive + 1);
        require(cached.transmissive.front()->material == physical.get());
        // Renderer material disposal erases this entry. Recreating the cache
        // on the following pass must not change classification.
        if (pass % 7 == 0) properties.materialProperties.remove(physical.get());
    }
}

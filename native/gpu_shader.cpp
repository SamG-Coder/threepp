#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/materials/ShaderMaterial.hpp"

#include <string>

using namespace tn;

uint32_t tn_shader_material_create(const char* vertex_src, const char* fragment_src) {
    try {
        std::string vertex = vertex_src ? vertex_src : "";
        std::string fragment = fragment_src ? fragment_src : "";
        return onWorker([vertex, fragment] {
            auto mat = ShaderMaterial::create();
            if (!vertex.empty()) {
                mat->vertexShader = vertex;
            }
            if (!fragment.empty()) {
                mat->fragmentShader = fragment;
            }
            Slot slot;
            slot.kind = Kind::Material;
            slot.material = mat;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

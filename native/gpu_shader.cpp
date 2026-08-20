#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/materials/ShaderMaterial.hpp"

#include <string>
#include <utility>

using namespace tn;

namespace {

void setShaderUniform(uint32_t material, const char* name, UniformValue value) {
    std::string key = name ? name : "";
    onWorker([material, key = std::move(key), value = std::move(value)]() mutable {
        Slot* slot = getSlot(material);
        if (!slot || !slot->material || key.empty()) {
            return;
        }
        auto* sm = slot->material->as<ShaderMaterial>();
        if (!sm) {
            return;
        }
        sm->uniforms[key].setValue(std::move(value));
        sm->uniformsNeedUpdate = true;
        markDirty();
    });
}

}// namespace

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

void tn_shader_uniform_float(uint32_t material, const char* name, float v) {
    try {
        setShaderUniform(material, name, v);
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_shader_uniform_vec2(uint32_t material, const char* name, float x, float y) {
    try {
        setShaderUniform(material, name, Vector2(x, y));
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_shader_uniform_vec3(uint32_t material, const char* name, float x, float y, float z) {
    try {
        setShaderUniform(material, name, Vector3(x, y, z));
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_shader_uniform_vec4(uint32_t material, const char* name, float x, float y, float z, float w) {
    try {
        setShaderUniform(material, name, Vector4(x, y, z, w));
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_shader_set_flags(uint32_t material, int side, int depth_write) {
    try {
        onWorker([material, side, depth_write] {
            Slot* slot = getSlot(material);
            if (!slot || !slot->material) {
                return;
            }
            slot->material->side = side <= 0 ? Side::Front : side == 1 ? Side::Back
                                                                      : Side::Double;
            slot->material->depthWrite = depth_write != 0;
            slot->material->needsUpdate();
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

#include "three_native.h"
#include "runtime_internal.hpp"

#include <array>

using namespace tn;

int tn_instanced_set_matrix_at(uint32_t mesh, int index, const float* elements16) {
    try {
        if (!elements16 || index < 0) {
            setError("instanced setMatrixAt needs 16 floats");
            return 0;
        }
        std::array<float, 16> e{};
        for (int i = 0; i < 16; i++) e[i] = elements16[i];
        return onWorker([mesh, index, e] {
            Slot* slot = getSlot(mesh);
            if (!slot || !slot->object) {
                setError("instanced setMatrixAt needs a mesh");
                return 0;
            }
            auto inst = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!inst) {
                setError("handle is not InstancedMesh");
                return 0;
            }
            Matrix4 m;
            m.fromArray(e);
            inst->setMatrixAt(static_cast<size_t>(index), m);
            inst->instanceMatrix()->needsUpdate();
            markDirty();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_instanced_set_color_at(uint32_t mesh, int index, uint32_t hex) {
    try {
        if (index < 0) {
            setError("instanced setColorAt needs a valid index");
            return 0;
        }
        return onWorker([mesh, index, hex] {
            Slot* slot = getSlot(mesh);
            if (!slot || !slot->object) {
                setError("instanced setColorAt needs a mesh");
                return 0;
            }
            auto inst = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!inst) {
                setError("handle is not InstancedMesh");
                return 0;
            }
            inst->setColorAt(static_cast<size_t>(index), Color(hex));
            if (auto* instanceColor = inst->instanceColor()) {
                instanceColor->needsUpdate();
            }
            markDirty();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

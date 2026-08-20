#include "three_native.h"
#include "runtime_internal.hpp"
#include "threepp/helpers/BoxHelper.hpp"

#include <algorithm>

using namespace tn;

uint32_t tn_axes_helper_create(float size) {
    try {
        return onWorker([size] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = AxesHelper::create(size);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_grid_helper_create(float size, int divisions, uint32_t color1, uint32_t color2) {
    try {
        return onWorker([size, divisions, color1, color2] {
            auto s = static_cast<unsigned int>(std::max(1.f, size));
            auto d = static_cast<unsigned int>(std::max(1, divisions));
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = GridHelper::create(s, d, Color(color1), Color(color2));
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_box_helper_create(uint32_t object) {
    try {
        return onWorker([object] {
            Object3D* obj = asObject(object);
            if (!obj) {
                setError("box helper needs a scene object");
                return 0u;
            }
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = BoxHelper::create(*obj);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_arrow_helper_create(float dx, float dy, float dz, float length, uint32_t color) {
    try {
        return onWorker([dx, dy, dz, length, color] {
            Vector3 dir(dx, dy, dz);
            if (dir.lengthSq() < 1e-12f) {
                dir = Vector3(0, 0, 1);
            }
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = ArrowHelper::create(dir, Vector3(0, 0, 0), length, Color(color));
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

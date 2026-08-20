#include "three_native.h"
#include "runtime_internal.hpp"

using namespace tn;

uint32_t tn_points_material_create(uint32_t color, float size) {
    try {
        return onWorker([color, size] {
            auto material = PointsMaterial::create(
                    PointsMaterial::Params{}.color(Color(color)).size(size));
            Slot slot;
            slot.kind = Kind::Material;
            slot.material = material;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_points_create(uint32_t geometry, uint32_t material) {
    try {
        return onWorker([geometry, material] {
            Slot* geo = getSlot(geometry);
            Slot* mat = getSlot(material);
            if (!geo || geo->kind != Kind::Geometry || !geo->geometry) {
                setError("points needs a geometry");
                return 0u;
            }
            if (!mat || mat->kind != Kind::Material || !mat->material) {
                setError("points needs a material");
                return 0u;
            }
            auto points = Points::create(geo->geometry, mat->material);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = points;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

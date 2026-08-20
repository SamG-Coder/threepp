#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/objects/Line.hpp"
#include "threepp/objects/LineLoop.hpp"
#include "threepp/objects/LineSegments.hpp"

using namespace tn;

uint32_t tn_line_create(uint32_t geometryHandle, uint32_t materialHandle) {
    try {
        return onWorker([geometryHandle, materialHandle] {
            Slot* geo = getSlot(geometryHandle);
            Slot* mat = getSlot(materialHandle);
            if (!geo || geo->kind != Kind::Geometry || !geo->geometry) {
                setError("line needs a geometry");
                return 0u;
            }
            if (!mat || mat->kind != Kind::Material || !mat->material) {
                setError("line needs a material");
                return 0u;
            }
            auto line = Line::create(geo->geometry, mat->material);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = line;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_line_segments_create(uint32_t geometryHandle, uint32_t materialHandle) {
    try {
        return onWorker([geometryHandle, materialHandle] {
            Slot* geo = getSlot(geometryHandle);
            Slot* mat = getSlot(materialHandle);
            if (!geo || geo->kind != Kind::Geometry || !geo->geometry) {
                setError("line segments needs a geometry");
                return 0u;
            }
            if (!mat || mat->kind != Kind::Material || !mat->material) {
                setError("line segments needs a material");
                return 0u;
            }
            auto line = LineSegments::create(geo->geometry, mat->material);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = line;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_line_loop_create(uint32_t geometryHandle, uint32_t materialHandle) {
    try {
        return onWorker([geometryHandle, materialHandle] {
            Slot* geo = getSlot(geometryHandle);
            Slot* mat = getSlot(materialHandle);
            if (!geo || geo->kind != Kind::Geometry || !geo->geometry) {
                setError("line loop needs a geometry");
                return 0u;
            }
            if (!mat || mat->kind != Kind::Material || !mat->material) {
                setError("line loop needs a material");
                return 0u;
            }
            auto line = LineLoop::create(geo->geometry, mat->material);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = line;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_line_basic_material_create(uint32_t color, float linewidth) {
    try {
        return onWorker([color, linewidth] {
            auto material = LineBasicMaterial::create(
                    LineBasicMaterial::Params{}.color(Color(color)).linewidth(linewidth));
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

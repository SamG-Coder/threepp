#include "three_native.h"
#include "runtime_internal.hpp"
#include "threepp/objects/LOD.hpp"

using namespace tn;

uint32_t tn_lod_create(void) {
    try {
        return onWorker([] {
            auto lod = LOD::create();
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = lod;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_lod_add_level(uint32_t lod, uint32_t object, float distance) {
    try {
        return onWorker([lod, object, distance] {
            Slot* lodSlot = getSlot(lod);
            Slot* childSlot = getSlot(object);
            if (!lodSlot || !lodSlot->object || !childSlot || !childSlot->object) {
                return 0;
            }
            auto lodObj = std::dynamic_pointer_cast<LOD>(lodSlot->object);
            if (!lodObj) {
                return 0;
            }
            lodObj->addLevel(childSlot->object, distance);
            markDirty();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_lod_update(uint32_t lod, uint32_t camera) {
    try {
        onWorker([lod, camera] {
            Slot* lodSlot = getSlot(lod);
            Slot* camSlot = getSlot(camera);
            if (!lodSlot || !lodSlot->object || !camSlot) {
                return;
            }
            auto lodObj = std::dynamic_pointer_cast<LOD>(lodSlot->object);
            auto* cam = dynamic_cast<Camera*>(camSlot->object.get());
            if (lodObj && cam) {
                lodObj->update(*cam);
                markDirty();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

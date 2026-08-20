#include "three_native.h"
#include "runtime_internal.hpp"

using namespace tn;

extern "C" {

uint32_t tn_sprite_material_create(uint32_t color) {
    try {
        return onWorker([color] {
            auto material = SpriteMaterial::create(
                    SpriteMaterial::Params{}.color(Color(color)));
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

uint32_t tn_sprite_create(uint32_t material) {
    try {
        return onWorker([material] {
            Slot* mat = getSlot(material);
            if (!mat || !mat->material) {
                setError("sprite needs a SpriteMaterial");
                return 0u;
            }
            auto spriteMat = std::dynamic_pointer_cast<SpriteMaterial>(mat->material);
            if (!spriteMat) {
                setError("sprite needs a SpriteMaterial");
                return 0u;
            }
            auto sprite = Sprite::create(spriteMat);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = sprite;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

}// extern "C"

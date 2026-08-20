#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/math/Matrix4.hpp"
#include "threepp/objects/Bone.hpp"
#include "threepp/objects/ObjectWithMaterials.hpp"
#include "threepp/objects/SkinnedMesh.hpp"
#include "threepp/materials/SpriteMaterial.hpp"
#include "threepp/objects/Sprite.hpp"

#include <vector>

using namespace tn;
using namespace threepp;

uint32_t tn_bone_create(void) {
    try {
        return onWorker([] {
            auto bone = Bone::create();
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = bone;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_skeleton_create(const uint32_t* bones, int count) {
    try {
        std::vector<uint32_t> boneIds;
        if (bones && count > 0) {
            boneIds.assign(bones, bones + count);
        }
        return onWorker([boneIds] {
            std::vector<std::shared_ptr<Bone>> boneList;
            boneList.reserve(boneIds.size());
            for (uint32_t id : boneIds) {
                Slot* boneSlot = getSlot(id);
                if (!boneSlot || !boneSlot->object) {
                    continue;
                }
                auto bone = std::dynamic_pointer_cast<Bone>(boneSlot->object);
                if (!bone) {
                    continue;
                }
                boneList.push_back(std::move(bone));
            }
            auto skeleton = Skeleton::create(boneList);
            Slot slot;
            slot.kind = Kind::Skeleton;
            slot.skeleton = skeleton;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_skeleton_set_inverses(uint32_t skeleton, const float* inverses, int inverseCount) {
    try {
        std::vector<float> inv;
        if (inverses && inverseCount > 0) {
            inv.assign(inverses, inverses + inverseCount);
        }
        return onWorker([skeleton, inv] {
            Slot* slot = getSlot(skeleton);
            if (!slot || slot->kind != Kind::Skeleton || !slot->skeleton) {
                setError("skeleton set inverses needs a skeleton");
                return 0;
            }
            auto& dst = slot->skeleton->boneInverses;
            if (inv.size() != dst.size() * 16) {
                setError("skeleton inverse count does not match bones");
                return 0;
            }
            for (size_t i = 0; i < dst.size(); i++) {
                dst[i].fromArray(inv, i * 16);
            }
            markDirty();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_skinned_mesh_create(uint32_t geometry, uint32_t material) {
    try {
        return onWorker([geometry, material] {
            Slot* geo = getSlot(geometry);
            Slot* mat = getSlot(material);
            if (!geo || geo->kind != Kind::Geometry || !geo->geometry) {
                setError("mesh needs a geometry");
                return 0u;
            }
            if (!mat || mat->kind != Kind::Material || !mat->material) {
                setError("mesh needs a material");
                return 0u;
            }
            auto mesh = SkinnedMesh::create(geo->geometry, mat->material);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = mesh;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_skinned_bind(uint32_t mesh, uint32_t skeleton) {
    try {
        return onWorker([mesh, skeleton] {
            Slot* meshSlot = getSlot(mesh);
            if (!meshSlot || !meshSlot->object) {
                setError("skinned bind needs a skinned mesh");
                return 0;
            }
            auto skinned = std::dynamic_pointer_cast<SkinnedMesh>(meshSlot->object);
            if (!skinned) {
                setError("skinned bind needs a skinned mesh");
                return 0;
            }
            Slot* skelSlot = getSlot(skeleton);
            if (!skelSlot || skelSlot->kind != Kind::Skeleton || !skelSlot->skeleton) {
                setError("skinned bind needs a skeleton");
                return 0;
            }
            skinned->bind(skelSlot->skeleton);
            markDirty();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_mesh_set_material(uint32_t mesh, uint32_t material) {
    try {
        return onWorker([mesh, material] {
            Slot* meshSlot = getSlot(mesh);
            Slot* matSlot = getSlot(material);
            if (!meshSlot || !meshSlot->object || !matSlot || !matSlot->material) {
                setError("mesh set material needs mesh and material");
                return 0;
            }
            if (auto owm = std::dynamic_pointer_cast<ObjectWithMaterials>(meshSlot->object)) {
                owm->setMaterial(matSlot->material);
                markDirty();
                return 1;
            }
            if (auto sprite = std::dynamic_pointer_cast<Sprite>(meshSlot->object)) {
                auto spriteMat = std::dynamic_pointer_cast<SpriteMaterial>(matSlot->material);
                if (!spriteMat) {
                    setError("sprite needs a SpriteMaterial");
                    return 0;
                }
                sprite->setMaterial(spriteMat);
                markDirty();
                return 1;
            }
            setError("object does not take a material");
            return 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/math/Matrix4.hpp"
#include "threepp/objects/Bone.hpp"
#include "threepp/objects/ObjectWithMaterials.hpp"
#include "threepp/objects/SkinnedMesh.hpp"
#include "threepp/materials/SpriteMaterial.hpp"
#include "threepp/objects/Sprite.hpp"

#include <array>
#include <cstring>
#include <vector>

using namespace tn;
using namespace threepp;

namespace {

Matrix4 matrixFromFloats(const float* src, size_t offset = 0) {
    Matrix4 m;
    if (!src) {
        return m;
    }
    m.fromArray(src, offset);
    return m;
}

} // namespace

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

uint32_t tn_skeleton_create(
        const uint32_t* bones, int count, const float* inverses, int inverseCount) {
    try {
        std::vector<uint32_t> boneIds;
        std::vector<float> inv;
        if (bones && count > 0) {
            boneIds.assign(bones, bones + count);
        }
        if (inverses && inverseCount > 0) {
            inv.assign(inverses, inverses + inverseCount);
        }
        return onWorker([boneIds, inv] {
            std::vector<std::shared_ptr<Bone>> boneList;
            boneList.reserve(boneIds.size());
            for (uint32_t id : boneIds) {
                std::shared_ptr<Bone> bone;
                if (id) {
                    Slot* boneSlot = getSlot(id);
                    if (boneSlot && boneSlot->object) {
                        bone = std::dynamic_pointer_cast<Bone>(boneSlot->object);
                    }
                }
                boneList.push_back(std::move(bone));
            }
            std::vector<Matrix4> boneInverses;
            if (inv.size() >= boneList.size() * 16) {
                boneInverses.resize(boneList.size());
                for (size_t i = 0; i < boneList.size(); i++) {
                    boneInverses[i] = matrixFromFloats(inv.data(), i * 16);
                }
            }
            auto skeleton = Skeleton::create(boneList, boneInverses);
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

int tn_skinned_bind(
        uint32_t mesh, uint32_t skeleton, const float* bindMatrix16, int bindCount) {
    try {
        std::array<float, 16> bm{};
        const bool hasBm = bindMatrix16 && bindCount >= 16;
        if (hasBm) {
            std::memcpy(bm.data(), bindMatrix16, 16 * sizeof(float));
        }
        return onWorker([mesh, skeleton, bm, hasBm] {
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
            if (hasBm) {
                skinned->bind(skelSlot->skeleton, matrixFromFloats(bm.data()));
            } else {
                skinned->bind(skelSlot->skeleton);
            }
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

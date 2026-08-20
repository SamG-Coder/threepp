#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/objects/Bone.hpp"
#include "threepp/objects/SkinnedMesh.hpp"

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

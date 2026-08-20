#include "three_native.h"
#include "cmd_ops.hpp"
#include "runtime_internal.hpp"

#include "threepp/objects/Line.hpp"
#include "threepp/objects/LineLoop.hpp"
#include "threepp/objects/LineSegments.hpp"
#include "threepp/objects/SkinnedMesh.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <string>
#include <vector>

using namespace tn;

namespace {

uint32_t ru32(const uint8_t* p) {
    uint32_t v;
    std::memcpy(&v, p, 4);
    return v;
}

float rf32(const uint8_t* p) {
    float v;
    std::memcpy(&v, p, 4);
    return v;
}

bool has(const uint8_t* p, const uint8_t* end, size_t n) {
    return p + n <= end;
}

void insertObject(uint32_t id, Kind kind, std::shared_ptr<Object3D> object) {
    Slot slot;
    slot.kind = kind;
    slot.object = std::move(object);
    insertAt(id, std::move(slot));
}

void insertMaterial(uint32_t id, std::shared_ptr<Material> material) {
    Slot slot;
    slot.kind = Kind::Material;
    slot.material = std::move(material);
    insertAt(id, std::move(slot));
}

void applyMaterialMapSlot(Material* material, const std::shared_ptr<Texture>& texture, uint32_t slot) {
    if (!material || !texture) {
        return;
    }
    switch (slot) {
        case tn::cmd::MAP_SLOT_NORMAL:
            if (auto* m = dynamic_cast<MaterialWithNormalMap*>(material)) {
                m->normalMap = texture;
            }
            break;
        case tn::cmd::MAP_SLOT_ROUGHNESS:
            if (auto* m = dynamic_cast<MaterialWithRoughness*>(material)) {
                m->roughnessMap = texture;
            }
            break;
        case tn::cmd::MAP_SLOT_METALNESS:
            if (auto* m = dynamic_cast<MaterialWithMetalness*>(material)) {
                m->metalnessMap = texture;
            }
            break;
        case tn::cmd::MAP_SLOT_AO:
            if (auto* m = dynamic_cast<MaterialWithAoMap*>(material)) {
                m->aoMap = texture;
            }
            break;
        case tn::cmd::MAP_SLOT_EMISSIVE:
            if (auto* m = dynamic_cast<MaterialWithEmissive*>(material)) {
                m->emissiveMap = texture;
            }
            break;
        default:
            if (auto* m = dynamic_cast<MaterialWithMap*>(material)) {
                m->map = texture;
            }
            break;
    }
    material->needsUpdate();
    markDirty();
}

void execOne(uint32_t op, const uint8_t* p, const uint8_t* end) {
    switch (op) {
        case tn::cmd::OP_NOP:
            return;
        case tn::cmd::OP_RENDER: {
            if (!has(p, end, 8)) return;
            g.drawScene.store(ru32(p));
            g.drawCamera.store(ru32(p + 4));
            markDirty();
            return;
        }
        case tn::cmd::OP_SET_SIZE: {
            if (!has(p, end, 8)) return;
            const int w = static_cast<int>(ru32(p));
            const int h = static_cast<int>(ru32(p + 4));
            if (g.canvas && g.renderer) {
                g.canvas->setSize({w, h});
                g.renderer->setSize({w, h});
            }
            return;
        }
        case tn::cmd::OP_SCENE_CREATE: {
            if (!has(p, end, 4)) return;
            auto scene = Scene::create();
            scene->background = Background(Color(0x000000));
            insertObject(ru32(p), Kind::Scene, scene);
            return;
        }
        case tn::cmd::OP_SCENE_BG: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || slot->kind != Kind::Scene) return;
            if (auto* scene = dynamic_cast<Scene*>(slot->object.get())) {
                scene->background = Background(static_cast<int>(ru32(p + 4)));
            }
            return;
        }
        case tn::cmd::OP_SCENE_FOG: {
            if (!has(p, end, 16)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || slot->kind != Kind::Scene) return;
            if (auto* scene = dynamic_cast<Scene*>(slot->object.get())) {
                scene->fog = Fog(Color(ru32(p + 4)), rf32(p + 8), rf32(p + 12));
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_SCENE_FOG_EXP2: {
            if (!has(p, end, 12)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || slot->kind != Kind::Scene) return;
            if (auto* scene = dynamic_cast<Scene*>(slot->object.get())) {
                scene->fog = FogExp2(Color(ru32(p + 4)), rf32(p + 8));
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_PERSP_CAM: {
            if (!has(p, end, 20)) return;
            auto cam = PerspectiveCamera::create(rf32(p + 4), rf32(p + 8), rf32(p + 12), rf32(p + 16));
            insertObject(ru32(p), Kind::Camera, cam);
            return;
        }
        case tn::cmd::OP_ORTHO_CAM: {
            if (!has(p, end, 28)) return;
            auto cam = OrthographicCamera::create(
                    rf32(p + 4), rf32(p + 8), rf32(p + 12), rf32(p + 16), rf32(p + 20), rf32(p + 24));
            insertObject(ru32(p), Kind::Camera, cam);
            return;
        }
        case tn::cmd::OP_ORTHO_UPDATE: {
            if (!has(p, end, 32)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            if (auto cam = std::dynamic_pointer_cast<OrthographicCamera>(slot->object)) {
                cam->left = rf32(p + 4);
                cam->right = rf32(p + 8);
                cam->top = rf32(p + 12);
                cam->bottom = rf32(p + 16);
                cam->nearPlane = rf32(p + 20);
                cam->farPlane = rf32(p + 24);
                cam->zoom = rf32(p + 28);
                cam->updateProjectionMatrix();
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_CAM_ASPECT: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            if (auto cam = std::dynamic_pointer_cast<PerspectiveCamera>(slot->object)) {
                cam->aspect = rf32(p + 4);
                cam->updateProjectionMatrix();
            }
            return;
        }
        case tn::cmd::OP_CAM_UPD_PROJ: {
            if (!has(p, end, 4)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            if (auto* cam = dynamic_cast<Camera*>(slot->object.get())) {
                cam->updateProjectionMatrix();
            }
            return;
        }
        case tn::cmd::OP_BUF_GEO: {
            if (!has(p, end, 24)) return;
            const uint32_t id = ru32(p);
            const uint32_t posN = ru32(p + 4);
            const uint32_t nrmN = ru32(p + 8);
            const uint32_t uvN = ru32(p + 12);
            const uint32_t idxN = ru32(p + 16);
            const uint8_t* cur = p + 24;
            const size_t need = static_cast<size_t>(posN + nrmN + uvN) * 4u + static_cast<size_t>(idxN) * 4u;
            if (!has(cur, end, need) || posN < 3) {
                setError("buffer geometry needs positions");
                return;
            }
            std::vector<float> pos(posN);
            std::memcpy(pos.data(), cur, posN * 4u);
            cur += posN * 4u;
            std::vector<float> nrm;
            if (nrmN) {
                nrm.resize(nrmN);
                std::memcpy(nrm.data(), cur, nrmN * 4u);
                cur += nrmN * 4u;
            }
            std::vector<float> uv;
            if (uvN) {
                uv.resize(uvN);
                std::memcpy(uv.data(), cur, uvN * 4u);
                cur += uvN * 4u;
            }
            std::vector<unsigned int> idx;
            if (idxN) {
                idx.resize(idxN);
                std::memcpy(idx.data(), cur, idxN * 4u);
            }
            auto geo = BufferGeometry::create();
            geo->setAttribute("position", std::shared_ptr<BufferAttribute>(
                    FloatBufferAttribute::create(std::move(pos), 3)));
            if (nrm.size() >= 3 && (nrm.size() % 3) == 0) {
                geo->setAttribute("normal", std::shared_ptr<BufferAttribute>(
                        FloatBufferAttribute::create(std::move(nrm), 3)));
            }
            if (uv.size() >= 2 && (uv.size() % 2) == 0) {
                geo->setAttribute("uv", std::shared_ptr<BufferAttribute>(
                        FloatBufferAttribute::create(std::move(uv), 2)));
            }
            if (!idx.empty()) {
                geo->setIndex(std::move(idx));
            }
            geo->computeBoundingSphere();
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = std::move(geo);
            insertAt(id, std::move(slot));
            return;
        }
        case tn::cmd::OP_BUF_ATTR: {
            if (!has(p, end, 32)) return;
            const uint32_t id = ru32(p);
            const uint32_t itemSize = ru32(p + 4);
            const uint32_t floatCount = ru32(p + 8);
            char nameBuf[17];
            std::memcpy(nameBuf, p + 16, 16);
            nameBuf[16] = '\0';
            const uint8_t* cur = p + 32;
            const size_t need = static_cast<size_t>(floatCount) * 4u;
            if (itemSize == 0 || floatCount < itemSize || !nameBuf[0] || !has(cur, end, need)) {
                setError("buffer attr needs name, itemSize and floats");
                return;
            }
            if ((floatCount % itemSize) != 0) {
                setError("buffer attr length is not a multiple of itemSize");
                return;
            }
            Slot* slot = getSlot(id);
            if (!slot || slot->kind != Kind::Geometry || !slot->geometry) {
                setError("buffer attr needs a geometry");
                return;
            }
            std::vector<float> data(floatCount);
            std::memcpy(data.data(), cur, need);
            slot->geometry->setAttribute(
                    std::string(nameBuf),
                    std::shared_ptr<BufferAttribute>(
                            FloatBufferAttribute::create(std::move(data), static_cast<int>(itemSize))));
            markDirty();
            return;
        }
        case tn::cmd::OP_BOX_GEO: {
            if (!has(p, end, 16)) return;
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = BoxGeometry::create(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            insertAt(ru32(p), std::move(slot));
            return;
        }
        case tn::cmd::OP_MAT_BASIC: {
            if (!has(p, end, 8)) return;
            insertMaterial(ru32(p), MeshBasicMaterial::create(
                    MeshBasicMaterial::Params{}.color(Color(ru32(p + 4)))));
            return;
        }
        case tn::cmd::OP_MAT_LAMBERT: {
            if (!has(p, end, 8)) return;
            insertMaterial(ru32(p), MeshLambertMaterial::create(
                    MeshLambertMaterial::Params{}.color(Color(ru32(p + 4)))));
            return;
        }
        case tn::cmd::OP_MAT_STANDARD: {
            if (!has(p, end, 16)) return;
            auto mat = MeshStandardMaterial::create(
                    MeshStandardMaterial::Params{}.color(Color(ru32(p + 4))));
            mat->metalness = rf32(p + 8);
            mat->roughness = rf32(p + 12);
            insertMaterial(ru32(p), mat);
            return;
        }
        case tn::cmd::OP_MAT_LINE: {
            if (!has(p, end, 12)) return;
            insertMaterial(ru32(p), LineBasicMaterial::create(
                    LineBasicMaterial::Params{}.color(Color(ru32(p + 4))).linewidth(rf32(p + 8))));
            return;
        }
        case tn::cmd::OP_MAT_POINTS: {
            if (!has(p, end, 12)) return;
            insertMaterial(ru32(p), PointsMaterial::create(
                    PointsMaterial::Params{}.color(Color(ru32(p + 4))).size(rf32(p + 8))));
            return;
        }
        case tn::cmd::OP_MAT_SPRITE: {
            if (!has(p, end, 8)) return;
            insertMaterial(ru32(p), SpriteMaterial::create(
                    SpriteMaterial::Params{}.color(Color(ru32(p + 4)))));
            return;
        }
        case tn::cmd::OP_MAT_SIDE: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            const int side = static_cast<int>(ru32(p + 4));
            slot->material->side = side <= 0 ? Side::Front : side == 1 ? Side::Back : Side::Double;
            slot->material->needsUpdate();
            return;
        }
        case tn::cmd::OP_MAT_MAP: {
            if (!has(p, end, 8)) return;
            Slot* matSlot = getSlot(ru32(p));
            Slot* texSlot = getSlot(ru32(p + 4));
            if (!matSlot || !matSlot->material || !texSlot || !texSlot->texture) return;
            applyMaterialMapSlot(matSlot->material.get(), texSlot->texture, tn::cmd::MAP_SLOT_ALBEDO);
            return;
        }
        case tn::cmd::OP_MAT_MAP_SLOT: {
            if (!has(p, end, 12)) return;
            Slot* matSlot = getSlot(ru32(p));
            Slot* texSlot = getSlot(ru32(p + 8));
            if (!matSlot || !matSlot->material || !texSlot || !texSlot->texture) return;
            applyMaterialMapSlot(matSlot->material.get(), texSlot->texture, ru32(p + 4));
            return;
        }
        case tn::cmd::OP_MAT_PBR: {
            if (!has(p, end, 12)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            if (auto mat = std::dynamic_pointer_cast<MeshStandardMaterial>(slot->material)) {
                mat->metalness = rf32(p + 4);
                mat->roughness = rf32(p + 8);
            }
            return;
        }
        case tn::cmd::OP_MAT_EMISSIVE: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            if (auto* em = dynamic_cast<MaterialWithEmissive*>(slot->material.get())) {
                em->emissive = Color(ru32(p + 4));
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_MESH: {
            if (!has(p, end, 12)) return;
            Slot* geo = getSlot(ru32(p + 4));
            Slot* mat = getSlot(ru32(p + 8));
            if (!geo || !geo->geometry || !mat || !mat->material) return;
            insertObject(ru32(p), Kind::Object, Mesh::create(geo->geometry, mat->material));
            return;
        }
        case tn::cmd::OP_GROUP: {
            if (!has(p, end, 4)) return;
            insertObject(ru32(p), Kind::Object, Group::create());
            return;
        }
        case tn::cmd::OP_INSTANCED: {
            if (!has(p, end, 16)) return;
            Slot* geo = getSlot(ru32(p + 4));
            Slot* mat = getSlot(ru32(p + 8));
            if (!geo || !geo->geometry || !mat || !mat->material) return;
            const int n = std::max(1, static_cast<int>(ru32(p + 12)));
            insertObject(ru32(p), Kind::Object,
                    InstancedMesh::create(geo->geometry, mat->material, static_cast<size_t>(n)));
            return;
        }
        case tn::cmd::OP_LINE:
        case tn::cmd::OP_LINE_SEG:
        case tn::cmd::OP_LINE_LOOP: {
            if (!has(p, end, 12)) return;
            Slot* geo = getSlot(ru32(p + 4));
            Slot* mat = getSlot(ru32(p + 8));
            if (!geo || !geo->geometry || !mat || !mat->material) return;
            std::shared_ptr<Object3D> obj;
            if (op == tn::cmd::OP_LINE_SEG) obj = LineSegments::create(geo->geometry, mat->material);
            else if (op == tn::cmd::OP_LINE_LOOP) obj = LineLoop::create(geo->geometry, mat->material);
            else obj = Line::create(geo->geometry, mat->material);
            insertObject(ru32(p), Kind::Object, obj);
            return;
        }
        case tn::cmd::OP_POINTS: {
            if (!has(p, end, 12)) return;
            Slot* geo = getSlot(ru32(p + 4));
            Slot* mat = getSlot(ru32(p + 8));
            if (!geo || !geo->geometry || !mat || !mat->material) return;
            insertObject(ru32(p), Kind::Object, Points::create(geo->geometry, mat->material));
            return;
        }
        case tn::cmd::OP_SPRITE: {
            if (!has(p, end, 8)) return;
            Slot* mat = getSlot(ru32(p + 4));
            if (!mat || !mat->material) return;
            auto spriteMat = std::dynamic_pointer_cast<SpriteMaterial>(mat->material);
            if (!spriteMat) return;
            insertObject(ru32(p), Kind::Object, Sprite::create(spriteMat));
            return;
        }
        case tn::cmd::OP_SKINNED: {
            if (!has(p, end, 12)) return;
            Slot* geo = getSlot(ru32(p + 4));
            Slot* mat = getSlot(ru32(p + 8));
            if (!geo || !geo->geometry || !mat || !mat->material) return;
            insertObject(ru32(p), Kind::Object, SkinnedMesh::create(geo->geometry, mat->material));
            return;
        }
        case tn::cmd::OP_SKINNED_BIND: {
            if (!has(p, end, 8)) return;
            Slot* meshSlot = getSlot(ru32(p));
            Slot* skelSlot = getSlot(ru32(p + 4));
            if (!meshSlot || !meshSlot->object || !skelSlot || !skelSlot->skeleton) return;
            auto skinned = std::dynamic_pointer_cast<SkinnedMesh>(meshSlot->object);
            if (!skinned) return;
            skinned->bind(skelSlot->skeleton);
            markDirty();
            return;
        }
        case tn::cmd::OP_OBJECT_ADD: {
            if (!has(p, end, 8)) return;
            Slot* parent = getSlot(ru32(p));
            Slot* child = getSlot(ru32(p + 4));
            if (!parent || !parent->object || !child || !child->object) return;
            parent->object->add(child->object);
            return;
        }
        case tn::cmd::OP_SET_POSE: {
            if (!has(p, end, 40)) return;
            Object3D* object = asObject(ru32(p));
            if (!object) return;
            object->position.set(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            object->rotation.set(rf32(p + 16), rf32(p + 20), rf32(p + 24));
            object->scale.set(rf32(p + 28), rf32(p + 32), rf32(p + 36));
            return;
        }
        case tn::cmd::OP_LOOK_AT: {
            if (!has(p, end, 16)) return;
            Object3D* object = asObject(ru32(p));
            if (object) object->lookAt(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            return;
        }
        case tn::cmd::OP_LOOK_FROM: {
            if (!has(p, end, 28)) return;
            Object3D* object = asObject(ru32(p));
            if (!object) return;
            object->position.set(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            object->lookAt(rf32(p + 16), rf32(p + 20), rf32(p + 24));
            return;
        }
        case tn::cmd::OP_LIGHT_AMBIENT: {
            if (!has(p, end, 12)) return;
            insertObject(ru32(p), Kind::Object,
                    AmbientLight::create(Color(ru32(p + 4)), rf32(p + 8)));
            return;
        }
        case tn::cmd::OP_LIGHT_DIR: {
            if (!has(p, end, 12)) return;
            insertObject(ru32(p), Kind::Object,
                    DirectionalLight::create(Color(ru32(p + 4)), rf32(p + 8)));
            return;
        }
        case tn::cmd::OP_LIGHT_HEMI: {
            if (!has(p, end, 4)) return;
            insertObject(ru32(p), Kind::Object, HemisphereLight::create());
            return;
        }
        case tn::cmd::OP_LIGHT_POINT: {
            if (!has(p, end, 12)) return;
            insertObject(ru32(p), Kind::Object,
                    PointLight::create(Color(ru32(p + 4)), rf32(p + 8)));
            return;
        }
        case tn::cmd::OP_LIGHT_SPOT: {
            if (!has(p, end, 28)) return;
            insertObject(ru32(p), Kind::Object,
                    SpotLight::create(Color(ru32(p + 4)), rf32(p + 8), rf32(p + 12),
                            rf32(p + 16), rf32(p + 20), rf32(p + 24)));
            return;
        }
        case tn::cmd::OP_INST_MATRIX: {
            if (!has(p, end, 72)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            auto inst = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!inst) return;
            std::array<float, 16> e{};
            std::memcpy(e.data(), p + 8, 64);
            Matrix4 m;
            m.fromArray(e);
            inst->setMatrixAt(static_cast<size_t>(ru32(p + 4)), m);
            inst->instanceMatrix()->needsUpdate();
            markDirty();
            return;
        }
        case tn::cmd::OP_INST_COLOR: {
            if (!has(p, end, 12)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            auto inst = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!inst) return;
            inst->setColorAt(static_cast<size_t>(ru32(p + 4)), Color(ru32(p + 8)));
            if (auto* c = inst->instanceColor()) c->needsUpdate();
            markDirty();
            return;
        }
        default:
            setError("unknown cmd opcode");
            return;
    }
}

void execStream(const uint8_t* data, int nbytes) {
    if (!data || nbytes < 8) return;
    const uint8_t* p = data;
    const uint8_t* end = data + nbytes;
    while (has(p, end, 8)) {
        const uint32_t op = ru32(p);
        const uint32_t bytes = ru32(p + 4);
        if (bytes < 8 || !has(p, end, bytes)) {
            setError("truncated command stream");
            return;
        }
        execOne(op, p + 8, p + bytes);
        p += bytes;
    }
}

}// namespace

int tn_cmd_submit(const uint8_t* data, int nbytes) {
    try {
        if (!data || nbytes <= 0) {
            return 1;
        }
        return onWorker([data, nbytes] {
            execStream(data, nbytes);
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

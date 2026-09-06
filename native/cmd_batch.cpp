#include "three_native.h"
#include "cmd_ops.hpp"
#include "runtime_internal.hpp"

#include "threepp/math/Matrix4.hpp"
#include "threepp/math/Matrix3.hpp"
#include "threepp/math/Vector4.hpp"
#include "threepp/math/Vector2.hpp"
#include "threepp/objects/Line.hpp"
#include "threepp/objects/LineLoop.hpp"
#include "threepp/objects/LineSegments.hpp"
#include "threepp/objects/ObjectWithMaterials.hpp"
#include "threepp/objects/SkinnedMesh.hpp"
#include "threepp/materials/SpriteMaterial.hpp"
#include "threepp/materials/ShaderMaterial.hpp"
#include "threepp/materials/MeshDepthMaterial.hpp"
#include "threepp/objects/Sprite.hpp"
#include "threepp/textures/Texture.hpp"
#include "threepp/textures/CubeTexture.hpp"
#include "threepp/textures/DataTexture.hpp"
#include "threepp/renderers/gl/GLShadowMap.hpp"

#include <algorithm>
#include <array>
#include <cstdlib>
#include <iostream>
#include <cstring>
#include <string>
#include <unordered_map>
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

struct PendingTex {
    int width{0};
    int height{0};
    int rows{0};
    TextureWrapping wrapS{TextureWrapping::Repeat};
    TextureWrapping wrapT{TextureWrapping::Repeat};
    ColorSpace colorSpace{ColorSpace::sRGB};
    Filter magFilter{Filter::Linear};
    Filter minFilter{Filter::LinearMipmapLinear};
    int texCoord{0};
    Vector2 offset{0, 0};
    Vector2 repeat{1, 1};
    std::vector<unsigned char> pixels;
};

std::unordered_map<uint32_t, PendingTex> pendingTex;

void finishRgbaTexture(
        uint32_t id,
        int width,
        int height,
        std::vector<unsigned char> pixels,
        TextureWrapping wrapS = TextureWrapping::Repeat,
        TextureWrapping wrapT = TextureWrapping::Repeat,
        ColorSpace colorSpace = ColorSpace::sRGB,
        Filter magFilter = Filter::Linear,
        Filter minFilter = Filter::LinearMipmapLinear,
        int texCoord = 0,
        Vector2 offset = {0, 0},
        Vector2 repeat = {1, 1}) {
    if (std::getenv("THREEBROWSER_NATIVE_TERRAIN_TRACE") && width == 2048 && height == 2048) {
        unsigned long long sums[4]{0, 0, 0, 0};
        for (size_t i = 0; i + 3 < pixels.size(); i += 4) {
            sums[0] += pixels[i]; sums[1] += pixels[i + 1];
            sums[2] += pixels[i + 2]; sums[3] += pixels[i + 3];
        }
        std::cerr << "rgba texture id=" << id << " sums=" << sums[0] << ',' << sums[1]
                  << ',' << sums[2] << ',' << sums[3] << '\n';
    }
    Image image(std::move(pixels), static_cast<unsigned>(width), static_cast<unsigned>(height));
    auto tex = Texture::create(image);
    tex->format = Format::RGBA;
    tex->colorSpace = colorSpace;
    tex->wrapS = wrapS;
    tex->wrapT = wrapT;
    tex->magFilter = magFilter;
    tex->minFilter = minFilter;
    tex->texCoord = texCoord;
    tex->offset.copy(offset);
    tex->repeat.copy(repeat);
    tex->generateMipmaps =
            minFilter != Filter::Nearest && minFilter != Filter::Linear;
    tex->needsUpdate();

    // Preserve the native Texture object's address when JavaScript uploads a
    // newer image into an existing texture handle. Materials and custom shader
    // uniforms retain Texture* values, just as Three.js retains the same
    // Texture object while its Source changes. Replacing the entire slot here
    // left those uniforms pointing at the previous pixels (or eventually a
    // freed object) during progressive texture loading.
    if (Slot* existing = getSlot(id); existing && existing->texture) {
        existing->texture->copy(*tex);
        existing->texture->needsUpdate();
        markDirty();
        return;
    }

    Slot slot;
    slot.kind = Kind::Texture;
    slot.texture = std::move(tex);
    insertAt(id, std::move(slot));
    markDirty();
}

void finishFloatTexture(uint32_t id, int width, int height, std::vector<float> pixels) {
    auto tex = DataTexture::create(ImageData{std::move(pixels)},
                                   static_cast<unsigned>(width),
                                   static_cast<unsigned>(height));
    tex->format = Format::RGBA;
    tex->type = Type::Float;
    tex->colorSpace = ColorSpace::NoColorSpace;
    tex->wrapS = TextureWrapping::ClampToEdge;
    tex->wrapT = TextureWrapping::ClampToEdge;
    tex->magFilter = Filter::Nearest;
    tex->minFilter = Filter::Nearest;
    tex->generateMipmaps = false;
    tex->needsUpdate();

    if (Slot* existing = getSlot(id); existing && existing->texture) {
        existing->texture->copy(*tex);
        existing->texture->type = Type::Float;
        existing->texture->format = Format::RGBA;
        existing->texture->colorSpace = ColorSpace::NoColorSpace;
        existing->texture->generateMipmaps = false;
        existing->texture->needsUpdate();
        markDirty();
        return;
    }

    Slot slot;
    slot.kind = Kind::Texture;
    slot.texture = std::move(tex);
    insertAt(id, std::move(slot));
    markDirty();
}

// Same tables as three.js Texture / WEBGL_WRAPPINGS / WEBGL_FILTERS.
// Accept both three.js enums (1000+) and the GL enums loaders sometimes leave
// on the object (10497, 33071, 9729, …). Unknown wrap → Repeat (glTF default).
TextureWrapping wrapFromJs(uint32_t value) {
    switch (value) {
        case 1001u: // ClampToEdgeWrapping
        case 33071u: // GL_CLAMP_TO_EDGE
            return TextureWrapping::ClampToEdge;
        case 1002u: // MirroredRepeatWrapping
        case 33648u: // GL_MIRRORED_REPEAT
            return TextureWrapping::MirroredRepeat;
        default:
            return TextureWrapping::Repeat;
    }
}

Filter magFilterFromJs(uint32_t value) {
    switch (value) {
        case 1003u: // NearestFilter
        case 9728u: // GL_NEAREST
            return Filter::Nearest;
        default:
            return Filter::Linear;
    }
}

Filter minFilterFromJs(uint32_t value) {
    switch (value) {
        case 1003u:
        case 9728u:
            return Filter::Nearest;
        case 1006u: // LinearFilter
        case 9729u: // GL_LINEAR
            return Filter::Linear;
        case 1004u: // NearestMipmapNearestFilter
        case 9984u:
            return Filter::NearestMipmapNearest;
        case 1007u: // LinearMipmapNearestFilter
        case 9985u:
            return Filter::LinearMipmapNearest;
        case 1005u: // NearestMipmapLinearFilter
        case 9986u:
            return Filter::NearestMipmapLinear;
        default:
            return Filter::LinearMipmapLinear;
    }
}

ColorSpace colorSpaceFromJs(uint32_t value) {
    if (value == 3001u) return ColorSpace::sRGB;
    return ColorSpace::NoColorSpace;
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
        case tn::cmd::MAP_SLOT_ENV:
            if (auto* m = dynamic_cast<MaterialWithEnvMap*>(material)) {
                m->envMap = texture;
            }
            break;
        case tn::cmd::MAP_SLOT_LIGHT:
            if (auto* m = dynamic_cast<MaterialWithLightMap*>(material)) {
                m->lightMap = texture;
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
            g.drawOverlayScene.store(0);
            g.drawOverlayCamera.store(0);
            markDirty();
            return;
        }
        case tn::cmd::OP_RENDER_COMPOSITE: {
            if (!has(p, end, 16)) return;
            g.drawScene.store(ru32(p));
            g.drawCamera.store(ru32(p + 4));
            g.drawOverlayScene.store(ru32(p + 8));
            g.drawOverlayCamera.store(ru32(p + 12));
            markDirty();
            return;
        }
        case tn::cmd::OP_SET_SIZE: {
            if (!has(p, end, 8)) return;
            const int w = std::max(1, static_cast<int>(ru32(p)));
            const int h = std::max(1, static_cast<int>(ru32(p + 4)));
            if (g.renderer) {
#if !defined(__ANDROID__)
                g.canvas->setSize({w, h});
#endif
                g.renderer->setSize({w, h});
            }
            return;
        }
        case tn::cmd::OP_SCENE_CREATE: {
            if (!has(p, end, 4)) return;
            auto scene = Scene::create();
            insertObject(ru32(p), Kind::Scene, scene);
            return;
        }
        case tn::cmd::OP_CLEAR_TARGET: {
            if (!has(p, end, 16)) return;
            auto* gl = dynamic_cast<GLRenderer*>(g.renderer.get());
            auto* target = findSlot(ru32(p));
            if (!gl || !target || !target->renderTarget) return;
            auto* previous = gl->getRenderTarget();
            gl->setRenderTarget(target->renderTarget.get(), static_cast<int>(ru32(p + 8)), static_cast<int>(ru32(p + 12)));
            const auto flags = ru32(p + 4);
            gl->clear((flags & 1u) != 0, (flags & 2u) != 0, (flags & 4u) != 0);
            gl->setRenderTarget(previous);
            return;
        }
        case tn::cmd::OP_RENDER_PASS: {
            if (!has(p, end, 28)) return;
            Slot* sceneSlot = getSlot(ru32(p));
            Slot* cameraSlot = getSlot(ru32(p + 4));
            Slot* targetSlot = getSlot(ru32(p + 8));
            Slot* overrideSlot = ru32(p + 12) ? getSlot(ru32(p + 12)) : nullptr;
            auto* gl = dynamic_cast<GLRenderer*>(g.renderer.get());
            auto* scene = sceneSlot ? dynamic_cast<Scene*>(sceneSlot->object.get()) : nullptr;
            auto* camera = cameraSlot ? dynamic_cast<Camera*>(cameraSlot->object.get()) : nullptr;
            if (!gl || !scene || !camera || !targetSlot || !targetSlot->renderTarget) return;
            if (std::getenv("THREEBROWSER_TRACE_RENDER")) {
                logLine(("RenderPass begin scene=" + std::to_string(ru32(p)) +
                         " camera=" + std::to_string(ru32(p + 4)) +
                         " target=" + std::to_string(ru32(p + 8))).c_str());
            }

            auto previousOverride = scene->overrideMaterial;
            const uint32_t flags = ru32(p + 24);
            if ((flags & 1u) != 0u) {
                static auto depthMaterial = MeshDepthMaterial::create(
                        MeshDepthMaterial::Params{}.depthPacking(DepthPacking::RGBA));
                scene->overrideMaterial = depthMaterial;
            } else if (overrideSlot && overrideSlot->material) {
                scene->overrideMaterial = overrideSlot->material;
            }
            auto* previousTarget = gl->getRenderTarget();
            if (has(p, end, 64)) {
                targetSlot->renderTarget->viewport.set(rf32(p + 28), rf32(p + 32), rf32(p + 36), rf32(p + 40));
                targetSlot->renderTarget->scissor.set(rf32(p + 44), rf32(p + 48), rf32(p + 52), rf32(p + 56));
                targetSlot->renderTarget->scissorTest = ru32(p + 60) != 0;
            }
            const bool previousAutoClear = gl->autoClear;
            const bool previousColor = gl->autoClearColor;
            const bool previousDepth = gl->autoClearDepth;
            const bool previousStencil = gl->autoClearStencil;
            if ((flags & 2u) != 0u) {
                gl->autoClear = (flags & 4u) != 0u;
                gl->autoClearColor = (flags & 8u) != 0u;
                gl->autoClearDepth = (flags & 16u) != 0u;
                gl->autoClearStencil = (flags & 32u) != 0u;
            }
            gl->setRenderTarget(targetSlot->renderTarget.get(),
                                static_cast<int>(ru32(p + 16)),
                                static_cast<int>(ru32(p + 20)));
            if (std::getenv("THREEBROWSER_TRACE_RENDER")) logLine("RenderPass target set");
            gl->render(*scene, *camera);
            if (std::getenv("THREEBROWSER_TRACE_RENDER")) logLine("RenderPass rendered");
            gl->setRenderTarget(previousTarget);
            gl->autoClear = previousAutoClear;
            gl->autoClearColor = previousColor;
            gl->autoClearDepth = previousDepth;
            gl->autoClearStencil = previousStencil;
            scene->overrideMaterial = std::move(previousOverride);
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
        case tn::cmd::OP_CAM_PROJECTION: {
            if (!has(p, end, 76)) return;
            auto* camera = dynamic_cast<Camera*>(findObject(ru32(p)));
            if (!camera) return;
            std::array<float, 16> values{};
            for (size_t i = 0; i < 16; ++i) values[i] = rf32(p + 12 + i * 4);
            camera->nearPlane = rf32(p + 4);
            camera->farPlane = rf32(p + 8);
            camera->projectionMatrix.fromArray(values);
            camera->projectionMatrixInverse.copy(camera->projectionMatrix).invert();
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
        case tn::cmd::OP_TEX_RGBA: {
            if (!has(p, end, 16)) return;
            const uint32_t id = ru32(p);
            const uint32_t width = ru32(p + 4);
            const uint32_t height = ru32(p + 8);
            const uint8_t* cur = p + 16;
            const size_t need = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
            if (!width || !height || !has(cur, end, need)) {
                setError("texture needs rgba pixels");
                return;
            }
            std::vector<unsigned char> pixels(cur, cur + need);
            finishRgbaTexture(id, static_cast<int>(width), static_cast<int>(height), std::move(pixels));
            return;
        }
        case tn::cmd::OP_TEX_FLOAT: {
            if (!has(p, end, 16)) return;
            const uint32_t id = ru32(p);
            const uint32_t width = ru32(p + 4);
            const uint32_t height = ru32(p + 8);
            const size_t count = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
            const size_t bytes = count * sizeof(float);
            const uint8_t* cur = p + 16;
            if (!width || !height || width > 16384 || height > 16384 || !has(cur, end, bytes)) {
                setError("texture needs float rgba pixels");
                return;
            }
            std::vector<float> pixels(count);
            std::memcpy(pixels.data(), cur, bytes);
            finishFloatTexture(id, static_cast<int>(width), static_cast<int>(height), std::move(pixels));
            return;
        }
        case tn::cmd::OP_TEX_BEGIN: {
            if (!has(p, end, 12)) return;
            const uint32_t id = ru32(p);
            const uint32_t width = ru32(p + 4);
            const uint32_t height = ru32(p + 8);
            if (!width || !height || width > 16384 || height > 16384) {
                setError("texture begin needs valid size");
                return;
            }
            PendingTex tex;
            tex.width = static_cast<int>(width);
            tex.height = static_cast<int>(height);
            tex.pixels.assign(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u, 0);
            pendingTex[id] = std::move(tex);
            return;
        }
        case tn::cmd::OP_TEX_ROWS: {
            if (!has(p, end, 16)) return;
            const uint32_t id = ru32(p);
            const uint32_t y = ru32(p + 4);
            const uint32_t rows = ru32(p + 8);
            auto it = pendingTex.find(id);
            if (it == pendingTex.end() || rows == 0) {
                setError("texture rows need begin");
                return;
            }
            PendingTex& tex = it->second;
            const size_t stride = static_cast<size_t>(tex.width) * 4u;
            const size_t need = stride * static_cast<size_t>(rows);
            const uint8_t* cur = p + 16;
            if (y >= static_cast<uint32_t>(tex.height) ||
                y + rows > static_cast<uint32_t>(tex.height) ||
                !has(cur, end, need)) {
                setError("texture rows out of range");
                return;
            }
            std::memcpy(tex.pixels.data() + static_cast<size_t>(y) * stride, cur, need);
            tex.rows = std::max(tex.rows, static_cast<int>(y + rows));
            if (tex.rows >= tex.height) {
                const int w = tex.width;
                const int h = tex.height;
                auto pixels = std::move(tex.pixels);
                pendingTex.erase(it);
                finishRgbaTexture(
                        id, w, h, std::move(pixels),
                        tex.wrapS, tex.wrapT, tex.colorSpace,
                        tex.magFilter, tex.minFilter, tex.texCoord,
                        tex.offset, tex.repeat);
            }
            return;
        }
        case tn::cmd::OP_TEX_PARAMS: {
            if (!has(p, end, 48)) return;
            const uint32_t id = ru32(p);
            const auto wrapS = wrapFromJs(ru32(p + 4));
            const auto wrapT = wrapFromJs(ru32(p + 8));
            const auto colorSpace = colorSpaceFromJs(ru32(p + 12));
            const auto magFilter = magFilterFromJs(ru32(p + 16));
            const auto minFilter = minFilterFromJs(ru32(p + 20));
            const int texCoord = static_cast<int>(ru32(p + 24));
            const Vector2 offset(rf32(p + 32), rf32(p + 36));
            const Vector2 repeat(rf32(p + 40), rf32(p + 44));
            auto pending = pendingTex.find(id);
            if (pending != pendingTex.end()) {
                pending->second.wrapS = wrapS;
                pending->second.wrapT = wrapT;
                pending->second.colorSpace = colorSpace;
                pending->second.magFilter = magFilter;
                pending->second.minFilter = minFilter;
                pending->second.texCoord = texCoord;
                pending->second.offset.copy(offset);
                pending->second.repeat.copy(repeat);
                return;
            }
            Slot* slot = findSlot(id);
            if (!slot || !slot->texture) return;
            slot->texture->wrapS = wrapS;
            slot->texture->wrapT = wrapT;
            slot->texture->colorSpace = colorSpace;
            slot->texture->magFilter = magFilter;
            slot->texture->minFilter = minFilter;
            slot->texture->texCoord = texCoord;
            slot->texture->offset.copy(offset);
            slot->texture->repeat.copy(repeat);
            slot->texture->generateMipmaps =
                    minFilter != Filter::Nearest && minFilter != Filter::Linear;
            slot->texture->needsUpdate();
            markDirty();
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
            // three.js r152+ names TEXCOORD_1 "uv1"; threepp AO/lightmap still
            // reads the uv2 attribute.
            std::string attrName(nameBuf);
            if (attrName == "uv1") {
                attrName = "uv2";
            }
            slot->geometry->setAttribute(
                    attrName,
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
        case tn::cmd::OP_MAT_NORMAL: {
            if (!has(p, end, 4)) return;
            insertMaterial(ru32(p), MeshNormalMaterial::create());
            return;
        }
        case tn::cmd::OP_MAT_RENDER_STATE: {
            if (!has(p, end, 12)) return;
            auto* slot = findSlot(ru32(p));
            const auto blending = ru32(p + 4), flags = ru32(p + 8);
            if (!slot || !slot->material || blending > 5u) return;
            slot->material->blending = static_cast<Blending>(blending);
            slot->material->depthTest = (flags & 1u) != 0u;
            slot->material->premultipliedAlpha = (flags & 2u) != 0u;
            slot->material->needsUpdate();
            return;
        }
        case tn::cmd::OP_MAT_ALPHA: {
            if (!has(p, end, 16)) return;
            Slot* slot = findSlot(ru32(p));
            if (!slot || !slot->material) return;
            slot->material->opacity = rf32(p + 4);
            slot->material->alphaTest = rf32(p + 8);
            const uint32_t flags = ru32(p + 12);
            slot->material->transparent = (flags & 1u) != 0;
            slot->material->depthWrite = (flags & 2u) != 0;
            slot->material->needsUpdate();
            markDirty();
            return;
        }
        case tn::cmd::OP_MAT_VISIBLE: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            slot->material->visible = ru32(p + 4) != 0;
            slot->material->needsUpdate();
            markDirty();
            return;
        }
        case tn::cmd::OP_CLEAR_COLOR: {
            if (!has(p, end, 8) || !g.renderer) return;
            g.renderer->setClearColor(Color(ru32(p)), rf32(p + 4));
            markDirty();
            return;
        }
        case tn::cmd::OP_TEX_CUBE: {
            if (!has(p, end, 32)) return;
            std::vector<Image> images;
            images.reserve(6);
            for (int i = 0; i < 6; i++) {
                Slot* face = findSlot(ru32(p + 4 + i * 4));
                if (!face || !face->texture || face->texture->images().empty()) {
                    setError("cube texture needs six uploaded faces");
                    return;
                }
                images.push_back(face->texture->image());
            }
            auto cube = CubeTexture::create(images);
            // Command-buffer face uploads are RGBA8. CubeTexture's historical
            // default is RGB, which makes OpenGL advance three bytes per texel
            // through four-byte face data and produces diagonal/moire garbage.
            cube->format = Format::RGBA;
            cube->colorSpace = colorSpaceFromJs(ru32(p + 28));
            cube->needsUpdate();
            Slot slot;
            slot.kind = Kind::Texture;
            slot.texture = std::move(cube);
            insertAt(ru32(p), std::move(slot));
            markDirty();
            return;
        }
        case tn::cmd::OP_MAT_COLOR: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            if (auto* colored = dynamic_cast<MaterialWithColor*>(slot->material.get())) {
                colored->color.setHex(ru32(p + 4));
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_MAT_NORMAL_SCALE: {
            if (!has(p, end, 12)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            if (auto* normal = dynamic_cast<MaterialWithNormalMap*>(slot->material.get())) {
                normal->normalScale.set(rf32(p + 4), rf32(p + 8));
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_SHADER_TEX: {
            if (!has(p, end, 12)) return;
            const uint32_t materialId = ru32(p);
            const uint32_t textureId = ru32(p + 4);
            const uint32_t nameLength = ru32(p + 8);
            if (nameLength == 0 || !has(p + 12, end, nameLength)) return;
            Slot* materialSlot = getSlot(materialId);
            Slot* textureSlot = getSlot(textureId);
            if (!materialSlot || !materialSlot->material || !textureSlot || !textureSlot->texture) return;
            auto* shader = materialSlot->material->as<ShaderMaterial>();
            auto* uniforms = shader ? &shader->uniforms : materialSlot->material->shaderOverride ? &materialSlot->material->shaderOverride->uniforms : nullptr;
            if (!uniforms) return;
            const std::string name(reinterpret_cast<const char*>(p + 12), nameLength);
            if (std::getenv("THREEBROWSER_NATIVE_TERRAIN_TRACE") && name == "tMasks") {
                std::cerr << "terrain native sampler material=" << materialId
                          << " texture=" << textureId
                          << " image=" << textureSlot->texture->image().width()
                          << 'x' << textureSlot->texture->image().height() << '\n';
            }
            const auto retained = std::find(
                    materialSlot->shaderTextures.begin(), materialSlot->shaderTextures.end(), textureSlot->texture);
            if (retained == materialSlot->shaderTextures.end()) {
                materialSlot->shaderTextures.push_back(textureSlot->texture);
            }
            (*uniforms)[name].setValue(textureSlot->texture.get());
            if (shader) shader->uniformsNeedUpdate = true;
            markDirty();
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
            if (!meshSlot || !meshSlot->object || !skelSlot || !skelSlot->skeleton) {
                if (std::getenv("THREEBROWSER_NATIVE_SKIN_TRACE")) {
                    std::cerr << "skin bind missed mesh=" << ru32(p)
                              << " skeleton=" << ru32(p + 4) << '\n';
                }
                return;
            }
            auto skinned = std::dynamic_pointer_cast<SkinnedMesh>(meshSlot->object);
            if (!skinned) return;
            skinned->bind(skelSlot->skeleton);
            if (std::getenv("THREEBROWSER_NATIVE_SKIN_TRACE")) {
                std::cerr << "skin bound mesh=" << ru32(p)
                          << " skeleton=" << ru32(p + 4)
                          << " bones=" << skelSlot->skeleton->bones.size() << '\n';
            }
            markDirty();
            return;
        }
        case tn::cmd::OP_MESH_MAT: {
            if (!has(p, end, 8)) return;
            Slot* meshSlot = getSlot(ru32(p));
            Slot* matSlot = getSlot(ru32(p + 4));
            if (!meshSlot || !meshSlot->object || !matSlot || !matSlot->material) return;
            if (auto owm = std::dynamic_pointer_cast<ObjectWithMaterials>(meshSlot->object)) {
                owm->setMaterial(matSlot->material);
                markDirty();
            } else if (auto sprite = std::dynamic_pointer_cast<Sprite>(meshSlot->object)) {
                auto spriteMat = std::dynamic_pointer_cast<SpriteMaterial>(matSlot->material);
                if (spriteMat) {
                    sprite->setMaterial(spriteMat);
                    markDirty();
                }
            }
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
        case tn::cmd::OP_OBJECT_REMOVE: {
            if (!has(p, end, 8)) return;
            Slot* parent = findSlot(ru32(p));
            Slot* child = findSlot(ru32(p + 4));
            if (!parent || !parent->object || !child || !child->object) return;
            parent->object->remove(*child->object);
            markDirty();
            return;
        }
        case tn::cmd::OP_SLOT_DESTROY: {
            if (!has(p, end, 4)) return;
            destroySlot(ru32(p));
            return;
        }
        case tn::cmd::OP_SET_POSE: {
            if (!has(p, end, 40)) return;
            Object3D* object = findObject(ru32(p));
            if (!object) return;
            object->position.set(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            object->rotation.set(rf32(p + 16), rf32(p + 20), rf32(p + 24));
            object->scale.set(rf32(p + 28), rf32(p + 32), rf32(p + 36));
            return;
        }
        case tn::cmd::OP_SHADER_UNIFORM: {
            if (!has(p, end, 16)) return;
            const auto kind = ru32(p + 4), nameLength = ru32(p + 8), count = ru32(p + 12);
            if (!nameLength || nameLength > 4096 || count > 1048576) return;
            const auto nameSize = (nameLength + 3u) & ~3u;
            if (!has(p + 16, end, nameSize + count * 4u)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            auto* shader = slot->material->as<ShaderMaterial>();
            auto* uniforms = shader ? &shader->uniforms : slot->material->shaderOverride ? &slot->material->shaderOverride->uniforms : nullptr;
            if (!uniforms) return;
            const std::string name(reinterpret_cast<const char*>(p + 16), nameLength);
            const auto* data = p + 16 + nameSize;
            auto& uniform = (*uniforms)[name];
            if (kind == 1 && count == 1) uniform.setValue(rf32(data));
            else if (kind == 2 && count == 1) uniform.setValue(static_cast<int32_t>(ru32(data)));
            else if (kind == 3 && count == 2) uniform.setValue(Vector2(rf32(data), rf32(data + 4)));
            else if (kind == 4 && count == 3) uniform.setValue(Vector3(rf32(data), rf32(data + 4), rf32(data + 8)));
            else if (kind == 5 && count == 4) uniform.setValue(Vector4(rf32(data), rf32(data + 4), rf32(data + 8), rf32(data + 12)));
            else if (kind == 6 && count == 9) {
                std::array<float, 9> values{};
                for (size_t i = 0; i < values.size(); ++i) values[i] = rf32(data + i * 4);
                Matrix3 matrix; matrix.fromArray(values); uniform.setValue(matrix);
            } else if (kind == 7 && count == 16) {
                std::array<float, 16> values{};
                for (size_t i = 0; i < values.size(); ++i) values[i] = rf32(data + i * 4);
                Matrix4 matrix; matrix.fromArray(values); uniform.setValue(matrix);
            } else if (kind == 8) {
                std::vector<float> values(count);
                for (size_t i = 0; i < count; ++i) values[i] = rf32(data + i * 4);
                uniform.setValue(std::move(values));
            } else if (kind == 9 && count % 2 == 0) {
                std::vector<Vector2> values;
                for (size_t i = 0; i < count; i += 2) values.emplace_back(rf32(data + i * 4), rf32(data + (i + 1) * 4));
                uniform.setValue(std::move(values));
            } else if (kind == 10 && count % 3 == 0) {
                std::vector<Vector3> values;
                for (size_t i = 0; i < count; i += 3) values.emplace_back(rf32(data + i * 4), rf32(data + (i + 1) * 4), rf32(data + (i + 2) * 4));
                uniform.setValue(std::move(values));
            } else if (kind == 11 && count % 9 == 0) {
                std::vector<Matrix3> values(count / 9);
                for (size_t i = 0; i < values.size(); ++i) {
                    std::array<float, 9> v{};
                    for (size_t j = 0; j < 9; ++j) v[j] = rf32(data + (i * 9 + j) * 4);
                    values[i].fromArray(v);
                }
                uniform.setValue(std::move(values));
            } else if (kind == 12 && count % 16 == 0) {
                std::vector<Matrix4> values(count / 16);
                for (size_t i = 0; i < values.size(); ++i) {
                    std::array<float, 16> v{};
                    for (size_t j = 0; j < 16; ++j) v[j] = rf32(data + (i * 16 + j) * 4);
                    values[i].fromArray(v);
                }
                uniform.setValue(std::move(values));
            } else return;
            if (shader) shader->uniformsNeedUpdate = true;
            markDirty();
            return;
        }
        case tn::cmd::OP_MAT_VERTEX_COLORS: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->material) return;
            const bool enabled = ru32(p + 4) != 0;
            if (slot->material->vertexColors != enabled) {
                slot->material->vertexColors = enabled;
                slot->material->needsUpdate();
                markDirty();
            }
            return;
        }
        case tn::cmd::OP_SET_POSE_QUAT: {
            if (!has(p, end, 44)) return;
            Object3D* object = findObject(ru32(p));
            if (!object) return;
            object->position.set(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            object->quaternion.set(rf32(p + 16), rf32(p + 20), rf32(p + 24), rf32(p + 28));
            object->scale.set(rf32(p + 32), rf32(p + 36), rf32(p + 40));
            return;
        }
        case tn::cmd::OP_LOOK_AT: {
            if (!has(p, end, 16)) return;
            Object3D* object = findObject(ru32(p));
            if (object) object->lookAt(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            return;
        }
        case tn::cmd::OP_LOOK_FROM: {
            if (!has(p, end, 28)) return;
            Object3D* object = findObject(ru32(p));
            if (!object) return;
            object->position.set(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            object->lookAt(rf32(p + 16), rf32(p + 20), rf32(p + 24));
            return;
        }
        case tn::cmd::OP_SET_VISIBLE: {
            if (!has(p, end, 8)) return;
            Object3D* object = findObject(ru32(p));
            if (!object) return;
            object->visible = ru32(p + 4) != 0;
            return;
        }
        case tn::cmd::OP_LIGHT_AMBIENT: {
            if (!has(p, end, 12)) return;
            insertObject(ru32(p), Kind::Object,
                    AmbientLight::create(Color(ru32(p + 4)), rf32(p + 8)));
            return;
        }
        case tn::cmd::OP_OBJECT_FLAGS: {
            if (!has(p,end,12)) return;
            auto* object=findObject(ru32(p)); if(!object) return;
            const auto flags=ru32(p+4),mask=ru32(p+8);
            object->castShadow=(flags&1u)!=0; object->receiveShadow=(flags&2u)!=0;
            object->layers.disableAll();
            for(unsigned int i=0;i<32;++i) if(mask&(1u<<i)) object->layers.enable(i);
            return;
        }
        case tn::cmd::OP_SHADOW_STATE: {
            if(!has(p,end,8)||!g.renderer) return;
            auto& shadow=g.renderer->shadowMap(); const auto flags=ru32(p);
            shadow.enabled=(flags&1u)!=0; shadow.autoUpdate=(flags&2u)!=0; shadow.needsUpdate=(flags&4u)!=0;
            shadow.type=static_cast<ShadowMap>(std::min(3u,ru32(p+4))); return;
        }
        case tn::cmd::OP_LIGHT_SHADOW: {
            if(!has(p,end,100)) return;
            auto* light=dynamic_cast<LightWithShadow*>(findObject(ru32(p))); if(!light||!light->shadow) return;
            auto& shadow=*light->shadow;
            const Vector2 size(std::clamp(rf32(p+8),1.f,8192.f),std::clamp(rf32(p+12),1.f,8192.f));
            if(shadow.mapSize!=size) shadow.dispose();
            shadow.mapSize.copy(size);
            const auto flags=ru32(p+4); shadow.autoUpdate=(flags&1u)!=0; shadow.needsUpdate=(flags&2u)!=0;
            shadow.bias=rf32(p+16); shadow.normalBias=rf32(p+20); shadow.radius=rf32(p+24);
            shadow.camera->nearPlane=rf32(p+28); shadow.camera->farPlane=rf32(p+32);
            std::array<float,16> values{}; for(size_t i=0;i<16;++i) values[i]=rf32(p+36+i*4);
            shadow.camera->projectionMatrix.fromArray(values);
            shadow.camera->projectionMatrixInverse.copy(shadow.camera->projectionMatrix).invert();
            return;
        }
        case tn::cmd::OP_SHADOW_TEXTURE: {
            if(!has(p,end,8)) return;
            auto* light=dynamic_cast<LightWithShadow*>(findObject(ru32(p))); if(!light||!light->shadow||!light->shadow->map) return;
            Slot slot; slot.kind=Kind::Texture; slot.texture=light->shadow->map->texture;
            insertAt(ru32(p+4),std::move(slot)); return;
        }
        case tn::cmd::OP_LIGHT_STATE: {
            if (!has(p, end, 44)) return;
            auto* light = dynamic_cast<Light*>(findObject(ru32(p)));
            if (!light) return;
            light->color.setRGB(rf32(p + 4), rf32(p + 8), rf32(p + 12));
            light->intensity = rf32(p + 16);
            if (auto* hemi = dynamic_cast<HemisphereLight*>(light)) hemi->groundColor.setRGB(rf32(p + 20), rf32(p + 24), rf32(p + 28));
            if (auto* directional = dynamic_cast<LightWithTarget*>(light)) {
                auto& target = const_cast<Object3D&>(directional->target());
                target.position.set(rf32(p + 32), rf32(p + 36), rf32(p + 40));
                target.updateMatrixWorld(true);
            }
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
        case tn::cmd::OP_INST_COUNT: {
            if (!has(p, end, 8)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            auto inst = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!inst) return;
            inst->setCount(static_cast<size_t>(ru32(p + 4)));
            inst->boundingSphere.reset();
            if (inst->count() > 0) inst->computeBoundingSphere();
            markDirty();
            return;
        }
        case tn::cmd::OP_INST_MATRICES: {
            if (!has(p, end, 12)) return;
            Slot* slot = getSlot(ru32(p));
            if (!slot || !slot->object) return;
            auto inst = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!inst) return;
            const uint32_t start = ru32(p + 4);
            const uint32_t count = ru32(p + 8);
            const size_t bytes = static_cast<size_t>(count) * 64u;
            if (!has(p, end, 12 + bytes)) return;
            Matrix4 m;
            std::array<float, 16> e{};
            const uint8_t* cur = p + 12;
            for (uint32_t i = 0; i < count; i++) {
                std::memcpy(e.data(), cur + static_cast<size_t>(i) * 64u, 64);
                m.fromArray(e);
                inst->setMatrixAt(static_cast<size_t>(start + i), m);
            }
            inst->instanceMatrix()->needsUpdate();
            inst->boundingSphere.reset();
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
        std::vector<uint8_t> copy(data, data + nbytes);
        return onWorker([buf = std::move(copy)] {
            execStream(buf.data(), static_cast<int>(buf.size()));
            // A frame command is not complete until the renderer has consumed
            // it. Returning before presentation lets the JS animation loop run
            // ahead of the native camera and produces visible bursts/stalls.
            renderPendingFrame();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_cmd_submit_async(const uint8_t* data, int nbytes) {
    try {
        if (!data || nbytes <= 0) {
            return 1;
        }
        std::vector<uint8_t> copy(data, data + nbytes);
        onWorkerAsync([buf = std::move(copy)] {
            execStream(buf.data(), static_cast<int>(buf.size()));
        });
        return 1;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

#include "three_native.h"
#include "runtime_internal.hpp"

#include "threepp/cameras/CubeCamera.hpp"
#include "threepp/cameras/OrthographicCamera.hpp"
#include "threepp/core/BufferAttribute.hpp"
#include "threepp/core/BufferGeometry.hpp"
#include "threepp/lights/DirectionalLight.hpp"
#include "threepp/lights/HemisphereLight.hpp"
#include "threepp/materials/RawShaderMaterial.hpp"
#include "threepp/objects/Mesh.hpp"
#include "threepp/renderers/GLRenderer.hpp"
#include "threepp/renderers/GLCubeRenderTarget.hpp"
#include "threepp/renderers/RenderTarget.hpp"
#include "threepp/renderers/gl/GLPMREM.hpp"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

using namespace tn;

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr int kEqW = 256;
constexpr int kEqH = 128;

struct SkyParams {
    Vector3 sunPosition{1.f, 0.45f, 0.25f};
    float turbidity{2.f};
    float rayleigh{1.f};
    float mieCoefficient{0.005f};
    float mieDirectionalG{0.8f};
};

float smoothstep(float edge0, float edge1, float x) {
    const float t = std::clamp((x - edge0) / (edge1 - edge0), 0.f, 1.f);
    return t * t * (3.f - 2.f * t);
}

Vector3 pow3(const Vector3& v, float p) {
    return {
            std::pow(std::max(v.x, 0.f), p),
            std::pow(std::max(v.y, 0.f), p),
            std::pow(std::max(v.z, 0.f), p)};
}

Vector3 evalSky(const Vector3& direction, const SkyParams& params) {
    Vector3 sunDir = params.sunPosition;
    if (sunDir.lengthSq() < 1e-10f) {
        sunDir.set(1.f, 0.45f, 0.25f);
    }
    sunDir.normalize();

    const Vector3 up(0.f, 1.f, 0.f);
    constexpr float e = 2.718281828459045f;
    constexpr float cutoffAngle = 1.6110731556870734f;
    constexpr float steepness = 1.5f;
    constexpr float EE = 1000.f;
    const float zenithAngleCos = std::clamp(sunDir.dot(up), -1.f, 1.f);
    const float sunE = EE * std::max(
                                    0.f,
                                    1.f - std::pow(e, -((cutoffAngle - std::acos(zenithAngleCos)) / steepness)));

    const float sunY = params.sunPosition.y;
    const float sunfade = 1.f - std::clamp(1.f - std::exp(sunY / 450000.f), 0.f, 1.f);
    const float rayleighCoefficient = params.rayleigh - (1.f - sunfade);

    const Vector3 totalRayleigh(5.804542996261093e-6f, 1.3562911419845635e-5f, 3.0265902468824876e-5f);
    const Vector3 mieConst(1.8399918514433978e14f, 2.7798023919660528e14f, 4.0790479543861094e14f);
    const float c = (0.2f * params.turbidity) * 1.0e-17f;
    const Vector3 totalMie = mieConst * (0.434f * c);

    const Vector3 betaR = totalRayleigh * std::max(rayleighCoefficient, 0.f);
    const Vector3 betaM = totalMie * params.mieCoefficient;

    Vector3 dir = direction;
    dir.normalize();

    const float zenithAngle = std::acos(std::max(0.f, up.dot(dir)));
    const float denomZenith = std::cos(zenithAngle) +
                              0.15f * std::pow(std::max(93.885f - ((zenithAngle * 180.f) / kPi), 0.01f), -1.253f);
    const float inverse = 1.f / std::max(denomZenith, 1e-4f);
    const float sR = 8.4e3f * inverse;
    const float sM = 1.25e3f * inverse;

    const Vector3 Fex{
            std::exp(-(betaR.x * sR + betaM.x * sM)),
            std::exp(-(betaR.y * sR + betaM.y * sM)),
            std::exp(-(betaR.z * sR + betaM.z * sM))};

    const float cosTheta = dir.dot(sunDir);
    constexpr float threeOverSixteenPi = 0.05968310365946075f;
    constexpr float oneOverFourPi = 0.07957747154594767f;
    const float rPhase = threeOverSixteenPi * (1.f + std::pow(cosTheta * 0.5f + 0.5f, 2.f));
    const Vector3 betaRTheta = betaR * rPhase;

    const float g = params.mieDirectionalG;
    const float g2 = g * g;
    const float hgInv = 1.f / std::pow(std::max(1.f - 2.f * g * cosTheta + g2, 1e-6f), 1.5f);
    const float mPhase = oneOverFourPi * ((1.f - g2) * hgInv);
    const Vector3 betaMTheta = betaM * mPhase;

    auto scatter = [&](float fex, float br, float bm, float brt, float bmt) {
        const float d = std::max(br + bm, 1e-20f);
        return sunE * ((brt + bmt) / d) * fex;
    };

    Vector3 Lin{
            scatter(1.f - Fex.x, betaR.x, betaM.x, betaRTheta.x, betaMTheta.x),
            scatter(1.f - Fex.y, betaR.y, betaM.y, betaRTheta.y, betaMTheta.y),
            scatter(1.f - Fex.z, betaR.z, betaM.z, betaRTheta.z, betaMTheta.z)};
    Lin = pow3(Lin, 1.5f);

    const float mixF = std::clamp(std::pow(1.f - up.dot(sunDir), 5.f), 0.f, 1.f);
    Vector3 Lin2{
            scatter(Fex.x, betaR.x, betaM.x, betaRTheta.x, betaMTheta.x),
            scatter(Fex.y, betaR.y, betaM.y, betaRTheta.y, betaMTheta.y),
            scatter(Fex.z, betaR.z, betaM.z, betaRTheta.z, betaMTheta.z)};
    Lin2 = pow3(Lin2, 0.5f);
    Lin.x *= (1.f - mixF) + mixF * Lin2.x;
    Lin.y *= (1.f - mixF) + mixF * Lin2.y;
    Lin.z *= (1.f - mixF) + mixF * Lin2.z;

    Vector3 L0 = Fex * 0.1f;
    const float glow = std::pow(std::max(cosTheta, 0.f), 48.f);
    L0 += Fex * (sunE * 8.f * glow);

    // Linear radiance for PMREM (no display gamma).
    Vector3 color = (Lin + L0) * 0.04f;
    color.y += 0.0003f;
    color.z += 0.00075f;
    color.x = std::min(color.x, 40.f);
    color.y = std::min(color.y, 40.f);
    color.z = std::min(color.z, 40.f);
    return color;
}

std::shared_ptr<Texture> makeEquirect(const SkyParams& params) {
    std::vector<float> rgba(static_cast<size_t>(kEqW) * static_cast<size_t>(kEqH) * 4u);
    for (int y = 0; y < kEqH; ++y) {
        // Row 0 is GL t=0 = south pole (matches GLPMREM dirFromUv).
        const float v = (static_cast<float>(y) + 0.5f) / static_cast<float>(kEqH);
        const float lat = (v - 0.5f) * kPi;
        const float cosLat = std::cos(lat);
        const float sinLat = std::sin(lat);
        for (int x = 0; x < kEqW; ++x) {
            const float u = (static_cast<float>(x) + 0.5f) / static_cast<float>(kEqW);
            const float lon = (u - 0.5f) * 2.f * kPi;
            const Vector3 dir(cosLat * std::cos(lon), sinLat, cosLat * std::sin(lon));
            const Vector3 c = evalSky(dir, params);
            const size_t i = (static_cast<size_t>(y) * static_cast<size_t>(kEqW) + static_cast<size_t>(x)) * 4u;
            rgba[i + 0] = c.x;
            rgba[i + 1] = c.y;
            rgba[i + 2] = c.z;
            rgba[i + 3] = 1.f;
        }
    }

    std::vector<Image> images;
    images.emplace_back(std::move(rgba), static_cast<unsigned>(kEqW), static_cast<unsigned>(kEqH), 0u);
    auto texture = Texture::create(std::move(images));
    texture->name = "PMREM.skyEquirect";
    texture->format = Format::RGBA;
    texture->type = Type::Float;
    texture->colorSpace = ColorSpace::Linear;
    texture->mapping = Mapping::EquirectangularReflection;
    texture->wrapS = TextureWrapping::Repeat;
    texture->wrapT = TextureWrapping::ClampToEdge;
    texture->magFilter = Filter::Linear;
    texture->minFilter = Filter::LinearMipmapLinear;
    texture->generateMipmaps = true;
    texture->needsUpdate();
    return texture;
}

std::shared_ptr<Texture> asIblEquirect(const std::shared_ptr<Texture>& source) {
    if (!source) {
        return nullptr;
    }
    if (source->mapping == Mapping::EquirectangularReflection ||
        source->mapping == Mapping::EquirectangularRefraction ||
        source->mapping == Mapping::CubeUVReflection) {
        return source;
    }
    auto clone = source->clone();
    clone->mapping = Mapping::EquirectangularReflection;
    clone->wrapS = TextureWrapping::Repeat;
    clone->needsUpdate();
    return clone;
}

// Bake CubeUV on the GL worker so GLRenderer::getPMREM never GGX-filters on
// present (that used to freeze the UI). Vulkan prefilters the equirect itself.
bool bakeCubeUv(Slot& slot) {
    if (!slot.texture) {
        return false;
    }
    if (slot.texture->mapping == Mapping::CubeUVReflection) {
        return true;
    }
    auto* gl = dynamic_cast<GLRenderer*>(g.renderer.get());
    if (!gl) {
        return true;
    }
    try {
        gl::GLPMREM generator(*gl);
        auto target = generator.fromEquirectangular(*slot.texture);
        if (!target || !target->texture) {
            return false;
        }
        slot.texture = target->texture;
        slot.renderTarget = std::move(target);
        return true;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return false;
    } catch (...) {
        setError("pmrem cubeuv bake failed");
        return false;
    }
}

uint32_t pmremFromTexture(uint32_t id, std::shared_ptr<Texture> equirect) {
    if (!equirect) {
        setError("pmrem needs an equirect texture");
        return 0;
    }
    Slot slot;
    slot.kind = Kind::Texture;
    slot.texture = std::move(equirect);
    bakeCubeUv(slot);
    if (id != 0) {
        return insertAt(id, std::move(slot));
    }
    return insert(std::move(slot));
}

std::shared_ptr<BufferGeometry> makeFullscreenQuad() {
    const std::vector<float> positions = {
            -1.f, -1.f, 0.f, 1.f, -1.f, 0.f, 1.f, 1.f, 0.f,
            -1.f, -1.f, 0.f, 1.f, 1.f, 0.f, -1.f, 1.f, 0.f};
    const std::vector<float> uvs = {
            0.f, 0.f, 1.f, 0.f, 1.f, 1.f,
            0.f, 0.f, 1.f, 1.f, 0.f, 1.f};
    auto geom = BufferGeometry::create();
    geom->setAttribute("position", FloatBufferAttribute::create(positions, 3));
    geom->setAttribute("uv", FloatBufferAttribute::create(uvs, 2));
    return geom;
}

// Capture whatever mesh/scene the page passed to PMREMGenerator.fromScene
// (the live ShaderMaterial already on the object).
std::unique_ptr<RenderTarget> captureObjectEquirect(GLRenderer& gl, Object3D& object) {
    RenderTarget::Options cubeOpts;
    cubeOpts.type = Type::Float;
    cubeOpts.format = Format::RGBA;
    cubeOpts.encoding = ColorSpace::Linear;
    cubeOpts.generateMipmaps = false;
    cubeOpts.depthBuffer = true;
    auto cubeRT = std::make_unique<GLCubeRenderTarget>(128, cubeOpts);

    object.updateMatrixWorld(true);
    const auto oldTone = gl.toneMapping;
    const bool oldClear = gl.autoClear;
    auto* oldTarget = gl.getRenderTarget();
    gl.toneMapping = ToneMapping::None;
    CubeCamera cubeCam(0.1f, 100000.f, *cubeRT);
    cubeCam.update(gl, object);

    RenderTarget::Options eqOpts;
    eqOpts.type = Type::Float;
    eqOpts.format = Format::RGBA;
    eqOpts.encoding = ColorSpace::Linear;
    eqOpts.generateMipmaps = true;
    eqOpts.depthBuffer = false;
    eqOpts.wrapS = TextureWrapping::Repeat;
    eqOpts.wrapT = TextureWrapping::ClampToEdge;
    eqOpts.minFilter = Filter::LinearMipmapLinear;
    eqOpts.magFilter = Filter::Linear;
    auto equirectRT = RenderTarget::create(kEqW, kEqH, eqOpts);
    equirectRT->texture->mapping = Mapping::EquirectangularReflection;
    equirectRT->texture->colorSpace = ColorSpace::Linear;

    auto mat = RawShaderMaterial::create();
    mat->depthTest = false;
    mat->depthWrite = false;
    mat->side = Side::Double;
    mat->vertexShader = R"(#version 330 core
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
)";
    mat->fragmentShader = R"(#version 330 core
in vec2 vUv;
out vec4 fragColor;
uniform samplerCube envMap;
#define PI  3.14159265359
#define PI2 6.28318530718
void main() {
    float phi = (vUv.x - 0.5) * PI2;
    float theta = (vUv.y - 0.5) * PI;
    float cosT = cos(theta);
    vec3 dir = normalize(vec3(cosT * cos(phi), sin(theta), cosT * sin(phi)));
    fragColor = vec4(texture(envMap, dir).rgb, 1.0);
}
)";
    mat->uniforms["envMap"].setValue(cubeRT->texture.get());
    mat->envMap = cubeRT->texture;

    Mesh blit(makeFullscreenQuad(), mat);
    blit.frustumCulled = false;
    auto blitCam = OrthographicCamera::create();
    gl.autoClear = true;
    gl.setRenderTarget(equirectRT.get());
    gl.render(blit, *blitCam);

    gl.toneMapping = oldTone;
    gl.autoClear = oldClear;
    gl.setRenderTarget(oldTarget);
    return equirectRT;
}

SkyParams lastSky{};

Color toColor(const Vector3& v) {
    const float m = std::max({v.x, v.y, v.z, 1.f});
    return Color(v.x / m, v.y / m, v.z / m);
}

void clearSkyLights(Scene* scene) {
    if (g.envHemi) {
        if (scene) {
            scene->remove(*g.envHemi);
        }
        g.envHemi.reset();
    }
    if (g.envSun) {
        if (scene) {
            scene->remove(*g.envSun);
        }
        g.envSun.reset();
    }
}

void applySkyLights(Scene* scene) {
    if (!scene) {
        return;
    }
    clearSkyLights(scene);
    const Vector3 skyCol = evalSky(Vector3(0.f, 1.f, 0.f), lastSky);
    const Vector3 gndCol = evalSky(Vector3(0.f, -1.f, 0.f), lastSky);
    auto hemi = HemisphereLight::create(toColor(skyCol), toColor(gndCol), 1.2f);
    auto sun = DirectionalLight::create(Color(0xffffff), 2.8f);
    sun->position.copy(lastSky.sunPosition);
    if (sun->position.lengthSq() < 1e-8f) {
        sun->position.set(-0.8f, 0.19f, 0.56f);
    }
    scene->add(hemi);
    scene->add(sun);
    g.envHemi = std::move(hemi);
    g.envSun = std::move(sun);
}

SkyParams defaultsFromArgs(
        float sunX, float sunY, float sunZ,
        float turbidity, float rayleigh,
        float mieCoefficient, float mieDirectionalG) {
    SkyParams p;
    p.sunPosition.set(sunX, sunY, sunZ);
    if (p.sunPosition.lengthSq() < 1e-10f) {
        p.sunPosition.set(1.f, 0.45f, 0.25f);
    }
    p.turbidity = turbidity >= 0.f ? turbidity : 2.f;
    p.rayleigh = rayleigh >= 0.f ? rayleigh : 1.f;
    p.mieCoefficient = mieCoefficient > 0.f ? mieCoefficient : 0.005f;
    p.mieDirectionalG = mieDirectionalG > 0.f ? mieDirectionalG : 0.8f;
    return p;
}

}// namespace

void tn::applyPendingEnvironment() {
    auto it = g.pendingEnvironment.begin();
    while (it != g.pendingEnvironment.end()) {
        auto sceneIt = g.slots.find(it->first);
        if (sceneIt == g.slots.end() || sceneIt->second.kind != Kind::Scene || !sceneIt->second.object) {
            ++it;
            continue;
        }
        auto* scene = dynamic_cast<Scene*>(sceneIt->second.object.get());
        if (!scene) {
            ++it;
            continue;
        }
        std::shared_ptr<Texture> env;
        if (it->second != 0) {
            auto texIt = g.slots.find(it->second);
            if (texIt != g.slots.end() && texIt->second.kind == Kind::Texture && texIt->second.texture) {
                bakeCubeUv(texIt->second);
                env = texIt->second.texture;
            }
        }
        // Stock examples (keyframes) light MeshStandard materials only via
        // scene.environment. Assign the CubeUV (or Vulkan equirect) here —
        // never extra hemi/sun on top of a real env (that would double-light).
        scene->environment = env;
        clearSkyLights(scene);
        it = g.pendingEnvironment.erase(it);
        markDirty();
    }
}

void tn_scene_set_environment(uint32_t sceneHandle, uint32_t textureHandle) {
    try {
        onWorker([sceneHandle, textureHandle] {
            g.pendingEnvironment[sceneHandle] = textureHandle;
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_pmrem_from_sky(
        uint32_t id,
        float sunX, float sunY, float sunZ,
        float turbidity, float rayleigh,
        float mieCoefficient, float mieDirectionalG) {
    try {
        return onWorker([=] {
            lastSky = defaultsFromArgs(
                    sunX, sunY, sunZ, turbidity, rayleigh, mieCoefficient, mieDirectionalG);
            auto equirect = makeEquirect(lastSky);
            return pmremFromTexture(id, std::move(equirect));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_pmrem_from_equirect(uint32_t id, uint32_t textureHandle) {
    try {
        return onWorker([=] {
            std::shared_ptr<Texture> source;
            if (textureHandle != 0) {
                auto it = g.slots.find(textureHandle);
                if (it != g.slots.end()) {
                    source = asIblEquirect(it->second.texture);
                }
            }
            if (!source) {
                logLine("pmrem from equirect: no source texture");
                return 0u;
            }
            return pmremFromTexture(id, std::move(source));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_pmrem_from_cubemap(uint32_t id, uint32_t textureHandle) {
    return tn_pmrem_from_equirect(id, textureHandle);
}

uint32_t tn_pmrem_from_object(uint32_t id, uint32_t objectHandle) {
    try {
        return onWorker([=] {
            Object3D* object = findObject(objectHandle);
            auto* gl = dynamic_cast<GLRenderer*>(g.renderer.get());
            if (!object) {
                logLine(("pmrem from object: missing object id=" +
                         std::to_string(objectHandle))
                                .c_str());
                return 0u;
            }
            if (!gl) {
                logLine("pmrem from object: renderer is not OpenGL");
                return 0u;
            }
            try {
                auto captured = captureObjectEquirect(*gl, *object);
                if (captured && captured->texture) {
                    return pmremFromTexture(id, captured->texture);
                }
                logLine("pmrem from object: capture returned no texture");
            } catch (const std::exception& ex) {
                std::string msg = std::string("pmrem from object: shader/capture failed: ") + ex.what();
                setError(msg.c_str());
            } catch (...) {
                setError("pmrem from object failed");
            }
            return 0u;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

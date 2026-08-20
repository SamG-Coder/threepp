#include "three_native.h"
#include "runtime_internal.hpp"

using namespace tn;

uint32_t tn_orthographic_camera_create(
        float left, float right, float top, float bottom, float near_plane, float far_plane) {
    try {
        return onWorker([=] {
            auto camera = OrthographicCamera::create(left, right, top, bottom, near_plane, far_plane);
            Slot slot;
            slot.kind = Kind::Camera;
            slot.object = camera;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_orthographic_camera_update(
        uint32_t camera, float left, float right, float top, float bottom,
        float near_plane, float far_plane, float zoom) {
    try {
        onWorker([=] {
            Slot* slot = getSlot(camera);
            if (!slot || slot->kind != Kind::Camera || !slot->object) {
                return;
            }
            if (auto cam = std::dynamic_pointer_cast<OrthographicCamera>(slot->object)) {
                cam->left = left;
                cam->right = right;
                cam->top = top;
                cam->bottom = bottom;
                cam->nearPlane = near_plane;
                cam->farPlane = far_plane;
                cam->zoom = zoom;
                cam->updateProjectionMatrix();
                markDirty();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_spot_light_create(
        uint32_t color, float intensity, float distance, float angle, float penumbra, float decay) {
    try {
        return onWorker([=] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = SpotLight::create(Color(color), intensity, distance, angle, penumbra, decay);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_scene_set_fog(uint32_t scene, uint32_t color, float near_plane, float far_plane) {
    try {
        onWorker([=] {
            Slot* slot = getSlot(scene);
            if (!slot || slot->kind != Kind::Scene) {
                return;
            }
            if (auto* sc = dynamic_cast<Scene*>(slot->object.get())) {
                sc->fog = Fog(Color(color), near_plane, far_plane);
                markDirty();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_scene_set_fog_exp2(uint32_t scene, uint32_t color, float density) {
    try {
        onWorker([=] {
            Slot* slot = getSlot(scene);
            if (!slot || slot->kind != Kind::Scene) {
                return;
            }
            if (auto* sc = dynamic_cast<Scene*>(slot->object.get())) {
                sc->fog = FogExp2(Color(color), density);
                markDirty();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

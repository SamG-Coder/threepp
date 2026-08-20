#include "three_native.h"

#include <chrono>
#include <iostream>
#include <thread>

int main() {
    if (!tn_runtime_start(640, 480, "ThreeBrowser smoke")) {
        std::cerr << "start failed: " << tn_last_error() << '\n';
        return 1;
    }
    const uint32_t scene = tn_scene_create();
    const uint32_t camera = tn_perspective_camera_create(75.f, tn_runtime_aspect(), 0.1f, 100.f);
    tn_object_set_position(camera, 0, 0, 5);
    tn_object_add(scene, tn_hemisphere_light_create());
    const uint32_t mesh = tn_mesh_create(
            tn_box_geometry_create(1, 1, 1),
            tn_mesh_standard_material_create(0x22cc66));
    tn_object_add(scene, mesh);

    tn_runtime_render(scene, camera);
    float y = 0;
    for (int i = 0; i < 90; ++i) {
        y += 0.06f;
        tn_object_set_rotation(mesh, 0.4f, y, 0);
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }
    tn_runtime_shutdown();
    std::cout << "SMOKE OK\n";
    return 0;
}

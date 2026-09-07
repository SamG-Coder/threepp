
#include "threepp/renderers/gl/GLObjects.hpp"

#include "threepp/objects/InstancedMesh.hpp"
#include <algorithm>
#include "threepp/renderers/gl/GLAttributes.hpp"
#include "threepp/renderers/gl/GLGeometries.hpp"
#include "threepp/renderers/gl/GLInfo.hpp"

#if !defined(__EMSCRIPTEN__) && !defined(__ANDROID__)
#include <glad/glad.h>
#else
#include <GLES3/gl3.h>
#endif

using namespace threepp;
using namespace threepp::gl;


struct GLObjects::Impl {

    GLInfo& info_;
    GLGeometries& geometries_;
    GLAttributes& attributes_;

    std::unordered_map<BufferGeometry*, size_t> updateMap_;
    // Handles outlive their dispatchers safely; raw mesh pointers do not.
    std::unordered_map<unsigned, Subscription> registeredInstancedMeshes_;

    Impl(GLGeometries& geometries, GLAttributes& attributes, GLInfo& info)
        : info_(info),
          geometries_(geometries),
          attributes_(attributes) {}

    BufferGeometry* update(Object3D* object) {

        const auto frame = info_.render.frame;

        const auto geometry = object->geometry().get();
        geometries_.get(object, geometry);

        // Update once per frame

        if (!updateMap_.contains(geometry) || updateMap_[geometry] != frame) {

            geometries_.update(geometry);

            updateMap_[geometry] = frame;
        }

        if (auto instancedMesh = object->as<InstancedMesh>()) {

            if (!registeredInstancedMeshes_.contains(object->id)) {
                registeredInstancedMeshes_.emplace(object->id, object->subscribe("dispose", [this](Event& event) {
                    auto* mesh = std::any_cast<InstancedMesh*>(event.target);
                    attributes_.remove(mesh->instanceMatrix());
                    if (mesh->instanceColor()) attributes_.remove(mesh->instanceColor());
                    registeredInstancedMeshes_.erase(mesh->id);
                }));
            }

            attributes_.update(instancedMesh->instanceMatrix(), GL_ARRAY_BUFFER);

            if (instancedMesh->instanceColor() != nullptr) {

                attributes_.update(instancedMesh->instanceColor(), GL_ARRAY_BUFFER);
            }
        }

        return geometry;
    }

    void dispose() {

        registeredInstancedMeshes_.clear();
        updateMap_.clear();
    }
};

BufferGeometry* GLObjects::update(Object3D* object) {

    return pimpl_->update(object);
}

gl::GLObjects::GLObjects(GLGeometries& geometries, GLAttributes& attributes, GLInfo& info)
    : pimpl_(std::make_unique<Impl>(geometries, attributes, info)) {}

void gl::GLObjects::dispose() {

    pimpl_->dispose();
}

GLObjects::~GLObjects() = default;

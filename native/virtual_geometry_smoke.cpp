#include "threepp/threepp.hpp"
#include "threepp/renderers/RenderTarget.hpp"
#include "threepp/renderers/shaders/ShaderLib.hpp"
#include "../src/threepp/renderers/gl/GLStaticVertexProof.hpp"
#include <glad/glad.h>
#include <iostream>
#include <stdexcept>
#include <chrono>

using namespace threepp;
static PFNGLVERTEXATTRIBPOINTERPROC originalAttributePointer{};
static unsigned attributePointerCalls{};
static void APIENTRY countAttributePointer(GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void* pointer) {
    ++attributePointerCalls;
    originalAttributePointer(index, size, type, normalized, stride, pointer);
}

static void require(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
    std::cout << std::unitbuf;
    try {
        Canvas canvas(Canvas::Parameters().size(512, 384).headless(true).computeContext(true));
        GLRenderer renderer(canvas);
        GLint major = 0, minor = 0;
        glGetIntegerv(GL_MAJOR_VERSION, &major);
        glGetIntegerv(GL_MINOR_VERSION, &minor);
        std::cout << "GPU: " << glGetString(GL_RENDERER) << ", GL " << glGetString(GL_VERSION) << '\n';
        require(major > 4 || (major == 4 && minor >= 3), "GPU test requires OpenGL 4.3");
        auto target = RenderTarget::create(512, 384, RenderTarget::Options{});
        renderer.setRenderTarget(target.get());
        auto scene = Scene::create();
        auto camera = PerspectiveCamera::create(55, 512.f / 384.f, .1f, 100);
        camera->position.z = 4;
        auto geometry = PlaneGeometry::create(20, 20, 128, 128);
        auto material = MeshPhongMaterial::create();
        const auto& proofStock = shaders::ShaderLib::instance().phong.vertexShader;
        {
            auto source=std::string("varying vec3 diagnosticAffine;\n")+proofStock;
            const std::string marker="#include <fog_vertex>";
            source.insert(source.find(marker)+marker.size(),"\nvec4 proofPoint=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nproofPoint=instanceMatrix*proofPoint;\n#endif\ndiagnosticAffine=(modelMatrix*proofPoint).xyz;\n");
            require(gl::hasStaticVertexAdditions(proofStock,source,true),"Affine world-position varying was rejected");
            const auto position=source.find("diagnosticAffine=(modelMatrix*proofPoint).xyz;");
            source.replace(position,std::string("diagnosticAffine=(modelMatrix*proofPoint).xyz;").size(),"diagnosticAffine=vec3(length(proofPoint.xyz));");
            require(gl::hasStaticVertexAdditions(proofStock,source),"Pure distance varying was rejected for static bounds");
            require(!gl::hasStaticVertexAdditions(proofStock,source,true),"Nonlinear distance varying was accepted for interpolation");
            std::unordered_map<std::string,int> symbols{{"position",1},{"uv",1},{"modelMatrix",0},{"scale",0}};
            for(const char* expression : {"position*position","position/uv.x","unknown(position)","normalize(position)","position[uv.x]","position + missing","position++"})
                require(gl::affineExpressionDegree(expression,symbols)==2,"Non-affine expression was accepted");
            for(const char* expression : {"(modelMatrix*vec4(position,1.)).xyz","position*scale + vec3(1.)","uv/2.0","position[2]"})
                require(gl::affineExpressionDegree(expression,symbols)<=1,"Valid affine expression rejected");
        }
        for (const char* unsafe : {"transformed.x=0.;", "gl_Position=vec4(0.);",
                 "return;", "vec3 transformed=vec3(0.);", "vec3 fresh=deform(position);",
                 "#define transformed position", "#ifdef USE_INSTANCING", "#include <project_vertex>"}) {
            auto source = proofStock;
            const std::string marker = "#include <begin_vertex>";
            source.insert(source.find(marker) + marker.size(), std::string("\n") + unsafe + "\n");
            require(!gl::hasStaticVertexAdditions(proofStock, source), "unsafe shader addition was accepted");
        }
        material->color = Color(0x679fce);
        auto mesh = Mesh::create(geometry, material);
        scene->add(mesh);
        scene->add(AmbientLight::create(Color(0xffffff), .3f));
        auto light = DirectionalLight::create(Color(0xffffff), 1);
        light->position.set(3, 5, 4);
        scene->add(light);

        auto compare = [&](const char* label) {
            // Render the changed state while the prior selection is still warm.
            renderer.setVirtualGeometry(true);
            renderer.render(*scene, *camera);
            auto actual = renderer.readRGBPixels();
            renderer.setVirtualGeometry(false);
            renderer.render(*scene, *camera);
            auto reference = renderer.readRGBPixels();
            require(std::any_of(reference.begin(), reference.end(), [](auto c) { return c != 0; }), "reference frame was blank");
            renderer.setVirtualGeometry(true);
            renderer.render(*scene, *camera);
            size_t differences = 0;
            for (size_t i = 0; i < reference.size(); ++i) differences += reference[i] != actual[i];
            std::cout << label << ": " << differences << " differing channels, "
                      << renderer.virtualGeometryStats().draws << " indirect draws\n";
            require(reference == actual, "Virtual Geometry changed pixels");
            require(glGetError() == GL_NO_ERROR, "Virtual Geometry leaked a GL error");
        };
        compare("perspective clipping");
        require(renderer.virtualGeometryStats().draws > 0, "GPU path was not exercised");
        std::array<std::vector<unsigned char>, 4> cameraReferences;
        renderer.setVirtualGeometry(false);
        for (unsigned i = 0; i < 4; ++i) {
            camera->position.x = float(i) * .25f;
            renderer.render(*scene, *camera);
            cameraReferences[i] = renderer.readRGBPixels();
        }
        renderer.setVirtualGeometry(true);
        for (unsigned i = 0; i < 4; ++i) {
            camera->position.x = float(i) * .25f;
            renderer.render(*scene, *camera);
        }
        auto dispatches = renderer.virtualGeometryStats().dispatches;
        for (unsigned repeat = 0; repeat < 3; ++repeat) for (unsigned i = 0; i < 4; ++i) {
            camera->position.x = float(i) * .25f;
            renderer.render(*scene, *camera);
            require(renderer.readRGBPixels() == cameraReferences[i], "cached camera selection changed pixels");
        }
        require(renderer.virtualGeometryStats().dispatches == dispatches, "alternating cameras recomputed cached selections");
        std::cout << "four alternating camera selections: 12 cache hits, zero new dispatches, exact pixels\n";
        camera->position.x = 0;
        material->shaderOverride = std::make_shared<Shader>(shaders::ShaderLib::instance().phong);
        material->shaderOverride->fragmentShader.insert(0, "// fragment-only customization\n");
        material->needsUpdate();
        compare("fragment-only override");
        require(renderer.virtualGeometryStats().draws > 0, "fragment-only override was rejected");
        auto& vertex = material->shaderOverride->vertexShader;
        vertex.insert(vertex.find("#include <begin_vertex>") + std::string("#include <begin_vertex>").size(), "\ntransformed.x += 0.5;\n");
        material->needsUpdate();
        compare("changed vertex override fallback");
        require(renderer.virtualGeometryStats().draws == 0, "changed vertex proof was not invalidated");
        vertex = shaders::ShaderLib::instance().phong.vertexShader;
        material->needsUpdate();
        compare("restored stock vertex override");
        require(renderer.virtualGeometryStats().draws > 0, "restored stock vertex was rejected");
        vertex.insert(0, "varying vec3 diagnosticWorld;\n");
        const std::string fogMarker = "#include <fog_vertex>";
        vertex.insert(vertex.find(fogMarker) + fogMarker.size(),
            "\nvec4 diagnosticPoint=vec4(transformed,1.);\n#ifdef USE_INSTANCING\n"
            "diagnosticPoint=instanceMatrix*diagnosticPoint;\n#endif\n"
            "diagnosticWorld=(modelMatrix*diagnosticPoint).xyz;\n");
        material->needsUpdate();
        compare("read-only varying additions");
        require(renderer.virtualGeometryStats().draws > 0, "read-only varying additions rejected");
        vertex.insert(vertex.find(fogMarker) + fogMarker.size(), "\ngl_Position.x += 0.5;\n");
        material->needsUpdate();
        compare("position write hidden among varyings fallback");
        require(renderer.virtualGeometryStats().draws == 0, "position write accepted");
        material->shaderOverride.reset();
        material->needsUpdate();
        compare("removed shader override restores uniform storage");
        auto standard = MeshStandardMaterial::create();
        standard->shaderOverride = std::make_shared<Shader>(shaders::ShaderLib::instance().standard);
        standard->shaderOverride->vertexShader.insert(0, "varying vec3 diagnosticWorld;\n");
        auto& standardVertex = standard->shaderOverride->vertexShader;
        standardVertex.insert(standardVertex.find(fogMarker) + fogMarker.size(), "\ndiagnosticWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n");
        standard->defines["STANDARD"] = "";
        mesh->setMaterials({standard});
        compare("standard define with read-only varying");
        require(renderer.virtualGeometryStats().draws > 0, "built-in STANDARD define rejected");
        standard->defines["CUSTOM_VERTEX_PATH"] = "1";
        standard->needsUpdate();
        compare("unknown define fallback");
        require(renderer.virtualGeometryStats().draws == 0, "unknown vertex define accepted");
        mesh->setMaterials({material});
        compare("restore original material");
        auto builds = renderer.virtualGeometryStats().builds;
        renderer.render(*scene, *camera);
        require(renderer.virtualGeometryStats().builds == builds, "unchanged geometry rebuilt");
        require(renderer.virtualGeometryStats().reused > 0, "unchanged selection was not reused");
        geometry->getAttribute<float>("position")->setZ(8192, .3f);
        geometry->getAttribute<float>("position")->needsUpdate();
        renderer.render(*scene, *camera);
        require(renderer.virtualGeometryStats().builds == builds + 1, "position version was not invalidated");
        compare("edited vertices");
        mesh->scale.set(-1.3f, .7f, 1);
        mesh->rotation.set(.15f, .4f, .2f);
        compare("negative nonuniform transform");
        geometry->setDrawRange(192, 48000);
        compare("draw range");
        geometry->addGroup(192, 24000, 0);
        geometry->addGroup(24192, 24000, 1);
        auto second = MeshPhongMaterial::create();
        second->color = Color(0xce8645);
        mesh->setMaterials({material, second});
        compare("material groups");
        camera->position.set(3, 1, 2);
        camera->lookAt(0, 0, 0);
        compare("second camera pose");
        material->transparent = true;
        second->transparent = true;
        compare("transparent fallback");
        require(renderer.virtualGeometryStats().draws == 0, "transparent material entered cluster path");
        material->transparent = false;
        second->transparent = false;
        compare("restore opaque");
        RenderTarget::Options msaaOptions;
        msaaOptions.samples = 4;
        auto multisample = RenderTarget::create(512, 384, msaaOptions);
        renderer.setRenderTarget(multisample.get());
        compare("MSAA target");
        renderer.setRenderTarget(target.get());
        renderer.shadowMap().enabled = true;
        mesh->castShadow = true;
        mesh->receiveShadow = true;
        light->castShadow = true;
        compare("shadow camera");
        renderer.shadowMap().enabled = false;
        auto index = geometry->getIndex();
        index->setX(220, index->getX(221));
        index->needsUpdate();
        builds = renderer.virtualGeometryStats().builds;
        renderer.render(*scene, *camera);
        require(renderer.virtualGeometryStats().builds == builds + 1, "index version was not invalidated");
        compare("edited indices");
        auto sourceIndices = index->array();
        geometry->setIndex(sourceIndices);
        builds = renderer.virtualGeometryStats().builds;
        renderer.render(*scene, *camera);
        require(renderer.virtualGeometryStats().builds == builds + 1, "replacement index was not invalidated");
        compare("replaced index buffer");
        if (argc > 1) renderer.writeFramebuffer(argv[1]);
        geometry->dispose();
        compare("geometry disposal and rebuild");
        renderer.setVirtualGeometry(false);
        require(renderer.virtualGeometryStats().cacheBytes == 0, "toggle off did not release residency");
        scene->remove(*mesh);
        auto instanced = InstancedMesh::create(PlaneGeometry::create(2, 2, 32, 32), material, 64);
        Matrix4 transform;
        for (unsigned i = 0; i < 64; ++i) {
            transform.makeTranslation(float(i % 8) * 3 - 10, float(i / 8) * 3 - 10, 0);
            instanced->setMatrixAt(i, transform);
            instanced->setColorAt(i, Color(float(i % 3) / 2, .5f, float(i % 5) / 4));
        }
        scene->add(instanced);
        compare("instance matrices and colors");
        require(renderer.virtualGeometryStats().draws > 0, "instancing path not exercised");
        originalAttributePointer = glad_glVertexAttribPointer;
        glad_glVertexAttribPointer = countAttributePointer;
        auto bindingReference = renderer.readRGBPixels();
        attributePointerCalls = 0;
        for (unsigned i = 0; i < 12; ++i) renderer.render(*scene, *camera);
        require(attributePointerCalls == 0, "unchanged instance buffers rebuilt vertex bindings");
        require(renderer.readRGBPixels() == bindingReference, "retained instance bindings changed pixels");
        instanced->instanceMatrix()->needsUpdate();
        renderer.render(*scene, *camera);
        require(attributePointerCalls == 0, "matrix content upload rebuilt unchanged vertex layout");
        require(renderer.readRGBPixels() == bindingReference, "matrix content upload changed retained bindings");
        instanced->dispose();
        renderer.render(*scene, *camera);
        require(attributePointerCalls > 0, "recreated instance buffers retained invalid vertex bindings");
        require(renderer.readRGBPixels() == bindingReference, "recreated instance buffers changed pixels");
        glad_glVertexAttribPointer = originalAttributePointer;
        std::cout << "instanced VAO reuse: zero attribute pointer calls over 12 draws and a content upload, exact pixels\n";
        transform.makeTranslation(0, 0, 1);
        instanced->setMatrixAt(30, transform);
        instanced->instanceMatrix()->needsUpdate();
        compare("moving instance");
        instanced->setCount(48);
        compare("instance count change");
        auto peer = InstancedMesh::create(instanced->geometry(), material, 64);
        for (unsigned i = 0; i < 64; ++i) {
            transform.makeTranslation(float(i % 8) * 3 - 9, float(i / 8) * 3 - 9, -.5f);
            peer->setMatrixAt(i, transform);
        }
        scene->add(peer);
        std::array<std::vector<unsigned char>, 2> instanceReferences;
        renderer.setVirtualGeometry(false);
        for (unsigned i = 0; i < 2; ++i) {
            camera->position.x = float(i) * .5f;
            renderer.render(*scene, *camera);
            instanceReferences[i] = renderer.readRGBPixels();
        }
        renderer.setVirtualGeometry(true);
        for (unsigned i = 0; i < 2; ++i) {
            camera->position.x = float(i) * .5f;
            renderer.render(*scene, *camera);
        }
        dispatches = renderer.virtualGeometryStats().dispatches;
        for (unsigned repeat = 0; repeat < 3; ++repeat) for (unsigned i = 0; i < 2; ++i) {
            camera->position.x = float(i) * .5f;
            renderer.render(*scene, *camera);
            require(renderer.readRGBPixels() == instanceReferences[i], "instanced selection cache changed pixels");
        }
        require(renderer.virtualGeometryStats().dispatches == dispatches, "instanced owners/cameras overwrite each other's cache");
        std::cout << "two instanced owners and cameras: 12 cache hits, zero new dispatches, exact pixels\n";
        transform.makeTranslation(0, 0, 2);
        peer->setMatrixAt(30, transform);
        peer->instanceMatrix()->needsUpdate();
        compare("cached instance revision invalidation");
        scene->remove(*peer);
        renderer.setVirtualGeometry(false);
        instanced->setGeometry(PlaneGeometry::create(2, 2, 64, 64));
        instanced->setCount(64);
        renderer.setVirtualGeometry(true);
        renderer.render(*scene, *camera);
        const auto firstResidency = renderer.virtualGeometryStats().cacheBytes;
        const auto firstCommands = uint64_t((instanced->geometry()->getIndex()->count() + 191) / 192) * instanced->count() * 20;
        for (unsigned i = 0; i < 300; ++i) {
            camera->position.x = float(i) * .001f;
            renderer.render(*scene, *camera);
        }
        require(renderer.virtualGeometryStats().cacheBytes <= firstResidency - firstCommands + 32 * 1024 * 1024,
            "instanced command cache exceeded byte budget");
        compare("instanced cache eviction parity");
        instanced->geometry()->dispose();
        require(renderer.virtualGeometryStats().cacheBytes == 0, "geometry disposal retained instanced command selections");
        compare("instanced cache rebuild after disposal");
        scene->remove(*instanced);
        scene->add(mesh);
        // A controlled geometry-bound workload, not an application FPS claim.
        mesh->setMaterials({material});
        mesh->setGeometry(PlaneGeometry::create(100, 100, 512, 512));
        mesh->rotation.set(0, 0, 0);
        mesh->scale.set(1, 1, 1);
        camera->position.set(0, 0, 4);
        camera->lookAt(0, 0, 0);
        GLuint timer = 0;
        glGenQueries(1, &timer);
        for (bool enabled : {false, true, false, true}) {
            renderer.setVirtualGeometry(enabled);
            for (int i = 0; i < 10; ++i) renderer.render(*scene, *camera);
            glFinish();
            const auto start = std::chrono::steady_clock::now();
            glBeginQuery(GL_TIME_ELAPSED, timer);
            for (int i = 0; i < 100; ++i) renderer.render(*scene, *camera);
            glEndQuery(GL_TIME_ELAPSED);
            glFinish();
            GLuint64 nanoseconds = 0;
            glGetQueryObjectui64v(timer, GL_QUERY_RESULT, &nanoseconds);
            const auto wall = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
            std::cout << "geometry benchmark " << (enabled ? "on" : "off") << ": "
                      << double(nanoseconds) / 1e8 << " GPU ms/frame, " << wall / 100 << " wall ms/frame, "
                      << renderer.virtualGeometryStats().draws << " indirect draws\n";
            if (enabled) require(renderer.virtualGeometryStats().draws >= 100, "benchmark did not exercise indirect draws");
        }
        glDeleteQueries(1, &timer);
        // An explicitly disposed mesh can be rendered again, then destroyed
        // before its renderer. Listener cleanup must not dereference its corpse.
        instanced.reset();
        peer.reset();
        renderer.dispose();
        std::cout << "Virtual Geometry smoke passed\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}

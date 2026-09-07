#include "threepp/threepp.hpp"
#include "threepp/renderers/RenderTarget.hpp"
#include "threepp/renderers/shaders/ShaderLib.hpp"
#include "../src/threepp/renderers/gl/VirtualGeometryHierarchy.hpp"
#include "../src/threepp/renderers/gl/GLIndirectCompaction.hpp"
#include <glad/glad.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <map>
#include <thread>

using namespace threepp;
static void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
using Edge = std::pair<unsigned,unsigned>;
static std::map<Edge,int> edges(const std::vector<unsigned>& indices) {
    std::map<Edge,int> result;
    for(size_t i=0;i<indices.size();i+=3) for(unsigned j=0;j<3;++j) {
        auto a=indices[i+j], b=indices[i+(j+1)%3];
        if(a>b) std::swap(a,b);
        ++result[{a,b}];
    }
    return result;
}
static void checkHierarchy() {
    auto plane=PlaneGeometry::create(10,10,64,64);
    gl::VirtualGeometryCookInput input;
    input.positions=plane->getAttribute<float>("position")->array();
    // Non-planar fixture exercises mixed levels and geometric error.
    for(size_t i=0;i<input.positions.size();i+=3)
        input.positions[i+2]=.2f*std::sin(input.positions[i])*std::cos(input.positions[i+1]);
    input.indices=plane->getIndex()->array();
    auto hierarchy=gl::cookVirtualGeometryHierarchy(input);
    require(hierarchy.nodes.size()>1,"Hierarchy did not subdivide");
    unsigned reduced=0;
    auto inspect=[&](auto&& self,unsigned id)->std::vector<unsigned> {
        const auto& n=hierarchy.nodes.at(id);
        require(n.draw[0]+n.draw[1]<=hierarchy.indices.size(),"Invalid node index range");
        std::vector<unsigned> selected(hierarchy.indices.begin()+n.draw[0],hierarchy.indices.begin()+n.draw[0]+n.draw[1]);
        for(auto v:selected) require(v<input.positions.size()/3,"Cook changed vertex addressing");
        if(n.tree[0]==gl::VirtualGeometryHierarchy::absent) return selected;
        require(hierarchy.nodes[n.tree[0]].draw[2]==id && hierarchy.nodes[n.tree[1]].draw[2]==id,"Invalid parent links");
        auto source=self(self,n.tree[0]); auto right=self(self,n.tree[1]);
        source.insert(source.end(),right.begin(),right.end());
        require(source.size()==n.draw[3],"Hierarchy lost source coverage");
        if(!selected.empty()) {
            auto sourceEdges=edges(source), selectedEdges=edges(selected);
            for(auto [edge,count]:sourceEdges) if(count==1)
                require(selectedEdges[edge]==1,"Simplification changed a shared boundary edge");
            for(auto [edge,count]:selectedEdges) if(count==1)
                require(sourceEdges[edge]==1,"Simplification created a boundary crack");
            reduced+=selected.size()<source.size();
        }
        return source;
    };
    auto leaves=inspect(inspect,0);
    auto triangles=[](const std::vector<unsigned>& indices) {
        std::vector<std::array<unsigned,3>> result;
        for(size_t i=0;i<indices.size();i+=3) result.push_back({indices[i],indices[i+1],indices[i+2]});
        std::sort(result.begin(),result.end()); return result;
    };
    require(triangles(leaves)==triangles(input.indices),"Finest hierarchy changed source triangles or winding");
    require(reduced>0,"Hierarchy contains no reduced detail");
    std::cout<<"CPU hierarchy: "<<hierarchy.nodes.size()<<" nodes, "<<reduced<<" simplified levels; boundaries preserved\n";
    input.indices[0]=UINT32_MAX;
    bool rejected=false;
    try { gl::cookVirtualGeometryHierarchy(input); } catch(const std::invalid_argument&) { rejected=true; }
    require(rejected,"Cook accepted invalid indices");
}

int main(int argc,char** argv) {
    std::cout<<std::unitbuf;
    try {
        checkHierarchy();
        Canvas canvas(Canvas::Parameters().size(512,384).headless(true).computeContext(true));
        GLRenderer renderer(canvas);
        {
            gl::GLIndirectCompaction compactor;
            for(unsigned size : {512u,513u,8191u,262144u}) {
                std::vector<unsigned> input(size*5),expected;
                for(unsigned i=0;i<size;++i) {
                    const std::array<unsigned,5> command{size==512 || i%3==1 ? 0u : 3u,1u,i*3,0u,i%7};
                    std::copy(command.begin(),command.end(),input.begin()+i*5);
                    if(command[0]) expected.insert(expected.end(),command.begin(),command.end());
                }
                GLuint commands=0,countBuffer=0;
                glGenBuffers(1,&commands); glBindBuffer(GL_ARRAY_BUFFER,commands);
                glBufferData(GL_ARRAY_BUFFER,input.size()*4,input.data(),GL_STATIC_DRAW);
                glBindBuffer(GL_ARRAY_BUFFER,0);
                if(!compactor.compact(commands,countBuffer,size,renderer.state())) {
                    glDeleteBuffers(1,&commands); std::cout<<"Indirect count extension unavailable; sparse fallback retained\n"; break;
                }
                unsigned count=0; glBindBuffer(GL_ARRAY_BUFFER,countBuffer);
                glGetBufferSubData(GL_ARRAY_BUFFER,((size+255)/256)*4,4,&count);
                require(count*5==expected.size(),"GPU compaction returned an incorrect command count");
                std::vector<unsigned> actual(count*5); glBindBuffer(GL_ARRAY_BUFFER,commands);
                if(!actual.empty()) glGetBufferSubData(GL_ARRAY_BUFFER,0,actual.size()*4,actual.data());
                require(actual==expected,"GPU compaction changed command or instance order");
                glDeleteBuffers(1,&commands); glDeleteBuffers(1,&countBuffer);
                require(glGetError()==GL_NO_ERROR,"GPU command compaction leaked an error");
            }
            compactor.dispose();
            std::cout<<"GPU stable indirect compaction verified\n";
        }
        auto target=RenderTarget::create(512,384,RenderTarget::Options{});
        renderer.setRenderTarget(target.get());
        auto scene=Scene::create();
        auto camera=PerspectiveCamera::create(55,512.f/384,.1f,200);
        camera->position.z=8;
        auto geometry=SphereGeometry::create(1,128,64);
        auto material=MeshNormalMaterial::create();
        auto mesh=Mesh::create(geometry,material); scene->add(mesh);
        renderer.setVirtualGeometry(true); renderer.setVirtualGeometryPixelError(1);
        auto waitCook=[&] {
            auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(15);
            auto old=renderer.virtualGeometryStats().adaptiveDraws;
            do {
                renderer.render(*scene,*camera);
                if(renderer.virtualGeometryStats().adaptiveDraws>old) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            } while(std::chrono::steady_clock::now()<deadline);
            throw std::runtime_error("Adaptive cook never produced a draw");
        };
        waitCook();
        GLuint query=0; glGenQueries(1,&query);
        auto primitives=[&] {
            glBeginQuery(GL_PRIMITIVES_GENERATED,query);
            renderer.render(*scene,*camera);
            glEndQuery(GL_PRIMITIVES_GENERATED);
            GLuint value=0; glGetQueryObjectuiv(query,GL_QUERY_RESULT,&value);
            require(glGetError()==GL_NO_ERROR,"Adaptive rendering leaked GL state/error");
            return value;
        };
        renderer.setVirtualGeometryPixelError(0);
        const auto full=primitives();
        renderer.setVirtualGeometryPixelError(1);
        const auto far=primitives();
        auto reused=renderer.virtualGeometryStats().adaptiveReused;
        require(primitives()==far && renderer.virtualGeometryStats().adaptiveReused>reused,"Unchanged adaptive selection was not reused");
        auto image=renderer.readRGBPixels();
        require(far>0 && far<full/2,"GPU did not reduce distant triangles");
        camera->position.z=2;
        const auto near=primitives();
        require(near>far,"GPU did not refine nearby geometry");
        renderer.setVirtualGeometryPixelError(.1f);
        const auto fine=primitives();
        require(fine>=near,"Tighter error reduced detail");
        renderer.setVirtualGeometryPixelError(1);
        auto smallTarget=RenderTarget::create(128,96,RenderTarget::Options{});
        renderer.setRenderTarget(smallTarget.get());
        require(primitives()<near,"Detail selection ignored the actual render-target viewport");
        renderer.setRenderTarget(target.get());
        require(primitives()==near,"Alternating render targets retained stale detail selection");
        auto adaptiveDraws=renderer.virtualGeometryStats().adaptiveDraws;
        geometry->setDrawRange(0,768);
        primitives();
        require(renderer.virtualGeometryStats().adaptiveDraws==adaptiveDraws,"Partial range used whole-geometry detail");
        geometry->setDrawRange(0,geometry->getIndex()->count());
        material->shaderOverride=std::make_shared<Shader>(shaders::ShaderLib::instance().normal);
        material->needsUpdate();
        primitives();
        require(renderer.virtualGeometryStats().adaptiveDraws>adaptiveDraws,"Stock vertex with fragment override was rejected");
        adaptiveDraws=renderer.virtualGeometryStats().adaptiveDraws;
        material->shaderOverride->vertexShader.insert(0,"varying vec3 diagnosticOnly;\n");
        auto& modifiedVertex=material->shaderOverride->vertexShader;
        const std::string beginMarker="#include <begin_vertex>";
        modifiedVertex.insert(modifiedVertex.find(beginMarker)+beginMarker.size(),"\ndiagnosticOnly=position*position;\n");
        material->needsUpdate();
        primitives();
        require(renderer.virtualGeometryStats().adaptiveDraws==adaptiveDraws,"Custom shader entered unproven adaptive interpolation");
        material->shaderOverride.reset(); material->needsUpdate();
        std::cout<<"GPU triangles: original="<<full<<", distant="<<far<<", near="<<near<<", tighter="<<fine<<'\n';
        // Same original vertex buffers: alternating exact/adaptive submissions
        // must restore the VAO element binding and instance owner correctly.
        renderer.setVirtualGeometryPixelError(0); camera->position.z=8;
        require(primitives()==full,"Derived indices leaked into the original VAO");
        renderer.setVirtualGeometryPixelError(1);
        auto builds=renderer.virtualGeometryStats().adaptiveBuilds;
        geometry->getAttribute<float>("normal")->needsUpdate();
        waitCook();
        require(renderer.virtualGeometryStats().adaptiveBuilds>builds,"Attribute revision did not invalidate the hierarchy");
        builds=renderer.virtualGeometryStats().adaptiveBuilds;
        geometry->dispose(); waitCook();
        require(renderer.virtualGeometryStats().adaptiveBuilds>builds,"Disposed geometry reused stale cooked storage");
        scene->remove(*mesh);
        auto instanced=InstancedMesh::create(geometry,material,3);
        Matrix4 transform; transform.makeTranslation(-1.5f,0,0); instanced->setMatrixAt(0,transform);
        transform.makeTranslation(1.5f,0,0); instanced->setMatrixAt(1,transform);
        transform.makeTranslation(1000,0,0); instanced->setMatrixAt(2,transform);
        scene->add(instanced);
        auto instances=primitives();
        require(instances>far && instances<full*2,"Instanced hierarchy selection failed");
        reused=renderer.virtualGeometryStats().adaptiveReused;
        require(primitives()==instances && renderer.virtualGeometryStats().adaptiveReused>reused,"Instanced adaptive selection was not reused");
        transform.makeTranslation(1000,0,0); instanced->setMatrixAt(1,transform);
        instanced->instanceMatrix()->needsUpdate();
        require(primitives()<instances,"Instance revision reused stale adaptive visibility");
        // Revision while cooking must never install an obsolete result.
        geometry->getAttribute<float>("position")->needsUpdate();
        primitives();
        geometry->setAttribute("normal",geometry->getAttribute<float>("normal")->clone());
        waitCook();
        require(renderer.virtualGeometryStats().adaptiveFailed==0,"Valid geometry cooking failed");
        renderer.setVirtualGeometry(false);
        require(renderer.virtualGeometryStats().adaptiveBytes==0,"Toggle off retained GPU hierarchy storage");
        glDeleteQueries(1,&query);
        if(argc>1) {
            std::ofstream file(argv[1],std::ios::binary);
            file<<"P6\n512 384\n255\n";
            for(int y=383;y>=0;--y) file.write(reinterpret_cast<const char*>(image.data()+y*512*3),512*3);
        }
        std::cout<<"Adaptive Geometry smoke passed\n";
    } catch(const std::exception& error) { std::cerr<<error.what()<<'\n'; return 1; }
}

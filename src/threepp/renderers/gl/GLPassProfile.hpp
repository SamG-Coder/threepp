#pragma once
#include <array>
#include <chrono>
#include <cstdlib>
#include <fstream>

namespace threepp::gl {
// Optional bounded CPU-stage trace. Durations include driver blocking; they
// must not be interpreted as GPU execution times or added to GPU timestamps.
class GLPassProfile {
    using Clock = std::chrono::steady_clock;
    struct Trace {
        std::ofstream file;
        unsigned int sequence{};
        Trace() {
            if (const auto* path = std::getenv("THREEBROWSER_PASS_PROFILE")) {
                file.open(path);
                if (file) file << "pass,scene,camera,target,width,height,transformsUs,listUs,shadowsUs,lightsUs,drawUs,resolveUs\n";
            }
        }
    };
    static Trace& trace() { static thread_local Trace value; return value; }
    bool enabled{};
    unsigned int sequence{}, scene{}, camera{}, target{}, width{}, height{};
    Clock::time_point last;
    std::array<double,6> stages{};
public:
    GLPassProfile(unsigned int scene, unsigned int camera, unsigned int target, unsigned int width, unsigned int height)
        : scene(scene), camera(camera), target(target), width(width), height(height) {
        auto& t = trace();
        enabled = t.file.is_open() && t.sequence < 50000;
        if (enabled) { sequence = ++t.sequence; last = Clock::now(); }
    }
    void mark(unsigned int index) {
        if (!enabled) return;
        const auto now = Clock::now();
        stages[index] = std::chrono::duration<double,std::micro>(now-last).count(); last=now;
    }
    ~GLPassProfile() {
        if (!enabled) return;
        auto& out=trace().file;
        out << sequence << ',' << scene << ',' << camera << ',' << target << ',' << width << ',' << height;
        for (auto value:stages) out << ',' << value;
        out << '\n';
    }
};
}

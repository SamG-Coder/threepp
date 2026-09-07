#pragma once

// Optional worker-side diagnostics. CPU scopes include every command in a
// submission and its presentation. Timestamp results are polled, never waited
// for; a bounded queue drops GPU measurements instead of stalling rendering.
#include <chrono>
#include <cstdlib>
#include <deque>
#include <fstream>
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
#include <glad/glad.h>
#endif

namespace tn {
class CommandProfile {
    using Clock = std::chrono::steady_clock;
    struct Sample {
        uint64_t sequence{}, before{}, after{};
        double cpuUs{};
        unsigned int begin{}, end{};
        int bytes{};
    };
    struct State {
        std::ofstream output;
        std::deque<Sample> pending;
        uint64_t sequence{};
        State() {
            if (const auto* path = std::getenv("THREEBROWSER_FRAME_PROFILE")) output.open(path);
        }
        void emit(const Sample& s, double gpuUs = -1) {
            output << "{\"sequence\":" << s.sequence << ",\"presentsBefore\":" << s.before
                   << ",\"presentsAfter\":" << s.after << ",\"bytes\":" << s.bytes
                   << ",\"cpuUs\":" << s.cpuUs << ",\"gpuUs\":";
            if (gpuUs < 0) output << "null"; else output << gpuUs;
            output << "}\n";
            output.flush();
        }
        void poll() {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
            while (!pending.empty()) {
                const auto& s = pending.front();
                GLint available = 0;
                glGetQueryObjectiv(s.end, GL_QUERY_RESULT_AVAILABLE, &available);
                if (!available) break;
                GLuint64 begin = 0, end = 0;
                glGetQueryObjectui64v(s.begin, GL_QUERY_RESULT, &begin);
                glGetQueryObjectui64v(s.end, GL_QUERY_RESULT, &end);
                emit(s, double(end - begin) / 1000.0);
                glDeleteQueries(1, &s.begin); glDeleteQueries(1, &s.end);
                pending.pop_front();
            }
#endif
        }
        // Context teardown owns any outstanding GL query names. Do not issue
        // GL calls from thread-local destructors after the context is gone.
        ~State() { for (const auto& s : pending) emit(s); }
    };
    static State& state() { static thread_local State value; return value; }
    Sample sample;
    Clock::time_point start;
    bool enabled{};
public:
    static void release() {
        auto& s = state();
        if (!s.output.is_open()) return;
        s.poll();
        for (const auto& sample : s.pending) {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
            glDeleteQueries(1, &sample.begin); glDeleteQueries(1, &sample.end);
#endif
            s.emit(sample);
        }
        s.pending.clear();
    }
    explicit CommandProfile(int bytes) {
        auto& s = state();
        if (!s.output.is_open()) return;
        enabled = true;
        s.poll();
        sample.sequence = ++s.sequence;
        sample.bytes = bytes;
        sample.before = g.statsPresents.load();
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        if (g.renderer && g.backend.load() == 0 && glQueryCounter && glGetQueryObjectui64v && s.pending.size() < 32) {
            glGenQueries(1, &sample.begin); glGenQueries(1, &sample.end);
            glQueryCounter(sample.begin, GL_TIMESTAMP);
        }
#endif
        start = Clock::now();
    }
    ~CommandProfile() {
        if (!enabled) return;
        sample.cpuUs = std::chrono::duration<double, std::micro>(Clock::now() - start).count();
        sample.after = g.statsPresents.load();
        auto& s = state();
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        if (sample.begin) {
            glQueryCounter(sample.end, GL_TIMESTAMP);
            s.pending.push_back(sample);
        } else
#endif
            s.emit(sample);
    }
};
}

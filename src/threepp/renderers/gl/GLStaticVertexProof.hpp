#ifndef THREEPP_GLSTATICVERTEXPROOF_HPP
#define THREEPP_GLSTATICVERTEXPROOF_HPP

#include "threepp/renderers/shaders/ShaderChunk.hpp"
#include <regex>
#include <sstream>
#include <unordered_set>
#include <vector>

namespace threepp::gl {

// Deliberately limited proof for additive, read-only varying calculations.
// This is not a GLSL optimizer: every stock line must survive, writes may only
// target newly declared symbols, and calls/control flow/macros are rejected.
inline bool hasStaticVertexAdditions(const std::string& stock, const std::string& candidate) {
    static const std::regex identifiers(R"([A-Za-z_][A-Za-z_0-9]*)");
    static const std::regex include(R"(#include\s*<([^>]+)>)");
    static const std::regex comments(R"(/\*[\s\S]*?\*/|//[^\n]*)");
    auto lines = [&](const std::string& source) {
        std::vector<std::string> result;
        std::istringstream stream(std::regex_replace(source, comments, " "));
        std::string line;
        while (std::getline(stream, line)) {
            const auto first = line.find_first_not_of(" \t\r");
            if (first != std::string::npos)
                result.push_back(line.substr(first, line.find_last_not_of(" \t\r") - first + 1));
        }
        return result;
    };
    const auto original = lines(stock), changed = lines(candidate);
    std::unordered_set<std::string> reserved, visited;
    auto collect = [&](auto&& self, const std::string& source) -> void {
        for (auto it = std::sregex_iterator(source.begin(), source.end(), identifiers); it != std::sregex_iterator(); ++it)
            reserved.insert(it->str());
        for (auto it = std::sregex_iterator(source.begin(), source.end(), include); it != std::sregex_iterator(); ++it) {
            const auto key = (*it)[1].str();
            if (visited.insert(key).second) self(self, shaders::ShaderChunk::instance().get(key));
        }
    };
    collect(collect, stock);
    // Renderer-generated vertex preamble declarations are outside ShaderLib.
    for (const char* name : {"position", "normal", "uv", "uv2", "color", "tangent", "instanceMatrix",
             "instanceColor", "modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix",
             "normalMatrix", "cameraPosition", "isOrthographic"}) reserved.insert(name);
    std::unordered_set<std::string> writable;
    static const std::regex declaration(R"(^(?:(varying|uniform)\s+)?(float|vec2|vec3|vec4|mat2|mat3|mat4)\s+([A-Za-z_][A-Za-z_0-9]*)\s*(?:=\s*(.+))?$)");
    static const std::regex assignment(R"(^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)$)");
    static const std::regex call(R"(([A-Za-z_][A-Za-z_0-9]*)\s*\()");
    static const std::regex conditional(R"(^#ifn?def\s+[A-Z][A-Z_0-9]*$)");
    const std::unordered_set<std::string> constructors{"float", "vec2", "vec3", "vec4", "mat2", "mat3", "mat4"};
    auto expressionSafe = [&](const std::string& expression) {
        if (expression.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789. \t\r\n()+-*/,[]") != std::string::npos) return false;
        if (expression.find("++") != std::string::npos || expression.find("--") != std::string::npos) return false;
        for (auto it = std::sregex_iterator(expression.begin(), expression.end(), call); it != std::sregex_iterator(); ++it)
            if (!constructors.contains((*it)[1].str())) return false;
        return true;
    };
    auto addedBlockSafe = [&](const std::vector<std::string>& additions) {
        int conditions = 0;
        std::string statements;
        for (const auto& line : additions) {
            if (line.starts_with('#')) {
                if (!statements.empty()) return false;
                if (std::regex_match(line, conditional)) ++conditions;
                else if (line == "#endif" && conditions > 0) --conditions;
                else if (line != "#else" || conditions == 0) return false;
                continue;
            }
            statements += line + " ";
            size_t end;
            while ((end = statements.find(';')) != std::string::npos) {
                auto statement = statements.substr(0, end);
                statements.erase(0, end + 1);
                statement.erase(0, statement.find_first_not_of(" \t"));
                statement.erase(statement.find_last_not_of(" \t") + 1);
                std::smatch match;
                if (std::regex_match(statement, match, declaration)) {
                    const auto name = match[3].str();
                    if (reserved.contains(name) || writable.contains(name) || name.starts_with("gl_") || name.starts_with("tb_")) return false;
                    if (match[4].matched && !expressionSafe(match[4].str())) return false;
                    if (match[1].str() != "uniform") writable.insert(name);
                    reserved.insert(name);
                } else if (std::regex_match(statement, match, assignment)) {
                    if (!writable.contains(match[1].str()) || !expressionSafe(match[2].str())) return false;
                } else return false;
            }
            if (statements.find_first_not_of(" \t") == std::string::npos) statements.clear();
        }
        return conditions == 0 && statements.empty();
    };
    size_t next = 0;
    std::vector<std::string> additions;
    for (const auto& line : changed) {
        if (next < original.size() && line == original[next]) {
            if (!additions.empty() && next != 0 && !std::regex_match(original[next - 1], include)) return false;
            if (!addedBlockSafe(additions)) return false;
            additions.clear();
            ++next;
        } else additions.push_back(line);
    }
    return next == original.size() && additions.empty();
}

}
#endif

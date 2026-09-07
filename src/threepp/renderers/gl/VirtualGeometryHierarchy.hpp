#pragma once

#include "../../../external/meshoptimizer/meshoptimizer.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

namespace threepp::gl {

// Runtime-owned cooked data. Indices always reference the original vertices;
// source geometry, UVs, normals and material data are never rewritten.
struct VirtualGeometryHierarchy {
    struct alignas(16) Node {
        std::array<float, 4> lo{}, hi{}; // lo.w: absolute simplification error
        std::array<uint32_t, 4> draw{};  // first index, count, parent, source count
        std::array<uint32_t, 4> tree{};  // child A, child B, depth, reserved
    };
    static constexpr uint32_t absent = UINT32_MAX;
    std::vector<Node> nodes;
    std::vector<unsigned> indices;
};

struct VirtualGeometryCookInput {
    std::vector<float> positions;
    std::vector<unsigned> indices;
    // Optional interleaved normal/UV/color channels and their metric weights.
    std::vector<float> attributes;
    std::vector<float> attributeWeights;
};

inline VirtualGeometryHierarchy cookVirtualGeometryHierarchy(const VirtualGeometryCookInput& input) {
    using Hierarchy = VirtualGeometryHierarchy;
    if (input.positions.empty() || input.positions.size() % 3 || input.indices.empty() || input.indices.size() % 3)
        throw std::invalid_argument("Virtual Geometry requires float3 positions and triangles");
    const auto vertexCount = input.positions.size() / 3;
    if (input.indices.size() > 1000000 || vertexCount > 350000)
        throw std::invalid_argument("Virtual Geometry cooking budget exceeded");
    if (input.attributeWeights.size() > 32 || input.attributes.size() != vertexCount * input.attributeWeights.size())
        throw std::invalid_argument("Virtual Geometry attribute shape mismatch");
    for (float value : input.positions) if (!std::isfinite(value)) throw std::invalid_argument("Nonfinite vertex position");
    for (float value : input.attributes) if (!std::isfinite(value)) throw std::invalid_argument("Nonfinite vertex attribute");
    for (float value : input.attributeWeights) if (!std::isfinite(value) || value < 0) throw std::invalid_argument("Invalid attribute weight");
    for (unsigned index : input.indices) if (index >= vertexCount) throw std::invalid_argument("Vertex index out of bounds");

    Hierarchy result;
    auto build = [&](auto&& self, std::vector<unsigned> triangles, uint32_t parent, uint32_t depth) -> uint32_t {
        const auto id = static_cast<uint32_t>(result.nodes.size());
        result.nodes.emplace_back();
        Hierarchy::Node node;
        node.lo.fill(std::numeric_limits<float>::infinity());
        node.hi.fill(-std::numeric_limits<float>::infinity());
        for (auto index : triangles) for (unsigned axis = 0; axis < 3; ++axis) {
            const float value = input.positions[index * 3 + axis];
            node.lo[axis] = std::min(node.lo[axis], value);
            node.hi[axis] = std::max(node.hi[axis], value);
        }
        node.lo[3] = 0;
        node.hi[3] = 0;
        node.draw = {0, 0, parent, static_cast<uint32_t>(triangles.size())};
        node.tree = {Hierarchy::absent, Hierarchy::absent, depth, 0};
        std::vector<unsigned> selected;
        if (triangles.size() <= 384) {
            selected = std::move(triangles);
        } else {
            unsigned axis = 0;
            for (unsigned j = 1; j < 3; ++j)
                if (node.hi[j] - node.lo[j] > node.hi[axis] - node.lo[axis]) axis = j;
            std::vector<unsigned> order(triangles.size() / 3);
            for (unsigned i = 0; i < order.size(); ++i) order[i] = i;
            auto center = [&](unsigned triangle) {
                return (double(input.positions[triangles[triangle * 3] * 3 + axis]) +
                        input.positions[triangles[triangle * 3 + 1] * 3 + axis] +
                        input.positions[triangles[triangle * 3 + 2] * 3 + axis]) / 3.;
            };
            const auto middle = order.size() / 2;
            std::nth_element(order.begin(), order.begin() + middle, order.end(), [&](unsigned a, unsigned b) {
                const auto ca = center(a), cb = center(b);
                return ca < cb || (ca == cb && a < b);
            });
            std::vector<unsigned> left, right;
            left.reserve(middle * 3); right.reserve((order.size() - middle) * 3);
            for (unsigned i = 0; i < order.size(); ++i) {
                auto& destination = i < middle ? left : right;
                destination.insert(destination.end(), triangles.begin() + order[i] * 3, triangles.begin() + order[i] * 3 + 3);
            }
            node.tree[0] = self(self, std::move(left), id, depth + 1);
            node.tree[1] = self(self, std::move(right), id, depth + 1);
            selected.resize(triangles.size());
            float error = 0;
            // Every submesh's topological boundary is locked. Adjacent hierarchy
            // selections therefore retain the same boundary vertices/edges.
            const auto flags = meshopt_SimplifyLockBorder | meshopt_SimplifySparse | meshopt_SimplifyErrorAbsolute;
            // Aim for a cluster-sized coarse representation at every level.
            // Locked seams may prevent reaching this target; keep that larger
            // valid result rather than deleting boundary vertices to force it.
            const size_t target = 384;
            const size_t count = input.attributeWeights.empty()
                ? meshopt_simplify(selected.data(), triangles.data(), triangles.size(), input.positions.data(), vertexCount, 12,
                    target, std::numeric_limits<float>::max(), flags, &error)
                : meshopt_simplifyWithAttributes(selected.data(), triangles.data(), triangles.size(), input.positions.data(), vertexCount, 12,
                    input.attributes.data(), input.attributeWeights.size() * sizeof(float), input.attributeWeights.data(), input.attributeWeights.size(), nullptr,
                    target, std::numeric_limits<float>::max(), flags, &error);
            selected.resize(count);
            // Each level is simplified directly from its original triangle set.
            // Selection walks every ancestor; an unsimplifiable child must not
            // poison otherwise valid coarse levels with its sentinel error.
            node.lo[3] = error;
            if (!std::isfinite(node.lo[3]) || selected.empty() || count >= triangles.size()) {
                selected.clear();
                node.lo[3] = std::numeric_limits<float>::max();
            }
        }
        node.draw[0] = static_cast<uint32_t>(result.indices.size());
        node.draw[1] = static_cast<uint32_t>(selected.size());
        result.indices.insert(result.indices.end(), selected.begin(), selected.end());
        result.nodes[id] = node;
        return id;
    };
    build(build, input.indices, Hierarchy::absent, 0);
    return result;
}

}

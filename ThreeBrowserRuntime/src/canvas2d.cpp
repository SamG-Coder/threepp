#include "canvas2d.h"

#include <algorithm>
#include <array>
#include <bit>
#include <charconv>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <numbers>
#include <optional>
#include <string>
#include <utility>

#define STB_IMAGE_WRITE_STATIC
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

namespace threebrowser::canvas2d {
namespace {

constexpr int kSamples = 4;
constexpr int kCoverageSamples = kSamples * kSamples;
constexpr int kMaximumDimension = 16384;
constexpr double kPi = std::numbers::pi_v<double>;
constexpr double kTwoPi = 2.0 * kPi;

struct Point {
    double x{};
    double y{};
};

struct Pixel {
    std::uint8_t r{};
    std::uint8_t g{};
    std::uint8_t b{};
    std::uint8_t a{};
};

struct Color {
    double r{};
    double g{};
    double b{};
    double a{1.0};
};

double clamp01(double value) {
    return std::clamp(std::isfinite(value) ? value : 0.0, 0.0, 1.0);
}

std::uint8_t byteFromUnit(double value) {
    return static_cast<std::uint8_t>(std::clamp(std::lround(clamp01(value) * 255.0), 0L, 255L));
}

Color unpackColor(std::uint32_t rgba) {
    return {
        static_cast<double>((rgba >> 24U) & 0xffU) / 255.0,
        static_cast<double>((rgba >> 16U) & 0xffU) / 255.0,
        static_cast<double>((rgba >> 8U) & 0xffU) / 255.0,
        static_cast<double>(rgba & 0xffU) / 255.0,
    };
}

std::uint32_t packColor(const Color& color) {
    return (static_cast<std::uint32_t>(byteFromUnit(color.r)) << 24U) |
           (static_cast<std::uint32_t>(byteFromUnit(color.g)) << 16U) |
           (static_cast<std::uint32_t>(byteFromUnit(color.b)) << 8U) |
           static_cast<std::uint32_t>(byteFromUnit(color.a));
}

std::string trimLower(std::string_view value) {
    std::size_t first = 0;
    while (first < value.size() && std::isspace(static_cast<unsigned char>(value[first]))) ++first;
    std::size_t last = value.size();
    while (last > first && std::isspace(static_cast<unsigned char>(value[last - 1]))) --last;
    std::string result(value.substr(first, last - first));
    std::transform(result.begin(), result.end(), result.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return result;
}

int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::vector<std::string> splitColorArguments(std::string_view input) {
    std::vector<std::string> result;
    std::size_t start = 0;
    for (std::size_t i = 0; i <= input.size(); ++i) {
        if (i == input.size() || input[i] == ',' || input[i] == '/') {
            auto token = trimLower(input.substr(start, i - start));
            if (!token.empty()) result.push_back(std::move(token));
            start = i + 1;
        }
    }
    if (result.size() <= 1 && input.find(',') == std::string_view::npos) {
        result.clear();
        std::string token;
        for (char c : input) {
            if (std::isspace(static_cast<unsigned char>(c)) || c == '/') {
                if (!token.empty()) { result.push_back(token); token.clear(); }
            } else token.push_back(c);
        }
        if (!token.empty()) result.push_back(std::move(token));
    }
    return result;
}

bool parseDouble(std::string_view input, double& value) {
    std::string copy(input);
    char* end = nullptr;
    value = std::strtod(copy.c_str(), &end);
    return end && end != copy.c_str() && *end == '\0' && std::isfinite(value);
}

bool parseRgbComponent(std::string_view input, double& value) {
    const bool percent = !input.empty() && input.back() == '%';
    if (percent) input.remove_suffix(1);
    double parsed = 0.0;
    if (!parseDouble(input, parsed)) return false;
    value = clamp01(percent ? parsed / 100.0 : parsed / 255.0);
    return true;
}

bool parseAlpha(std::string_view input, double& value) {
    const bool percent = !input.empty() && input.back() == '%';
    if (percent) input.remove_suffix(1);
    double parsed = 0.0;
    if (!parseDouble(input, parsed)) return false;
    value = clamp01(percent ? parsed / 100.0 : parsed);
    return true;
}

Color hslToRgb(double hue, double saturation, double lightness, double alpha) {
    hue = std::fmod(hue, 360.0);
    if (hue < 0.0) hue += 360.0;
    saturation = clamp01(saturation);
    lightness = clamp01(lightness);
    const double chroma = (1.0 - std::abs(2.0 * lightness - 1.0)) * saturation;
    const double section = hue / 60.0;
    const double intermediate = chroma * (1.0 - std::abs(std::fmod(section, 2.0) - 1.0));
    double r = 0.0, g = 0.0, b = 0.0;
    if (section < 1.0) r = chroma, g = intermediate;
    else if (section < 2.0) r = intermediate, g = chroma;
    else if (section < 3.0) g = chroma, b = intermediate;
    else if (section < 4.0) g = intermediate, b = chroma;
    else if (section < 5.0) r = intermediate, b = chroma;
    else r = chroma, b = intermediate;
    const double match = lightness - chroma * 0.5;
    return {r + match, g + match, b + match, clamp01(alpha)};
}

AffineTransform multiply(const AffineTransform& left, const AffineTransform& right) {
    return {
        left.a * right.a + left.c * right.b,
        left.b * right.a + left.d * right.b,
        left.a * right.c + left.c * right.d,
        left.b * right.c + left.d * right.d,
        left.a * right.e + left.c * right.f + left.e,
        left.b * right.e + left.d * right.f + left.f,
    };
}

Point transformPoint(const AffineTransform& transform, Point point) {
    return {transform.a * point.x + transform.c * point.y + transform.e,
            transform.b * point.x + transform.d * point.y + transform.f};
}

std::optional<AffineTransform> inverse(const AffineTransform& transform) {
    const double determinant = transform.a * transform.d - transform.b * transform.c;
    if (!std::isfinite(determinant) || std::abs(determinant) < 1e-14) return std::nullopt;
    const double reciprocal = 1.0 / determinant;
    AffineTransform result{transform.d * reciprocal, -transform.b * reciprocal,
                           -transform.c * reciprocal, transform.a * reciprocal, 0.0, 0.0};
    result.e = -(result.a * transform.e + result.c * transform.f);
    result.f = -(result.b * transform.e + result.d * transform.f);
    return result;
}

double distanceSquared(Point a, Point b) {
    const double dx = a.x - b.x;
    const double dy = a.y - b.y;
    return dx * dx + dy * dy;
}

double pointSegmentDistanceSquared(Point point, Point start, Point end) {
    const double dx = end.x - start.x;
    const double dy = end.y - start.y;
    const double lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-20) return distanceSquared(point, start);
    const double amount = std::clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) /
                                     lengthSquared, 0.0, 1.0);
    return distanceSquared(point, {start.x + amount * dx, start.y + amount * dy});
}

} // namespace

bool parseCssColor(std::string_view cssColor, std::uint32_t& rgba) {
    const std::string value = trimLower(cssColor);
    if (value.empty()) return false;
    if (value[0] == '#') {
        const std::string_view digits(value.data() + 1, value.size() - 1);
        if (digits.size() != 3 && digits.size() != 4 && digits.size() != 6 && digits.size() != 8) return false;
        std::array<int, 4> channels{0, 0, 0, 255};
        if (digits.size() <= 4) {
            for (std::size_t i = 0; i < digits.size(); ++i) {
                const int nibble = hexDigit(digits[i]);
                if (nibble < 0) return false;
                channels[i] = nibble * 17;
            }
        } else {
            for (std::size_t i = 0; i < digits.size() / 2; ++i) {
                const int high = hexDigit(digits[i * 2]);
                const int low = hexDigit(digits[i * 2 + 1]);
                if (high < 0 || low < 0) return false;
                channels[i] = high * 16 + low;
            }
        }
        rgba = (static_cast<std::uint32_t>(channels[0]) << 24U) |
               (static_cast<std::uint32_t>(channels[1]) << 16U) |
               (static_cast<std::uint32_t>(channels[2]) << 8U) |
               static_cast<std::uint32_t>(channels[3]);
        return true;
    }

    const auto open = value.find('(');
    if (open != std::string::npos && value.back() == ')') {
        const std::string name = trimLower(std::string_view(value).substr(0, open));
        const auto arguments = splitColorArguments(std::string_view(value).substr(open + 1, value.size() - open - 2));
        if ((name == "rgb" || name == "rgba") && (arguments.size() == 3 || arguments.size() == 4)) {
            Color color{};
            if (!parseRgbComponent(arguments[0], color.r) || !parseRgbComponent(arguments[1], color.g) ||
                !parseRgbComponent(arguments[2], color.b)) return false;
            if (arguments.size() == 4 && !parseAlpha(arguments[3], color.a)) return false;
            rgba = packColor(color);
            return true;
        }
        if ((name == "hsl" || name == "hsla") && (arguments.size() == 3 || arguments.size() == 4)) {
            double hue = 0.0, saturation = 0.0, lightness = 0.0, alpha = 1.0;
            std::string saturationText = arguments[1];
            std::string lightnessText = arguments[2];
            if (!saturationText.ends_with('%') || !lightnessText.ends_with('%')) return false;
            saturationText.pop_back();
            lightnessText.pop_back();
            if (!parseDouble(arguments[0], hue) || !parseDouble(saturationText, saturation) ||
                !parseDouble(lightnessText, lightness)) return false;
            if (arguments.size() == 4 && !parseAlpha(arguments[3], alpha)) return false;
            rgba = packColor(hslToRgb(hue, saturation / 100.0, lightness / 100.0, alpha));
            return true;
        }
    }

    struct NamedColor { std::string_view name; std::uint32_t rgba; };
    static constexpr NamedColor named[] = {
        {"transparent", 0x00000000U}, {"black", 0x000000ffU}, {"white", 0xffffffffU},
        {"red", 0xff0000ffU}, {"green", 0x008000ffU}, {"blue", 0x0000ffffU},
        {"yellow", 0xffff00ffU}, {"gray", 0x808080ffU}, {"grey", 0x808080ffU},
        {"orange", 0xffa500ffU}, {"brown", 0xa52a2affU}, {"purple", 0x800080ffU},
        {"pink", 0xffc0cbffU}, {"cyan", 0x00ffffffU}, {"magenta", 0xff00ffffU},
    };
    for (const auto& entry : named) {
        if (value == entry.name) { rgba = entry.rgba; return true; }
    }
    return false;
}

LinearGradient::LinearGradient(double x0, double y0, double x1, double y1,
                               AffineTransform creationTransform)
    : x0_(x0), y0_(y0), x1_(x1), y1_(y1), transform_(creationTransform) {}

bool LinearGradient::addColorStop(double offset, std::string_view cssColor) {
    std::uint32_t rgba = 0;
    return parseCssColor(cssColor, rgba) && addColorStop(offset, rgba);
}

bool LinearGradient::addColorStop(double offset, std::uint32_t rgba) {
    if (!std::isfinite(offset) || offset < 0.0 || offset > 1.0) return false;
    stops_.push_back({offset, rgba});
    std::stable_sort(stops_.begin(), stops_.end(), [](const auto& left, const auto& right) {
        return left.offset < right.offset;
    });
    return true;
}

namespace {

struct Paint {
    enum class Kind { Solid, Linear } kind{Kind::Solid};
    std::uint32_t solid{0x000000ffU};
    LinearGradient gradient{};
};

enum class TextAlign { Left, Center, Right };
enum class TextBaseline { Alphabetic, Middle, Top, Bottom };

struct CanvasState {
    AffineTransform transform{};
    Paint fill{};
    Paint stroke{};
    double globalAlpha{1.0};
    double lineWidth{1.0};
    double miterLimit{10.0};
    bool roundCap{};
    bool roundJoin{};
    double blurRadius{};
    double fontSize{10.0};
    int fontWeight{400};
    bool italic{};
    TextAlign textAlign{TextAlign::Left};
    TextBaseline textBaseline{TextBaseline::Alphabetic};
    std::vector<std::uint8_t> clip{};
};

struct Subpath {
    std::vector<Point> points{};
    bool closed{};
};

struct Path {
    std::vector<Subpath> subpaths{};

    void clear() { subpaths.clear(); }
    [[nodiscard]] Point currentPoint() const {
        if (subpaths.empty() || subpaths.back().points.empty()) return {};
        return subpaths.back().points.back();
    }
    void moveTo(Point point) { subpaths.push_back({{point}, false}); }
    void lineTo(Point point) {
        if (subpaths.empty() || subpaths.back().points.empty()) moveTo(point);
        else subpaths.back().points.push_back(point);
    }
    void close() {
        if (!subpaths.empty() && subpaths.back().points.size() > 1) subpaths.back().closed = true;
    }
};

struct SurfaceImpl {
    int width{};
    int height{};
    std::vector<Pixel> pixels{};
    CanvasState state{};
    std::vector<CanvasState> stack{};
    Path path{};

    SurfaceImpl(int requestedWidth, int requestedHeight) { reset(requestedWidth, requestedHeight); }

    bool reset(int requestedWidth, int requestedHeight) {
        if (requestedWidth < 0 || requestedHeight < 0 || requestedWidth > kMaximumDimension ||
            requestedHeight > kMaximumDimension) return false;
        const std::size_t count = static_cast<std::size_t>(requestedWidth) * static_cast<std::size_t>(requestedHeight);
        if (requestedWidth != 0 && count / static_cast<std::size_t>(requestedWidth) != static_cast<std::size_t>(requestedHeight)) return false;
        width = requestedWidth;
        height = requestedHeight;
        pixels.assign(count, {});
        state = {};
        state.clip.assign(count, 255);
        stack.clear();
        path.clear();
        return true;
    }
};


double lineDistanceSquared(Point point, Point start, Point end) {
    const double dx = end.x - start.x;
    const double dy = end.y - start.y;
    const double denominator = dx * dx + dy * dy;
    if (denominator <= 1e-20) return distanceSquared(point, start);
    const double cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
    return cross * cross / denominator;
}

void flattenQuadratic(Path& path, Point start, Point control, Point end, int depth = 0) {
    if (depth >= 12 || lineDistanceSquared(control, start, end) <= 0.0625) {
        path.lineTo(end);
        return;
    }
    const Point startControl{(start.x + control.x) * 0.5, (start.y + control.y) * 0.5};
    const Point controlEnd{(control.x + end.x) * 0.5, (control.y + end.y) * 0.5};
    const Point middle{(startControl.x + controlEnd.x) * 0.5,
                       (startControl.y + controlEnd.y) * 0.5};
    flattenQuadratic(path, start, startControl, middle, depth + 1);
    flattenQuadratic(path, middle, controlEnd, end, depth + 1);
}

void flattenCubic(Path& path, Point start, Point control1, Point control2, Point end, int depth = 0) {
    const double flatness = std::max(lineDistanceSquared(control1, start, end),
                                     lineDistanceSquared(control2, start, end));
    if (depth >= 12 || flatness <= 0.0625) {
        path.lineTo(end);
        return;
    }
    const Point p01{(start.x + control1.x) * 0.5, (start.y + control1.y) * 0.5};
    const Point p12{(control1.x + control2.x) * 0.5, (control1.y + control2.y) * 0.5};
    const Point p23{(control2.x + end.x) * 0.5, (control2.y + end.y) * 0.5};
    const Point p012{(p01.x + p12.x) * 0.5, (p01.y + p12.y) * 0.5};
    const Point p123{(p12.x + p23.x) * 0.5, (p12.y + p23.y) * 0.5};
    const Point middle{(p012.x + p123.x) * 0.5, (p012.y + p123.y) * 0.5};
    flattenCubic(path, start, p01, p012, middle, depth + 1);
    flattenCubic(path, middle, p123, p23, end, depth + 1);
}

void appendEllipse(Path& path, const AffineTransform& transform, double centerX, double centerY,
                   double radiusX, double radiusY, double rotation, double startAngle,
                   double endAngle, bool counterClockwise) {
    if (!(radiusX >= 0.0) || !(radiusY >= 0.0) || !std::isfinite(startAngle) || !std::isfinite(endAngle)) return;
    double sweep = endAngle - startAngle;
    if (!counterClockwise) {
        while (sweep < 0.0) sweep += kTwoPi;
        sweep = std::min(sweep, kTwoPi);
    } else {
        while (sweep > 0.0) sweep -= kTwoPi;
        sweep = std::max(sweep, -kTwoPi);
    }
    if (std::abs(sweep) < 1e-14 && std::abs(endAngle - startAngle) >= kTwoPi) {
        sweep = counterClockwise ? -kTwoPi : kTwoPi;
    }
    const double axisX = std::hypot(transform.a * radiusX, transform.b * radiusX);
    const double axisY = std::hypot(transform.c * radiusY, transform.d * radiusY);
    const double maximumRadius = std::max({axisX, axisY, 1.0});
    const double step = std::max(0.01, 2.0 * std::acos(std::clamp(1.0 - 0.25 / maximumRadius, -1.0, 1.0)));
    const int segments = std::clamp(static_cast<int>(std::ceil(std::abs(sweep) / step)), 1, 4096);
    const double cosine = std::cos(rotation);
    const double sine = std::sin(rotation);
    auto ellipsePoint = [&](double angle) {
        const double localX = radiusX * std::cos(angle);
        const double localY = radiusY * std::sin(angle);
        return transformPoint(transform, {centerX + cosine * localX - sine * localY,
                                          centerY + sine * localX + cosine * localY});
    };
    const Point first = ellipsePoint(startAngle);
    if (path.subpaths.empty() || path.subpaths.back().points.empty()) path.moveTo(first);
    else if (distanceSquared(path.currentPoint(), first) > 1e-16) path.lineTo(first);
    for (int index = 1; index <= segments; ++index) {
        path.lineTo(ellipsePoint(startAngle + sweep * static_cast<double>(index) / segments));
    }
}

Path rectanglePath(const AffineTransform& transform, double x, double y, double width, double height) {
    Path result;
    result.moveTo(transformPoint(transform, {x, y}));
    result.lineTo(transformPoint(transform, {x + width, y}));
    result.lineTo(transformPoint(transform, {x + width, y + height}));
    result.lineTo(transformPoint(transform, {x, y + height}));
    result.close();
    return result;
}


struct Edge {
    Point start;
    Point end;
};

std::vector<Edge> fillEdges(const Path& path) {
    std::vector<Edge> edges;
    for (const auto& subpath : path.subpaths) {
        if (subpath.points.size() < 2) continue;
        for (std::size_t index = 1; index < subpath.points.size(); ++index) {
            edges.push_back({subpath.points[index - 1], subpath.points[index]});
        }
        if (distanceSquared(subpath.points.back(), subpath.points.front()) > 1e-20) {
            edges.push_back({subpath.points.back(), subpath.points.front()});
        }
    }
    return edges;
}

std::vector<std::uint8_t> rasterizeFill(const SurfaceImpl& surface, const Path& path, bool evenOdd = false) {
    const std::size_t pixelCount = static_cast<std::size_t>(surface.width) * static_cast<std::size_t>(surface.height);
    std::vector<std::uint8_t> counts(pixelCount, 0);
    const auto edges = fillEdges(path);
    if (edges.empty() || surface.width <= 0 || surface.height <= 0) return counts;

    double minimumY = std::numeric_limits<double>::infinity();
    double maximumY = -std::numeric_limits<double>::infinity();
    for (const auto& edge : edges) {
        minimumY = std::min({minimumY, edge.start.y, edge.end.y});
        maximumY = std::max({maximumY, edge.start.y, edge.end.y});
    }
    const int firstSubRow = std::max(0, static_cast<int>(std::ceil(minimumY * kSamples - 0.5)));
    const int lastSubRow = std::min(surface.height * kSamples - 1,
                                    static_cast<int>(std::ceil(maximumY * kSamples - 0.5)) - 1);
    struct Crossing { double x; int winding; };
    std::vector<Crossing> crossings;
    crossings.reserve(edges.size());
    for (int subRow = firstSubRow; subRow <= lastSubRow; ++subRow) {
        const double y = (static_cast<double>(subRow) + 0.5) / kSamples;
        crossings.clear();
        for (const auto& edge : edges) {
            if (std::abs(edge.start.y - edge.end.y) <= 1e-20) continue;
            const bool upward = edge.start.y <= y && y < edge.end.y;
            const bool downward = edge.end.y <= y && y < edge.start.y;
            if (!upward && !downward) continue;
            const double amount = (y - edge.start.y) / (edge.end.y - edge.start.y);
            crossings.push_back({edge.start.x + (edge.end.x - edge.start.x) * amount, upward ? 1 : -1});
        }
        std::sort(crossings.begin(), crossings.end(), [](const auto& left, const auto& right) {
            if (left.x != right.x) return left.x < right.x;
            return left.winding < right.winding;
        });
        int winding = 0;
        bool parity = false;
        double spanStart = 0.0;
        bool inside = false;
        for (std::size_t index = 0; index < crossings.size();) {
            const double x = crossings[index].x;
            const bool wasInside = evenOdd ? parity : winding != 0;
            int delta = 0;
            int crossingCount = 0;
            while (index < crossings.size() && std::abs(crossings[index].x - x) < 1e-12) {
                delta += crossings[index].winding;
                ++crossingCount;
                ++index;
            }
            winding += delta;
            if (crossingCount & 1) parity = !parity;
            const bool nowInside = evenOdd ? parity : winding != 0;
            if (!wasInside && nowInside) {
                spanStart = x;
                inside = true;
            } else if (wasInside && !nowInside && inside) {
                int firstSubColumn = static_cast<int>(std::ceil(spanStart * kSamples - 0.5));
                int lastSubColumn = static_cast<int>(std::ceil(x * kSamples - 0.5)) - 1;
                firstSubColumn = std::max(0, firstSubColumn);
                lastSubColumn = std::min(surface.width * kSamples - 1, lastSubColumn);
                const int pixelY = subRow / kSamples;
                for (int subColumn = firstSubColumn; subColumn <= lastSubColumn; ++subColumn) {
                    auto& count = counts[static_cast<std::size_t>(pixelY) * surface.width + subColumn / kSamples];
                    if (count < kCoverageSamples) ++count;
                }
                inside = false;
            }
        }
    }
    for (auto& count : counts) count = static_cast<std::uint8_t>((static_cast<int>(count) * 255 + 8) / 16);
    return counts;
}

std::vector<std::uint8_t> rasterizeStroke(const SurfaceImpl& surface, const Path& path, double lineWidth) {
    const std::size_t pixelCount = static_cast<std::size_t>(surface.width) * static_cast<std::size_t>(surface.height);
    std::vector<std::uint16_t> sampleMasks(pixelCount, 0);
    struct Segment { Point start; Point end; };
    std::vector<Segment> segments;
    for (const auto& subpath : path.subpaths) {
        for (std::size_t index = 1; index < subpath.points.size(); ++index) {
            segments.push_back({subpath.points[index - 1], subpath.points[index]});
        }
        if (subpath.closed && subpath.points.size() > 1) {
            segments.push_back({subpath.points.back(), subpath.points.front()});
        }
    }
    const double radius = std::max(0.0, lineWidth * 0.5);
    const double radiusSquared = radius * radius;
    // Rasterize each capsule only inside its narrow bounds and OR subpixel
    // masks. This keeps 2K strokeRect borders O(perimeter), not O(canvas area).
    for (const auto& segment : segments) {
        const int firstX = std::max(0, static_cast<int>(
            std::floor(std::min(segment.start.x, segment.end.x) - radius - 1.0)));
        const int firstY = std::max(0, static_cast<int>(
            std::floor(std::min(segment.start.y, segment.end.y) - radius - 1.0)));
        const int lastX = std::min(surface.width - 1, static_cast<int>(
            std::ceil(std::max(segment.start.x, segment.end.x) + radius + 1.0)));
        const int lastY = std::min(surface.height - 1, static_cast<int>(
            std::ceil(std::max(segment.start.y, segment.end.y) + radius + 1.0)));
        for (int y = firstY; y <= lastY; ++y) {
            for (int x = firstX; x <= lastX; ++x) {
                auto& mask = sampleMasks[static_cast<std::size_t>(y) * surface.width + x];
                if (mask == 0xffffU) continue;
                for (int sampleY = 0; sampleY < kSamples; ++sampleY) {
                    for (int sampleX = 0; sampleX < kSamples; ++sampleX) {
                        const int bit = sampleY * kSamples + sampleX;
                        if (mask & (1U << bit)) continue;
                        const Point sample{x + (sampleX + 0.5) / kSamples,
                                           y + (sampleY + 0.5) / kSamples};
                        if (pointSegmentDistanceSquared(sample, segment.start, segment.end) <= radiusSquared) {
                            mask = static_cast<std::uint16_t>(mask | (1U << bit));
                        }
                    }
                }
            }
        }
    }
    std::vector<std::uint8_t> coverage(pixelCount, 0);
    for (std::size_t index = 0; index < pixelCount; ++index) {
        coverage[index] = static_cast<std::uint8_t>(
            (std::popcount(sampleMasks[index]) * 255 + 8) / 16);
    }
    return coverage;
}

Color samplePaint(const Paint& paint, double x, double y) {
    if (paint.kind == Paint::Kind::Solid) return unpackColor(paint.solid);
    if (paint.gradient.stops().empty()) return {};
    const auto& gradient = paint.gradient;
    const Point start = transformPoint(gradient.creationTransform(), {gradient.x0(), gradient.y0()});
    const Point end = transformPoint(gradient.creationTransform(), {gradient.x1(), gradient.y1()});
    const double dx = end.x - start.x;
    const double dy = end.y - start.y;
    const double denominator = dx * dx + dy * dy;
    double amount = denominator > 1e-20 ? ((x - start.x) * dx + (y - start.y) * dy) / denominator : 0.0;
    amount = clamp01(amount);
    const auto& stops = gradient.stops();
    if (amount <= stops.front().offset) return unpackColor(stops.front().rgba);
    if (amount >= stops.back().offset) return unpackColor(stops.back().rgba);
    const auto upper = std::upper_bound(stops.begin(), stops.end(), amount,
        [](double value, const GradientStop& stop) { return value < stop.offset; });
    const auto& right = *upper;
    const auto& left = *(upper - 1);
    const double span = right.offset - left.offset;
    const double t = span > 1e-20 ? (amount - left.offset) / span : 0.0;
    const Color a = unpackColor(left.rgba);
    const Color b = unpackColor(right.rgba);
    return {a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t,
            a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t};
}

Pixel premultiplied(Color color, double opacity = 1.0) {
    const double alpha = clamp01(color.a * opacity);
    return {byteFromUnit(color.r * alpha), byteFromUnit(color.g * alpha),
            byteFromUnit(color.b * alpha), byteFromUnit(alpha)};
}

void sourceOver(Pixel& destination, const Pixel& source, double opacity = 1.0) {
    const double appliedOpacity = clamp01(opacity);
    const int sourceAlpha = std::clamp(static_cast<int>(std::lround(source.a * appliedOpacity)), 0, 255);
    const int inverseAlpha = 255 - sourceAlpha;
    const auto blendChannel = [&](std::uint8_t sourceChannel, std::uint8_t destinationChannel) {
        const int scaledSource = static_cast<int>(std::lround(sourceChannel * appliedOpacity));
        return static_cast<std::uint8_t>(
            std::clamp(scaledSource + (destinationChannel * inverseAlpha + 127) / 255, 0, 255));
    };
    destination.r = blendChannel(source.r, destination.r);
    destination.g = blendChannel(source.g, destination.g);
    destination.b = blendChannel(source.b, destination.b);
    destination.a = static_cast<std::uint8_t>(
        std::clamp(sourceAlpha + (destination.a * inverseAlpha + 127) / 255, 0, 255));
}

void boxBlurOnce(std::vector<Pixel>& pixels, int width, int height, int radius) {
    if (radius <= 0 || width <= 0 || height <= 0) return;
    std::vector<Pixel> temporary(pixels.size());
    const int diameter = radius * 2 + 1;
    for (int y = 0; y < height; ++y) {
        std::array<int, 4> sums{};
        for (int offset = -radius; offset <= radius; ++offset) {
            const Pixel& pixel = pixels[static_cast<std::size_t>(y) * width +
                                          std::clamp(offset, 0, width - 1)];
            sums[0] += pixel.r; sums[1] += pixel.g; sums[2] += pixel.b; sums[3] += pixel.a;
        }
        for (int x = 0; x < width; ++x) {
            temporary[static_cast<std::size_t>(y) * width + x] = {
                static_cast<std::uint8_t>((sums[0] + diameter / 2) / diameter),
                static_cast<std::uint8_t>((sums[1] + diameter / 2) / diameter),
                static_cast<std::uint8_t>((sums[2] + diameter / 2) / diameter),
                static_cast<std::uint8_t>((sums[3] + diameter / 2) / diameter),
            };
            const Pixel& removed = pixels[static_cast<std::size_t>(y) * width +
                                            std::clamp(x - radius, 0, width - 1)];
            const Pixel& added = pixels[static_cast<std::size_t>(y) * width +
                                          std::clamp(x + radius + 1, 0, width - 1)];
            sums[0] += added.r - removed.r; sums[1] += added.g - removed.g;
            sums[2] += added.b - removed.b; sums[3] += added.a - removed.a;
        }
    }
    for (int x = 0; x < width; ++x) {
        std::array<int, 4> sums{};
        for (int offset = -radius; offset <= radius; ++offset) {
            const Pixel& pixel = temporary[static_cast<std::size_t>(std::clamp(offset, 0, height - 1)) *
                                           width + x];
            sums[0] += pixel.r; sums[1] += pixel.g; sums[2] += pixel.b; sums[3] += pixel.a;
        }
        for (int y = 0; y < height; ++y) {
            pixels[static_cast<std::size_t>(y) * width + x] = {
                static_cast<std::uint8_t>((sums[0] + diameter / 2) / diameter),
                static_cast<std::uint8_t>((sums[1] + diameter / 2) / diameter),
                static_cast<std::uint8_t>((sums[2] + diameter / 2) / diameter),
                static_cast<std::uint8_t>((sums[3] + diameter / 2) / diameter),
            };
            const Pixel& removed = temporary[static_cast<std::size_t>(std::clamp(y - radius, 0, height - 1)) *
                                             width + x];
            const Pixel& added = temporary[static_cast<std::size_t>(std::clamp(y + radius + 1, 0, height - 1)) *
                                           width + x];
            sums[0] += added.r - removed.r; sums[1] += added.g - removed.g;
            sums[2] += added.b - removed.b; sums[3] += added.a - removed.a;
        }
    }
}

void applyBlur(std::vector<Pixel>& pixels, int width, int height, double radius) {
    if (radius <= 0.0) return;
    const int boxRadius = std::max(1, static_cast<int>(std::lround(radius * 0.58)));
    for (int pass = 0; pass < 3; ++pass) boxBlurOnce(pixels, width, height, boxRadius);
}

void renderCoverage(SurfaceImpl& surface, const std::vector<std::uint8_t>& coverage,
                    const Paint& paint, bool clear = false) {
    if (coverage.size() != surface.pixels.size()) return;
    if (clear) {
        for (std::size_t index = 0; index < coverage.size(); ++index) {
            const double amount = static_cast<double>(coverage[index]) / 255.0 *
                                  static_cast<double>(surface.state.clip[index]) / 255.0;
            const double retain = 1.0 - clamp01(amount);
            auto& pixel = surface.pixels[index];
            pixel.r = static_cast<std::uint8_t>(std::lround(pixel.r * retain));
            pixel.g = static_cast<std::uint8_t>(std::lround(pixel.g * retain));
            pixel.b = static_cast<std::uint8_t>(std::lround(pixel.b * retain));
            pixel.a = static_cast<std::uint8_t>(std::lround(pixel.a * retain));
        }
        return;
    }

    if (surface.state.blurRadius <= 0.0) {
        for (int y = 0; y < surface.height; ++y) {
            for (int x = 0; x < surface.width; ++x) {
                const std::size_t index = static_cast<std::size_t>(y) * surface.width + x;
                if (!coverage[index] || !surface.state.clip[index]) continue;
                const double opacity = surface.state.globalAlpha * coverage[index] / 255.0 *
                                       surface.state.clip[index] / 255.0;
                sourceOver(surface.pixels[index],
                           premultiplied(samplePaint(paint, x + 0.5, y + 0.5)), opacity);
            }
        }
        return;
    }

    std::vector<Pixel> layer(surface.pixels.size());
    for (int y = 0; y < surface.height; ++y) {
        for (int x = 0; x < surface.width; ++x) {
            const std::size_t index = static_cast<std::size_t>(y) * surface.width + x;
            if (!coverage[index]) continue;
            layer[index] = premultiplied(samplePaint(paint, x + 0.5, y + 0.5),
                                         coverage[index] / 255.0);
        }
    }
    applyBlur(layer, surface.width, surface.height, surface.state.blurRadius);
    for (std::size_t index = 0; index < layer.size(); ++index) {
        if (!layer[index].a || !surface.state.clip[index]) continue;
        sourceOver(surface.pixels[index], layer[index],
                   surface.state.globalAlpha * surface.state.clip[index] / 255.0);
    }
}

void applyClip(SurfaceImpl& surface, const std::vector<std::uint8_t>& coverage) {
    if (coverage.size() != surface.state.clip.size()) return;
    for (std::size_t index = 0; index < coverage.size(); ++index) {
        surface.state.clip[index] = static_cast<std::uint8_t>(
            (static_cast<int>(surface.state.clip[index]) * coverage[index] + 127) / 255);
    }
}


struct GlyphBitmap {
    std::array<std::uint8_t, 7> rows{};
    double advance{0.62};
    double scale{1.0};
    double yOffset{};
};

GlyphBitmap glyphBitmap(std::uint32_t codepoint) {
    if (codepoint >= 'a' && codepoint <= 'z') codepoint -= ('a' - 'A');
    GlyphBitmap glyph{};
    switch (codepoint) {
        case 'A': glyph.rows={14,17,17,31,17,17,17}; break;
        case 'B': glyph.rows={30,17,17,30,17,17,30}; break;
        case 'C': glyph.rows={14,17,16,16,16,17,14}; break;
        case 'D': glyph.rows={30,17,17,17,17,17,30}; break;
        case 'E': glyph.rows={31,16,16,30,16,16,31}; break;
        case 'F': glyph.rows={31,16,16,30,16,16,16}; break;
        case 'G': glyph.rows={14,17,16,23,17,17,15}; break;
        case 'H': glyph.rows={17,17,17,31,17,17,17}; break;
        case 'I': glyph.rows={14,4,4,4,4,4,14}; glyph.advance=.36; break;
        case 'J': glyph.rows={7,2,2,2,18,18,12}; break;
        case 'K': glyph.rows={17,18,20,24,20,18,17}; break;
        case 'L': glyph.rows={16,16,16,16,16,16,31}; break;
        case 'M': glyph.rows={17,27,21,21,17,17,17}; glyph.advance=.78; break;
        case 'N': glyph.rows={17,25,21,19,17,17,17}; break;
        case 'O': glyph.rows={14,17,17,17,17,17,14}; break;
        case 'P': glyph.rows={30,17,17,30,16,16,16}; break;
        case 'Q': glyph.rows={14,17,17,17,21,18,13}; break;
        case 'R': glyph.rows={30,17,17,30,20,18,17}; break;
        case 'S': glyph.rows={15,16,16,14,1,1,30}; break;
        case 'T': glyph.rows={31,4,4,4,4,4,4}; break;
        case 'U': glyph.rows={17,17,17,17,17,17,14}; break;
        case 'V': glyph.rows={17,17,17,17,17,10,4}; break;
        case 'W': glyph.rows={17,17,17,21,21,21,10}; glyph.advance=.8; break;
        case 'X': glyph.rows={17,17,10,4,10,17,17}; break;
        case 'Y': glyph.rows={17,17,10,4,4,4,4}; break;
        case 'Z': glyph.rows={31,1,2,4,8,16,31}; break;
        case '0': glyph.rows={14,17,19,21,25,17,14}; break;
        case '1': glyph.rows={4,12,4,4,4,4,14}; glyph.advance=.48; break;
        case '2': glyph.rows={14,17,1,2,4,8,31}; break;
        case '3': glyph.rows={30,1,1,14,1,1,30}; break;
        case '4': glyph.rows={2,6,10,18,31,2,2}; break;
        case '5': glyph.rows={31,16,16,30,1,1,30}; break;
        case '6': glyph.rows={14,16,16,30,17,17,14}; break;
        case '7': glyph.rows={31,1,2,4,8,8,8}; break;
        case '8': glyph.rows={14,17,17,14,17,17,14}; break;
        case '9': glyph.rows={14,17,17,15,1,1,14}; break;
        case '.': glyph.rows={0,0,0,0,0,12,12}; glyph.advance=.3; break;
        case ',': glyph.rows={0,0,0,0,0,12,8}; glyph.advance=.3; break;
        case ':': glyph.rows={0,12,12,0,12,12,0}; glyph.advance=.32; break;
        case ';': glyph.rows={0,12,12,0,12,8,16}; glyph.advance=.32; break;
        case '!': glyph.rows={4,4,4,4,4,0,4}; glyph.advance=.3; break;
        case '?': glyph.rows={14,17,1,2,4,0,4}; break;
        case '-': glyph.rows={0,0,0,31,0,0,0}; glyph.advance=.45; break;
        case '_': glyph.rows={0,0,0,0,0,0,31}; break;
        case '+': glyph.rows={0,4,4,31,4,4,0}; break;
        case '=': glyph.rows={0,0,31,0,31,0,0}; break;
        case '/': glyph.rows={1,2,2,4,8,8,16}; glyph.advance=.45; break;
        case '\\': glyph.rows={16,8,8,4,2,2,1}; glyph.advance=.45; break;
        case '|': glyph.rows={4,4,4,4,4,4,4}; glyph.advance=.3; break;
        case '(': glyph.rows={2,4,8,8,8,4,2}; glyph.advance=.36; break;
        case ')': glyph.rows={8,4,2,2,2,4,8}; glyph.advance=.36; break;
        case '[': glyph.rows={14,8,8,8,8,8,14}; glyph.advance=.36; break;
        case ']': glyph.rows={14,2,2,2,2,2,14}; glyph.advance=.36; break;
        case '<': glyph.rows={2,4,8,16,8,4,2}; break;
        case '>': glyph.rows={8,4,2,1,2,4,8}; break;
        case '#': glyph.rows={10,31,10,10,31,10,0}; break;
        case '%': glyph.rows={25,26,2,4,8,11,19}; glyph.advance=.72; break;
        case '&': glyph.rows={12,18,20,8,21,18,13}; break;
        case '*': glyph.rows={0,21,14,31,14,21,0}; break;
        case '"': glyph.rows={10,10,10,0,0,0,0}; glyph.advance=.4; break;
        case '\'': glyph.rows={4,4,4,0,0,0,0}; glyph.advance=.25; break;
        case 0x00b0: glyph.rows={6,9,9,6,0,0,0}; glyph.advance=.38; glyph.scale=.65; break;
        case 0x00b7: glyph.rows={0,0,0,4,0,0,0}; glyph.advance=.32; break;
        case 0x00d7: glyph.rows={0,17,10,4,10,17,0}; break;
        case 0x03c6: glyph.rows={4,14,21,21,21,14,4}; break;
        case 0x2013: glyph.rows={0,0,0,31,0,0,0}; glyph.advance=.55; break;
        case 0x2014: glyph.rows={0,0,0,31,0,0,0}; glyph.advance=.9; break;
        case 0x2212: glyph.rows={0,0,0,31,0,0,0}; glyph.advance=.62; break;
        case 0x2082: glyph.rows={0,0,14,17,2,4,31}; glyph.advance=.45; glyph.scale=.7; glyph.yOffset=.28; break;
        case 0x25b8: glyph.rows={16,24,28,30,28,24,16}; glyph.advance=.62; break;
        case 0x200a: glyph.advance=.12; break;
        case ' ': glyph.advance=.34; break;
        default: glyph.rows={31,17,2,4,0,4,0}; break;
    }
    return glyph;
}

std::vector<std::uint32_t> decodeUtf8(std::string_view text) {
    std::vector<std::uint32_t> result;
    for (std::size_t index = 0; index < text.size();) {
        const auto first = static_cast<unsigned char>(text[index++]);
        if (first < 0x80) {
            result.push_back(first);
            continue;
        }
        std::uint32_t codepoint = 0xfffd;
        int trailing = 0;
        if ((first & 0xe0U) == 0xc0U) codepoint = first & 0x1fU, trailing = 1;
        else if ((first & 0xf0U) == 0xe0U) codepoint = first & 0x0fU, trailing = 2;
        else if ((first & 0xf8U) == 0xf0U) codepoint = first & 0x07U, trailing = 3;
        else { result.push_back(codepoint); continue; }
        bool valid = index + static_cast<std::size_t>(trailing) <= text.size();
        for (int offset = 0; valid && offset < trailing; ++offset) {
            const auto continuation = static_cast<unsigned char>(text[index++]);
            if ((continuation & 0xc0U) != 0x80U) { valid = false; break; }
            codepoint = (codepoint << 6U) | (continuation & 0x3fU);
        }
        result.push_back(valid ? codepoint : 0xfffd);
    }
    return result;
}

double textWidth(const CanvasState& state, std::string_view text) {
    double ems = 0.0;
    for (const auto codepoint : decodeUtf8(text)) ems += glyphBitmap(codepoint).advance;
    return ems * state.fontSize;
}

Path textPath(const CanvasState& state, std::string_view text, double x, double y,
              double maximumWidth = std::numeric_limits<double>::infinity()) {
    Path path;
    const auto codepoints = decodeUtf8(text);
    const double unscaledWidth = textWidth(state, text);
    const double horizontalScale = unscaledWidth > 0.0 && std::isfinite(maximumWidth) && maximumWidth > 0.0
        ? std::min(1.0, maximumWidth / unscaledWidth) : 1.0;
    const double width = unscaledWidth * horizontalScale;
    double cursor = x;
    if (state.textAlign == TextAlign::Center) cursor -= width * 0.5;
    else if (state.textAlign == TextAlign::Right) cursor -= width;

    double top = y - state.fontSize * 0.8;
    if (state.textBaseline == TextBaseline::Middle) top = y - state.fontSize * 0.5;
    else if (state.textBaseline == TextBaseline::Top) top = y;
    else if (state.textBaseline == TextBaseline::Bottom) top = y - state.fontSize;

    const double boldExpansion = state.fontSize * 0.016 *
        std::clamp((state.fontWeight - 400) / 400.0, 0.0, 1.0);
    for (const auto codepoint : codepoints) {
        const GlyphBitmap glyph = glyphBitmap(codepoint);
        const double advance = glyph.advance * state.fontSize * horizontalScale;
        bool hasInk = false;
        for (const auto row : glyph.rows) hasInk = hasInk || row != 0;
        if (hasInk) {
            const double glyphHeight = state.fontSize * glyph.scale;
            const double glyphTop = top + glyph.yOffset * state.fontSize +
                                    (1.0 - glyph.scale) * state.fontSize * 0.5;
            const double glyphWidth = std::max(0.0, (glyph.advance - 0.08) * state.fontSize *
                                                     horizontalScale);
            const double cellWidth = glyphWidth / 5.0;
            const double cellHeight = glyphHeight / 7.0;
            for (int row = 0; row < 7; ++row) {
                for (int column = 0; column < 5; ++column) {
                    if (!(glyph.rows[static_cast<std::size_t>(row)] & (1U << (4 - column)))) continue;
                    const double italicOffset = state.italic ? (6 - row) * state.fontSize * 0.012 : 0.0;
                    const double left = cursor + italicOffset + column * cellWidth - boldExpansion;
                    const double glyphY = glyphTop + row * cellHeight - boldExpansion;
                    const double right = cursor + italicOffset + (column + 1) * cellWidth + boldExpansion;
                    const double bottom = glyphTop + (row + 1) * cellHeight + boldExpansion;
                    const double insetX = std::min(cellWidth * 0.06, state.fontSize * 0.8 / 64.0);
                    const double insetY = std::min(cellHeight * 0.06, state.fontSize * 0.8 / 64.0);
                    Path cell = rectanglePath(state.transform, left + insetX, glyphY + insetY,
                                              std::max(0.0, right - left - 2.0 * insetX),
                                              std::max(0.0, bottom - glyphY - 2.0 * insetY));
                    path.subpaths.insert(path.subpaths.end(), cell.subpaths.begin(), cell.subpaths.end());
                }
            }
        }
        cursor += advance;
    }
    return path;
}

} // namespace



struct CanvasSurface::Impl : SurfaceImpl {
    using SurfaceImpl::SurfaceImpl;
};

CanvasSurface::CanvasSurface(int width, int height) : impl_(new Impl(width, height)) {}
CanvasSurface::~CanvasSurface() { delete impl_; }

CanvasSurface::CanvasSurface(CanvasSurface&& other) noexcept : impl_(std::exchange(other.impl_, nullptr)) {}

CanvasSurface& CanvasSurface::operator=(CanvasSurface&& other) noexcept {
    if (this != &other) {
        delete impl_;
        impl_ = std::exchange(other.impl_, nullptr);
    }
    return *this;
}

int CanvasSurface::width() const noexcept { return impl_ ? impl_->width : 0; }
int CanvasSurface::height() const noexcept { return impl_ ? impl_->height : 0; }

bool CanvasSurface::resize(int width, int height) {
    return impl_ && impl_->reset(width, height);
}

bool CanvasSurface::setNumber(std::string_view name, double value) {
    if (!impl_ || !std::isfinite(value)) return false;
    if (name == "globalAlpha") {
        if (value < 0.0 || value > 1.0) return false;
        impl_->state.globalAlpha = value;
        return true;
    }
    if (name == "lineWidth") {
        if (value <= 0.0) return false;
        impl_->state.lineWidth = value;
        return true;
    }
    if (name == "miterLimit") {
        if (value <= 0.0) return false;
        impl_->state.miterLimit = value;
        return true;
    }
    return false;
}

bool CanvasSurface::setString(std::string_view name, std::string_view value) {
    if (!impl_) return false;
    if (name == "fillStyle" || name == "strokeStyle") {
        std::uint32_t rgba = 0;
        if (!parseCssColor(value, rgba)) return false;
        Paint& paint = name == "fillStyle" ? impl_->state.fill : impl_->state.stroke;
        paint.kind = Paint::Kind::Solid;
        paint.solid = rgba;
        return true;
    }
    const std::string normalized = trimLower(value);
    if (name == "textAlign") {
        if (normalized == "left" || normalized == "start") impl_->state.textAlign = TextAlign::Left;
        else if (normalized == "center") impl_->state.textAlign = TextAlign::Center;
        else if (normalized == "right" || normalized == "end") impl_->state.textAlign = TextAlign::Right;
        else return false;
        return true;
    }
    if (name == "textBaseline") {
        if (normalized == "middle") impl_->state.textBaseline = TextBaseline::Middle;
        else if (normalized == "top" || normalized == "hanging") impl_->state.textBaseline = TextBaseline::Top;
        else if (normalized == "bottom" || normalized == "ideographic") impl_->state.textBaseline = TextBaseline::Bottom;
        else if (normalized == "alphabetic") impl_->state.textBaseline = TextBaseline::Alphabetic;
        else return false;
        return true;
    }
    if (name == "lineCap") {
        if (normalized != "butt" && normalized != "round" && normalized != "square") return false;
        impl_->state.roundCap = normalized == "round";
        return true;
    }
    if (name == "lineJoin") {
        if (normalized != "miter" && normalized != "round" && normalized != "bevel") return false;
        impl_->state.roundJoin = normalized == "round";
        return true;
    }
    if (name == "filter") {
        if (normalized == "none" || normalized.empty()) {
            impl_->state.blurRadius = 0.0;
            return true;
        }
        const auto blur = normalized.find("blur(");
        const auto pixels = normalized.find("px", blur == std::string::npos ? 0 : blur + 5);
        if (blur == std::string::npos || pixels == std::string::npos) return false;
        double radius = 0.0;
        if (!parseDouble(std::string_view(normalized).substr(blur + 5, pixels - blur - 5), radius) || radius < 0.0) {
            return false;
        }
        impl_->state.blurRadius = radius;
        return true;
    }
    if (name == "font") {
        const auto pixels = normalized.find("px");
        if (pixels == std::string::npos) return false;
        std::size_t first = pixels;
        while (first > 0 && (std::isdigit(static_cast<unsigned char>(normalized[first - 1])) ||
                             normalized[first - 1] == '.')) --first;
        double size = 0.0;
        if (!parseDouble(std::string_view(normalized).substr(first, pixels - first), size) || size <= 0.0) return false;
        impl_->state.fontSize = size;
        impl_->state.italic = normalized.find("italic") != std::string::npos ||
                              normalized.find("oblique") != std::string::npos;
        impl_->state.fontWeight = normalized.find("bold") != std::string::npos ? 700 : 400;
        const std::string prefix = normalized.substr(0, first);
        for (int weight : {800, 700, 600, 500, 400, 300, 200, 100}) {
            if (prefix.find(std::to_string(weight)) != std::string::npos) {
                impl_->state.fontWeight = weight;
                break;
            }
        }
        return true;
    }
    return false;
}

bool CanvasSurface::setGradient(std::string_view name, const LinearGradient& gradient) {
    if (!impl_ || (name != "fillStyle" && name != "strokeStyle")) return false;
    Paint& paint = name == "fillStyle" ? impl_->state.fill : impl_->state.stroke;
    paint.kind = Paint::Kind::Linear;
    paint.gradient = gradient;
    return true;
}

LinearGradient CanvasSurface::createLinearGradient(double x0, double y0, double x1, double y1) const {
    return LinearGradient(x0, y0, x1, y1, impl_ ? impl_->state.transform : AffineTransform{});
}

bool CanvasSurface::call(std::string_view operation, std::span<const double> numbers,
                         std::string_view text) {
    if (!impl_) return false;
    auto need = [&](std::size_t count) {
        if (numbers.size() < count) return false;
        for (std::size_t index = 0; index < count; ++index) if (!std::isfinite(numbers[index])) return false;
        return true;
    };
    if (operation == "save") {
        impl_->stack.push_back(impl_->state);
        return true;
    }
    if (operation == "restore") {
        if (!impl_->stack.empty()) {
            impl_->state = std::move(impl_->stack.back());
            impl_->stack.pop_back();
        }
        return true;
    }
    if (operation == "translate") {
        if (!need(2)) return false;
        impl_->state.transform = multiply(impl_->state.transform,
                                          {1, 0, 0, 1, numbers[0], numbers[1]});
        return true;
    }
    if (operation == "scale") {
        if (!need(2)) return false;
        impl_->state.transform = multiply(impl_->state.transform,
                                          {numbers[0], 0, 0, numbers[1], 0, 0});
        return true;
    }
    if (operation == "rotate") {
        if (!need(1)) return false;
        const double cosine = std::cos(numbers[0]);
        const double sine = std::sin(numbers[0]);
        impl_->state.transform = multiply(impl_->state.transform,
                                          {cosine, sine, -sine, cosine, 0, 0});
        return true;
    }
    if (operation == "transform") {
        if (!need(6)) return false;
        impl_->state.transform = multiply(impl_->state.transform,
            {numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], numbers[5]});
        return true;
    }
    if (operation == "setTransform") {
        if (!need(6)) return false;
        impl_->state.transform = {numbers[0], numbers[1], numbers[2],
                                  numbers[3], numbers[4], numbers[5]};
        return true;
    }
    if (operation == "resetTransform") {
        impl_->state.transform = {};
        return true;
    }
    if (operation == "beginPath") {
        impl_->path.clear();
        return true;
    }
    if (operation == "closePath") {
        impl_->path.close();
        return true;
    }
    if (operation == "moveTo") {
        if (!need(2)) return false;
        impl_->path.moveTo(transformPoint(impl_->state.transform, {numbers[0], numbers[1]}));
        return true;
    }
    if (operation == "lineTo") {
        if (!need(2)) return false;
        impl_->path.lineTo(transformPoint(impl_->state.transform, {numbers[0], numbers[1]}));
        return true;
    }
    if (operation == "quadraticCurveTo") {
        if (!need(4)) return false;
        if (impl_->path.subpaths.empty()) {
            impl_->path.moveTo(transformPoint(impl_->state.transform, {numbers[0], numbers[1]}));
        }
        const Point start = impl_->path.currentPoint();
        const Point control = transformPoint(impl_->state.transform, {numbers[0], numbers[1]});
        const Point end = transformPoint(impl_->state.transform, {numbers[2], numbers[3]});
        flattenQuadratic(impl_->path, start, control, end);
        return true;
    }
    if (operation == "bezierCurveTo") {
        if (!need(6)) return false;
        if (impl_->path.subpaths.empty()) {
            impl_->path.moveTo(transformPoint(impl_->state.transform, {numbers[0], numbers[1]}));
        }
        const Point start = impl_->path.currentPoint();
        flattenCubic(impl_->path, start,
                     transformPoint(impl_->state.transform, {numbers[0], numbers[1]}),
                     transformPoint(impl_->state.transform, {numbers[2], numbers[3]}),
                     transformPoint(impl_->state.transform, {numbers[4], numbers[5]}));
        return true;
    }
    if (operation == "arc") {
        if (!need(5)) return false;
        if (numbers[2] < 0.0) return false;
        appendEllipse(impl_->path, impl_->state.transform, numbers[0], numbers[1],
                      numbers[2], numbers[2], 0.0, numbers[3], numbers[4],
                      numbers.size() > 5 && numbers[5] != 0.0);
        return true;
    }
    if (operation == "ellipse") {
        if (!need(7) || numbers[2] < 0.0 || numbers[3] < 0.0) return false;
        appendEllipse(impl_->path, impl_->state.transform, numbers[0], numbers[1],
                      numbers[2], numbers[3], numbers[4], numbers[5], numbers[6],
                      numbers.size() > 7 && numbers[7] != 0.0);
        return true;
    }
    if (operation == "rect") {
        if (!need(4)) return false;
        Path rectangle = rectanglePath(impl_->state.transform, numbers[0], numbers[1], numbers[2], numbers[3]);
        impl_->path.subpaths.insert(impl_->path.subpaths.end(),
                                    rectangle.subpaths.begin(), rectangle.subpaths.end());
        return true;
    }
    if (operation == "fill" || operation == "fillEvenOdd") {
        renderCoverage(*impl_, rasterizeFill(*impl_, impl_->path, operation == "fillEvenOdd"),
                       impl_->state.fill);
        return true;
    }
    if (operation == "stroke") {
        const double determinant = impl_->state.transform.a * impl_->state.transform.d -
                                   impl_->state.transform.b * impl_->state.transform.c;
        const double scale = std::sqrt(std::abs(determinant));
        renderCoverage(*impl_, rasterizeStroke(*impl_, impl_->path,
                                               impl_->state.lineWidth * scale),
                       impl_->state.stroke);
        return true;
    }
    if (operation == "clip" || operation == "clipEvenOdd") {
        applyClip(*impl_, rasterizeFill(*impl_, impl_->path, operation == "clipEvenOdd"));
        return true;
    }
    if (operation == "fillRect" || operation == "strokeRect" || operation == "clearRect") {
        if (!need(4)) return false;
        const Path rectangle = rectanglePath(impl_->state.transform, numbers[0], numbers[1],
                                             numbers[2], numbers[3]);
        if (operation == "fillRect") {
            renderCoverage(*impl_, rasterizeFill(*impl_, rectangle), impl_->state.fill);
        } else if (operation == "clearRect") {
            renderCoverage(*impl_, rasterizeFill(*impl_, rectangle), impl_->state.fill, true);
        } else {
            const double determinant = impl_->state.transform.a * impl_->state.transform.d -
                                       impl_->state.transform.b * impl_->state.transform.c;
            renderCoverage(*impl_, rasterizeStroke(*impl_, rectangle,
                                                   impl_->state.lineWidth * std::sqrt(std::abs(determinant))),
                           impl_->state.stroke);
        }
        return true;
    }
    if (operation == "fillText") {
        if (!need(2)) return false;
        const double maximumWidth = numbers.size() > 2 && numbers[2] > 0.0
            ? numbers[2] : std::numeric_limits<double>::infinity();
        renderCoverage(*impl_, rasterizeFill(*impl_,
                       textPath(impl_->state, text, numbers[0], numbers[1], maximumWidth)),
                       impl_->state.fill);
        return true;
    }
    return false;
}

TextMetrics CanvasSurface::measureText(std::string_view utf8) const {
    if (!impl_) return {};
    const double width = textWidth(impl_->state, utf8);
    return {width, 0.0, width, impl_->state.fontSize * 0.8,
            impl_->state.fontSize * 0.2, impl_->state.fontSize * 0.8,
            impl_->state.fontSize * 0.2};
}


bool CanvasSurface::writePixels(int destinationX, int destinationY, int sourceWidth,
                                int sourceHeight, std::span<const std::uint8_t> straightRgba,
                                int sourceX, int sourceY, int copyWidth, int copyHeight) {
    if (!impl_ || sourceWidth < 0 || sourceHeight < 0) return false;
    const std::size_t required = static_cast<std::size_t>(sourceWidth) *
                                 static_cast<std::size_t>(sourceHeight) * 4U;
    if (straightRgba.size() < required) return false;
    if (copyWidth < 0) copyWidth = sourceWidth;
    if (copyHeight < 0) copyHeight = sourceHeight;
    if (copyWidth <= 0 || copyHeight <= 0) return true;
    const int firstSourceX = std::max(0, sourceX);
    const int firstSourceY = std::max(0, sourceY);
    const int lastSourceX = std::min(sourceWidth, sourceX + copyWidth);
    const int lastSourceY = std::min(sourceHeight, sourceY + copyHeight);
    for (int y = firstSourceY; y < lastSourceY; ++y) {
        const int targetY = destinationY + y;
        if (targetY < 0 || targetY >= impl_->height) continue;
        for (int x = firstSourceX; x < lastSourceX; ++x) {
            const int targetX = destinationX + x;
            if (targetX < 0 || targetX >= impl_->width) continue;
            const std::size_t sourceIndex = (static_cast<std::size_t>(y) * sourceWidth + x) * 4U;
            const int alpha = straightRgba[sourceIndex + 3];
            impl_->pixels[static_cast<std::size_t>(targetY) * impl_->width + targetX] = {
                static_cast<std::uint8_t>((straightRgba[sourceIndex] * alpha + 127) / 255),
                static_cast<std::uint8_t>((straightRgba[sourceIndex + 1] * alpha + 127) / 255),
                static_cast<std::uint8_t>((straightRgba[sourceIndex + 2] * alpha + 127) / 255),
                static_cast<std::uint8_t>(alpha),
            };
        }
    }
    return true;
}

std::vector<std::uint8_t> CanvasSurface::readPixels(int x, int y, int requestedWidth,
                                                    int requestedHeight) const {
    if (!impl_) return {};
    if (requestedWidth < 0) requestedWidth = impl_->width;
    if (requestedHeight < 0) requestedHeight = impl_->height;
    if (requestedWidth < 0 || requestedHeight < 0 ||
        requestedWidth > kMaximumDimension || requestedHeight > kMaximumDimension) return {};
    const std::size_t count = static_cast<std::size_t>(requestedWidth) *
                              static_cast<std::size_t>(requestedHeight);
    std::vector<std::uint8_t> output(count * 4U, 0);
    for (int row = 0; row < requestedHeight; ++row) {
        const int sourceY = y + row;
        if (sourceY < 0 || sourceY >= impl_->height) continue;
        for (int column = 0; column < requestedWidth; ++column) {
            const int sourceX = x + column;
            if (sourceX < 0 || sourceX >= impl_->width) continue;
            const Pixel& pixel = impl_->pixels[static_cast<std::size_t>(sourceY) * impl_->width + sourceX];
            const std::size_t outputIndex = (static_cast<std::size_t>(row) * requestedWidth + column) * 4U;
            output[outputIndex + 3] = pixel.a;
            if (pixel.a) {
                output[outputIndex] = static_cast<std::uint8_t>(
                    std::min(255, (static_cast<int>(pixel.r) * 255 + pixel.a / 2) / pixel.a));
                output[outputIndex + 1] = static_cast<std::uint8_t>(
                    std::min(255, (static_cast<int>(pixel.g) * 255 + pixel.a / 2) / pixel.a));
                output[outputIndex + 2] = static_cast<std::uint8_t>(
                    std::min(255, (static_cast<int>(pixel.b) * 255 + pixel.a / 2) / pixel.a));
            }
        }
    }
    return output;
}

namespace {

Pixel bilinearSample(const SurfaceImpl& source, double x, double y) {
    if (source.width <= 0 || source.height <= 0) return {};
    const double clampedX = std::clamp(x, 0.0, static_cast<double>(source.width - 1));
    const double clampedY = std::clamp(y, 0.0, static_cast<double>(source.height - 1));
    const int x0 = static_cast<int>(std::floor(clampedX));
    const int y0 = static_cast<int>(std::floor(clampedY));
    const int x1 = std::min(source.width - 1, x0 + 1);
    const int y1 = std::min(source.height - 1, y0 + 1);
    const double tx = clampedX - x0;
    const double ty = clampedY - y0;
    const Pixel& a = source.pixels[static_cast<std::size_t>(y0) * source.width + x0];
    const Pixel& b = source.pixels[static_cast<std::size_t>(y0) * source.width + x1];
    const Pixel& c = source.pixels[static_cast<std::size_t>(y1) * source.width + x0];
    const Pixel& d = source.pixels[static_cast<std::size_t>(y1) * source.width + x1];
    auto channel = [&](int offset) {
        const auto get = [&](const Pixel& pixel) {
            return reinterpret_cast<const std::uint8_t*>(&pixel)[offset];
        };
        const double top = get(a) + (get(b) - get(a)) * tx;
        const double bottom = get(c) + (get(d) - get(c)) * tx;
        return static_cast<std::uint8_t>(std::clamp(std::lround(top + (bottom - top) * ty), 0L, 255L));
    };
    return {channel(0), channel(1), channel(2), channel(3)};
}

} // namespace

bool CanvasSurface::drawImage(const CanvasSurface& source, std::span<const double> numbers) {
    if (!impl_ || !source.impl_ || (numbers.size() != 2 && numbers.size() != 4 && numbers.size() != 8)) {
        return false;
    }
    for (const double number : numbers) if (!std::isfinite(number)) return false;
    double sourceX = 0.0, sourceY = 0.0;
    double sourceWidth = source.impl_->width, sourceHeight = source.impl_->height;
    double destinationX = 0.0, destinationY = 0.0;
    double destinationWidth = sourceWidth, destinationHeight = sourceHeight;
    if (numbers.size() == 2) {
        destinationX = numbers[0]; destinationY = numbers[1];
    } else if (numbers.size() == 4) {
        destinationX = numbers[0]; destinationY = numbers[1];
        destinationWidth = numbers[2]; destinationHeight = numbers[3];
    } else {
        sourceX = numbers[0]; sourceY = numbers[1];
        sourceWidth = numbers[2]; sourceHeight = numbers[3];
        destinationX = numbers[4]; destinationY = numbers[5];
        destinationWidth = numbers[6]; destinationHeight = numbers[7];
    }
    if (sourceWidth == 0.0 || sourceHeight == 0.0 ||
        destinationWidth == 0.0 || destinationHeight == 0.0) return true;
    if (sourceWidth < 0.0) { sourceX += sourceWidth; sourceWidth = -sourceWidth; }
    if (sourceHeight < 0.0) { sourceY += sourceHeight; sourceHeight = -sourceHeight; }
    if (destinationWidth < 0.0) { destinationX += destinationWidth; destinationWidth = -destinationWidth; }
    if (destinationHeight < 0.0) { destinationY += destinationHeight; destinationHeight = -destinationHeight; }
    const auto inverseTransform = inverse(impl_->state.transform);
    if (!inverseTransform) return true;

    const std::array<Point, 4> corners{
        transformPoint(impl_->state.transform, {destinationX, destinationY}),
        transformPoint(impl_->state.transform, {destinationX + destinationWidth, destinationY}),
        transformPoint(impl_->state.transform, {destinationX + destinationWidth, destinationY + destinationHeight}),
        transformPoint(impl_->state.transform, {destinationX, destinationY + destinationHeight}),
    };
    double minimumX = corners[0].x, maximumX = corners[0].x;
    double minimumY = corners[0].y, maximumY = corners[0].y;
    for (const auto& corner : corners) {
        minimumX = std::min(minimumX, corner.x); maximumX = std::max(maximumX, corner.x);
        minimumY = std::min(minimumY, corner.y); maximumY = std::max(maximumY, corner.y);
    }
    const int firstX = std::max(0, static_cast<int>(std::floor(minimumX)));
    const int firstY = std::max(0, static_cast<int>(std::floor(minimumY)));
    const int lastX = std::min(impl_->width - 1, static_cast<int>(std::ceil(maximumX)));
    const int lastY = std::min(impl_->height - 1, static_cast<int>(std::ceil(maximumY)));
    const auto nearlyInteger = [](double value) {
        return std::abs(value - std::round(value)) <= 1e-9;
    };
    const bool axisAligned = std::abs(impl_->state.transform.b) <= 1e-12 &&
                             std::abs(impl_->state.transform.c) <= 1e-12;
    const bool pixelAligned = std::all_of(corners.begin(), corners.end(), [&](Point corner) {
        return nearlyInteger(corner.x) && nearlyInteger(corner.y);
    });
    const bool integerSourceRect = nearlyInteger(sourceX) && nearlyInteger(sourceY) &&
                                   nearlyInteger(sourceWidth) && nearlyInteger(sourceHeight) &&
                                   sourceX >= 0.0 && sourceY >= 0.0 &&
                                   sourceX + sourceWidth <= source.impl_->width &&
                                   sourceY + sourceHeight <= source.impl_->height;
    const bool exactPixelSampling = axisAligned && pixelAligned && integerSourceRect &&
        std::abs(std::abs(impl_->state.transform.a) * destinationWidth - sourceWidth) <= 1e-9 &&
        std::abs(std::abs(impl_->state.transform.d) * destinationHeight - sourceHeight) <= 1e-9;
    std::vector<Pixel> layer(impl_->pixels.size());
    for (int y = firstY; y <= lastY; ++y) {
        for (int x = firstX; x <= lastX; ++x) {
            std::array<int, 4> totals{};
            int coveredSamples = 0;
            for (int sampleY = 0; sampleY < kSamples; ++sampleY) {
                for (int sampleX = 0; sampleX < kSamples; ++sampleX) {
                    const Point local = transformPoint(*inverseTransform,
                        {x + (sampleX + 0.5) / kSamples, y + (sampleY + 0.5) / kSamples});
                    const double u = (local.x - destinationX) / destinationWidth;
                    const double v = (local.y - destinationY) / destinationHeight;
                    if (u < 0.0 || u >= 1.0 || v < 0.0 || v >= 1.0) continue;
                    const double imageX = sourceX + u * sourceWidth;
                    const double imageY = sourceY + v * sourceHeight;
                    if (imageX < 0.0 || imageY < 0.0 ||
                        imageX >= source.impl_->width || imageY >= source.impl_->height) continue;
                    ++coveredSamples;
                    if (exactPixelSampling) continue;
                    const Pixel sample = bilinearSample(*source.impl_, imageX - 0.5, imageY - 0.5);
                    totals[0] += sample.r; totals[1] += sample.g;
                    totals[2] += sample.b; totals[3] += sample.a;
                }
            }
            if (exactPixelSampling && coveredSamples > 0) {
                // Keep supersampled edge coverage, but a genuinely 1:1,
                // pixel-aligned copy takes color from the mapped pixel center.
                // Subpixel bilinear samples otherwise mix the adjacent texel
                // even though no scaling is taking place.
                const Point localCenter = transformPoint(*inverseTransform, {x + 0.5, y + 0.5});
                const double u = (localCenter.x - destinationX) / destinationWidth;
                const double v = (localCenter.y - destinationY) / destinationHeight;
                const int imageX = static_cast<int>(std::floor(sourceX + u * sourceWidth));
                const int imageY = static_cast<int>(std::floor(sourceY + v * sourceHeight));
                if (imageX >= 0 && imageX < source.impl_->width &&
                    imageY >= 0 && imageY < source.impl_->height) {
                    const Pixel sample = source.impl_->pixels[
                        static_cast<std::size_t>(imageY) * source.impl_->width + imageX];
                    totals[0] = sample.r * coveredSamples;
                    totals[1] = sample.g * coveredSamples;
                    totals[2] = sample.b * coveredSamples;
                    totals[3] = sample.a * coveredSamples;
                }
            }
            layer[static_cast<std::size_t>(y) * impl_->width + x] = {
                static_cast<std::uint8_t>((totals[0] + 8) / 16),
                static_cast<std::uint8_t>((totals[1] + 8) / 16),
                static_cast<std::uint8_t>((totals[2] + 8) / 16),
                static_cast<std::uint8_t>((totals[3] + 8) / 16),
            };
        }
    }
    if (impl_->state.blurRadius > 0.0) {
        applyBlur(layer, impl_->width, impl_->height, impl_->state.blurRadius);
    }
    for (std::size_t index = 0; index < layer.size(); ++index) {
        if (!layer[index].a || !impl_->state.clip[index]) continue;
        sourceOver(impl_->pixels[index], layer[index],
                   impl_->state.globalAlpha * impl_->state.clip[index] / 255.0);
    }
    return true;
}

std::vector<std::uint8_t> CanvasSurface::encodePng() const {
    if (!impl_ || impl_->width <= 0 || impl_->height <= 0) return {};
    const auto rgba = readPixels();
    std::vector<std::uint8_t> output;
    auto callback = [](void* context, void* data, int size) {
        auto& bytes = *static_cast<std::vector<std::uint8_t>*>(context);
        const auto* first = static_cast<const std::uint8_t*>(data);
        bytes.insert(bytes.end(), first, first + size);
    };
    if (!stbi_write_png_to_func(callback, &output, impl_->width, impl_->height, 4,
                                rgba.data(), impl_->width * 4)) return {};
    return output;
}

} // namespace threebrowser::canvas2d

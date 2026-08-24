#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace threebrowser::canvas2d {

struct AffineTransform {
    double a{1.0};
    double b{0.0};
    double c{0.0};
    double d{1.0};
    double e{0.0};
    double f{0.0};
};

struct GradientStop {
    double offset{};
    std::uint32_t rgba{}; // 0xRRGGBBAA, straight alpha
};

class LinearGradient {
public:
    LinearGradient() = default;
    LinearGradient(double x0, double y0, double x1, double y1,
                   AffineTransform creationTransform = {});

    bool addColorStop(double offset, std::string_view cssColor);
    bool addColorStop(double offset, std::uint32_t rgba);

    [[nodiscard]] double x0() const noexcept { return x0_; }
    [[nodiscard]] double y0() const noexcept { return y0_; }
    [[nodiscard]] double x1() const noexcept { return x1_; }
    [[nodiscard]] double y1() const noexcept { return y1_; }
    [[nodiscard]] const AffineTransform& creationTransform() const noexcept { return transform_; }
    [[nodiscard]] const std::vector<GradientStop>& stops() const noexcept { return stops_; }

private:
    double x0_{};
    double y0_{};
    double x1_{};
    double y1_{};
    AffineTransform transform_{};
    std::vector<GradientStop> stops_{};
};

struct TextMetrics {
    double width{};
    double actualBoundingBoxLeft{};
    double actualBoundingBoxRight{};
    double actualBoundingBoxAscent{};
    double actualBoundingBoxDescent{};
    double fontBoundingBoxAscent{};
    double fontBoundingBoxDescent{};
};

// Dependency-free Canvas2D software surface. Pixels are stored internally as
// premultiplied RGBA8 and exposed through readPixels as straight RGBA8.
class CanvasSurface {
public:
    CanvasSurface(int width, int height);
    ~CanvasSurface();
    CanvasSurface(CanvasSurface&&) noexcept;
    CanvasSurface& operator=(CanvasSurface&&) noexcept;
    CanvasSurface(const CanvasSurface&) = delete;
    CanvasSurface& operator=(const CanvasSurface&) = delete;

    [[nodiscard]] int width() const noexcept;
    [[nodiscard]] int height() const noexcept;
    bool resize(int width, int height);

    // Generic property bridge used by the N-API host. Supported numeric names:
    // globalAlpha, lineWidth, miterLimit. Supported string names: fillStyle,
    // strokeStyle, font, textAlign, textBaseline, lineCap, lineJoin, filter.
    bool setNumber(std::string_view name, double value);
    bool setString(std::string_view name, std::string_view value);
    bool setGradient(std::string_view name, const LinearGradient& gradient);
    [[nodiscard]] LinearGradient createLinearGradient(double x0, double y0,
                                                      double x1, double y1) const;

    // Generic immediate-mode operation bridge. Numeric argument order follows
    // the browser Canvas2D method with the same name. Text is used by fillText.
    bool call(std::string_view operation, std::span<const double> numbers = {},
              std::string_view text = {});

    [[nodiscard]] TextMetrics measureText(std::string_view utf8) const;

    // ImageData methods use straight, row-major RGBA8. writePixels follows
    // putImageData semantics and ignores transform, alpha, clip, and filter.
    bool writePixels(int destinationX, int destinationY, int sourceWidth,
                     int sourceHeight, std::span<const std::uint8_t> straightRgba,
                     int sourceX = 0, int sourceY = 0,
                     int copyWidth = -1, int copyHeight = -1);
    [[nodiscard]] std::vector<std::uint8_t> readPixels(int x = 0, int y = 0,
                                                       int width = -1,
                                                       int height = -1) const;

    // Arguments use drawImage's 2-, 4-, or 8-number forms after the source:
    // dx,dy | dx,dy,dw,dh | sx,sy,sw,sh,dx,dy,dw,dh.
    bool drawImage(const CanvasSurface& source, std::span<const double> numbers);

    [[nodiscard]] std::vector<std::uint8_t> encodePng() const;

private:
    struct Impl;
    Impl* impl_{};
};

// Parses the CSS colors required by the runtime (#rgb[a], #rrggbb[aa],
// rgb[a](), hsl[a](), transparent and common named colors) to 0xRRGGBBAA.
bool parseCssColor(std::string_view cssColor, std::uint32_t& rgba);

} // namespace threebrowser::canvas2d

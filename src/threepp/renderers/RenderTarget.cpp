
#include "threepp/renderers/RenderTarget.hpp"

#include "threepp/math/MathUtils.hpp"

using namespace threepp;

namespace {

Image makeRenderTargetImage(unsigned int width, unsigned int height, unsigned int depth, Type type) {
    if (type == Type::Float) {
        return Image(std::vector<float>{}, width, height, depth);
    }
    if (type == Type::HalfFloat) {
        return Image(std::vector<std::uint16_t>{}, width, height, depth);
    }
    return Image(std::vector<unsigned char>{}, width, height, depth);
}

}// namespace


std::unique_ptr<RenderTarget> RenderTarget::create(unsigned int width, unsigned int height, const Options& options) {

    return std::make_unique<RenderTarget>(width, height, options);
}

RenderTarget::RenderTarget(unsigned int width, unsigned int height, const Options& options)
    : uuid(math::generateUUID()),
      width(width), height(height),
      scissor(0.f, 0.f, static_cast<float>(width), static_cast<float>(height)),
      viewport(0.f, 0.f, static_cast<float>(width), static_cast<float>(height)),
      depthBuffer(options.depthBuffer), stencilBuffer(options.stencilBuffer),
      samples(options.samples) {

    const auto count = std::max(1u, options.count);
    const auto textureType = options.type.value_or(Type::UnsignedByte);
    textures.reserve(count);
    for (unsigned int i = 0; i < count; ++i) {
        textures.emplace_back(Texture::create({makeRenderTargetImage(width, height, 0, textureType)}));
    }
    texture = textures.front();

    for (const auto& targetTexture : textures) {
        if (options.mapping) targetTexture->mapping = *options.mapping;
        if (options.wrapS) targetTexture->wrapS = *options.wrapS;
        if (options.wrapT) targetTexture->wrapT = *options.wrapT;
        if (options.magFilter) targetTexture->magFilter = *options.magFilter;
        if (options.minFilter) targetTexture->minFilter = *options.minFilter;
        if (options.format) targetTexture->format = *options.format;
        if (options.type) targetTexture->type = *options.type;
        if (options.anisotropy) targetTexture->anisotropy = *options.anisotropy;
        if (options.encoding) targetTexture->colorSpace = *options.encoding;
    }

    if (options.depthTexture) depthTexture = options.depthTexture;

}

void RenderTarget::setSize(unsigned int width, unsigned int height, unsigned int depth) {

    if (this->width != width || this->height != height || this->depth != depth) {

        this->width = width;
        this->height = height;
        this->depth = depth;

        for (const auto& targetTexture : textures) {
            targetTexture->image() = makeRenderTargetImage(width, height, depth, targetTexture->type);
        }

        // Tell the backend to drop the GPU resources sized for the old
        // dimensions. Deliberately not dispose(): that latches on `disposed` so
        // the destructor can't double-fire, and a target has to survive being
        // resized more than once — a composer resized twice would otherwise
        // keep rendering into framebuffers of the first new size.
        this->dispatchEvent("dispose", this);
    }

    this->viewport.set(0, 0, static_cast<float>(width), static_cast<float>(height));
    this->scissor.set(0, 0, static_cast<float>(width), static_cast<float>(height));
}

RenderTarget& RenderTarget::copy(const RenderTarget& source) {

    this->width = source.width;
    this->height = source.height;
    this->depth = source.depth;

    this->viewport.copy(source.viewport);

    this->texture = source.texture;
    this->textures = source.textures;
    //                this->texture.image = { ...this->texture.image }; // See #20328.

    this->depthBuffer = source.depthBuffer;
    this->stencilBuffer = source.stencilBuffer;
    this->samples = source.samples;
    this->depthTexture = source.depthTexture;

    return *this;
}

void RenderTarget::dispose() {

    if (!disposed) {

        disposed = true;
        this->dispatchEvent("dispose", this);
    }
}

RenderTarget::~RenderTarget() {

    dispose();
}

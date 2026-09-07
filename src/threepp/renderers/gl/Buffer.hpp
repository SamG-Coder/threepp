
#ifndef THREEPP_BUFFER_HPP
#define THREEPP_BUFFER_HPP
#include <cstdint>

namespace threepp::gl {

    struct Buffer {
        unsigned int buffer{};
        int type{};
        int bytesPerElement{};
        unsigned int version{};
        uint64_t generation{};
    };

}// namespace threepp::gl

#endif//THREEPP_BUFFER_HPP

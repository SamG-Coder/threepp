#pragma once

#include <stdint.h>

#ifdef _WIN32
#ifdef THREE_WEBGPU_EXPORT
#define TW_API __declspec(dllexport)
#else
#define TW_API __declspec(dllimport)
#endif
#else
#define TW_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

TW_API int tw_start(void* parent_hwnd, int x, int y, int w, int h);
TW_API int tw_attach_host(void* parent_hwnd, int x, int y, int w, int h);
TW_API void tw_set_size(int w, int h);
TW_API void tw_set_vsync(int on);
TW_API void* tw_hwnd(void);
TW_API void tw_stats(int* fps, int* frame_us, int* width, int* height, int* vsync, uint64_t* presents);
TW_API int tw_is_open(void);
TW_API void tw_shutdown(void);
TW_API void tw_reset(void);
TW_API const char* tw_last_error(void);
TW_API const char* tw_backend_name(void);
TW_API int tw_cmd_submit(const uint8_t* data, int nbytes);
TW_API int tw_map_read(uint32_t buffer_handle, uint64_t offset, uint64_t size, void* dst, int dst_bytes);

#ifdef __cplusplus
}
#endif

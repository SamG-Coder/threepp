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

enum {
    TW_INPUT_POINTER_MOVE = 1,
    TW_INPUT_POINTER_DOWN = 2,
    TW_INPUT_POINTER_UP = 3,
    TW_INPUT_WHEEL = 4,
    TW_INPUT_KEY_DOWN = 5,
    TW_INPUT_KEY_UP = 6,
    TW_INPUT_POINTER_LOCK_LOST = 7,
    TW_INPUT_POINTER_CANCEL = 8,
    TW_INPUT_POINTER_LEAVE = 9,
    TW_INPUT_HORIZONTAL_WHEEL = 10,
    TW_INPUT_POINTER_DOUBLE_CLICK = 11
};

typedef struct TWInputEvent {
    int type;
    int code;
    int x;
    int y;
    int movement_x;
    int movement_y;
    int modifiers;
} TWInputEvent;

TW_API int tw_start(void* parent_hwnd, int x, int y, int w, int h);
TW_API void tw_set_standalone_ui(int on);
TW_API int tw_attach_host(void* parent_hwnd, int x, int y, int w, int h);
TW_API void tw_set_size(int w, int h);
TW_API void tw_set_vsync(int on);
TW_API void* tw_hwnd(void);
TW_API int tw_take_wheel_delta(void);
TW_API int tw_backlog(void);
TW_API int tw_content_offset_y(void);
TW_API void tw_set_overlay(int on);
TW_API int tw_overlay_open(void);
TW_API void tw_overlay_click(int x, int y);
TW_API void tw_toggle_fps_overlay(void);
TW_API int tw_overlay_visible(void);
TW_API const uint8_t* tw_overlay_raster(int width, int height, int fps, int frame_us,
                                        const char* backend, int backlog, uint64_t packets,
                                        int* row_bytes);
TW_API int tw_set_pointer_lock(int on);
TW_API int tw_poll_input(TWInputEvent* events, int capacity);
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

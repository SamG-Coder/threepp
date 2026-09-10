#pragma once
#include "three_native.h"
#include <stddef.h>

struct TNRawGLResult {
    int kind; // 0 void, 1 number, 3 string, 4 active variable, 5 array, -1 error
    int count;
    double values[16];
    char text[4096];
};
extern "C" {
TN_API void tn_raw_gl_call(int op, const double* args, const void* data, size_t bytes, void* output, TNRawGLResult* result);
TN_API void tn_raw_gl_reset();
TN_API void tn_raw_gl_begin_batch();
TN_API void tn_raw_gl_command(const void* data,size_t bytes,TNRawGLResult* result);
}

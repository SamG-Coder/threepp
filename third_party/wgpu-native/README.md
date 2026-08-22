# ThreeBrowser wgpu-native build

The checked-in Windows GNU binaries are based on:

- `wgpu-native` commit `6aed50955d934ac36049ba8d002034841633ae02`
- `wgpu` commit `923b896955655600c38ac93d6e9ae26845682f80`

They retain the existing ThreeBrowser Vulkan exclusive-fullscreen changes and
add native Vulkan context, command-buffer and texture-image accessors used by
the runtime. When `THREEBROWSER_STREAMLINE_VULKAN` is set, the Vulkan backend
loads entry points from the signed `sl.interposer.dll`; otherwise it loads the
system Vulkan loader exactly as upstream does. This keeps Streamline isolated
to opted-in Windows runtime builds.

The binaries are built for `x86_64-pc-windows-gnu` with Rust 1.93 using only the
`vulkan,wgsl,spirv,glsl` features. The public additions are declared in
`include/webgpu/wgpu.h` and exported by `lib/wgpu_native.dll`.

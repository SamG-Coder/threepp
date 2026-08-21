# ThreeBrowserDroid

Android port of the ThreeBrowser host. This is a separate Android Studio project,
not an Android skin around the WinForms executable.

## Current milestone

- Android `WebView` browser with URL/search navigation, history, reload, and home.
- A real C++ OpenGL ES 3 renderer owning an Android `Surface` through JNI.
- Surface attach/detach, resize, pause/resume, and shutdown are serialized so that
  rotation, backgrounding, and navigation do not retain a dead `ANativeWindow`.
- Native mode intercepts recognized three.js core entry points and serves the
  repository's shared `three-native` compatibility slices through an Android
  host-object adapter.
- A bounded JNI command submission entry point accepts the same 8 MiB command ring
  used by desktop ThreeBrowser.
- `arm64-v8a` and emulator `x86_64` builds.

The Android renderer begins with the scene/camera/geometry/material/mesh command
subset. Advanced textures, skinning, PMREM, WebGPU and Vulkan remain desktop-only.

## Architecture

```text
Android WebView (stock websites)
       | JavascriptInterface / byte[]
       v
JNI command boundary (C++20)
       |
       v
ANativeWindow + EGL + OpenGL ES 3
```

Android requires a small managed Activity to host `WebView`; rendering and native
resource ownership live in C++. The Windows-only WebView2 COM and HWND parenting
code is intentionally not copied.

## Build

Open this directory in Android Studio, install SDK 37, NDK, and CMake 3.22.1, then
run the `app` configuration. From a terminal with an Android SDK configured:

```shell
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`. The project wrapper uses Gradle 9.4.1;
AGP installs its pinned CMake and default NDK packages when their SDK licenses have
already been accepted. A successful debug build writes
`app/build/outputs/apk/debug/app-debug.apk`.

## Porting sequence

Completed in the first vertical slice:

1. Android `ANativeWindow`/EGL lifecycle independent of GLFW and HWND.
2. Android host-object adapter and three.js request interception.
3. Shared desktop JavaScript command producer feeding a native GLES decoder.
4. WebView/native-surface composition with browser touch handling retained.
5. Built-in page that can be compared between Web and Native modes.

Next parity layers are textures and material maps, more geometry/object opcodes,
lighting, instancing, and loaders. Sandbox storage can then move to app-private
files/Storage Access Framework. The offline model harness should come later because
desktop Ollama is not available as a loopback service on a normal Android device.

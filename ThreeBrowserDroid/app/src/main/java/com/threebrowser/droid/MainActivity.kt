package com.threebrowser.droid

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Build
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.Base64
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var nativeSurface: NativeSurfaceView
    private lateinit var address: EditText
    private lateinit var mode: ImageButton
    private lateinit var progress: ProgressBar
    private lateinit var back: ImageButton
    private lateinit var forward: ImageButton
    @Volatile private var nativeMode = false
    @Volatile private var nativeClassicSource: String? = null
    @Volatile private var nativeEsmSource: String? = null
    private var targetFrameRate = 60f

    private val homeUrl = "https://threebrowser.local/index.html"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureHighRefreshRate()
        setContentView(createUi())
        configureWebView()

        if (savedInstanceState == null) {
            navigate(intent?.dataString ?: homeUrl)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    @Suppress("DEPRECATION")
    private fun configureHighRefreshRate() {
        val display = windowManager.defaultDisplay
        val current = display.mode
        val fastest = display.supportedModes
            .asSequence()
            .filter {
                it.physicalWidth == current.physicalWidth &&
                    it.physicalHeight == current.physicalHeight
            }
            .maxByOrNull { it.refreshRate } ?: current
        targetFrameRate = fastest.refreshRate.coerceIn(60f, 240f)
        window.attributes = window.attributes.apply {
            preferredDisplayModeId = fastest.modeId
            preferredRefreshRate = targetFrameRate
        }
    }

    private fun createUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(245, 246, 248))
            setOnApplyWindowInsetsListener { view, insets ->
                val top: Int
                val bottom: Int
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val safe = insets.getInsets(
                        android.view.WindowInsets.Type.statusBars() or
                            android.view.WindowInsets.Type.navigationBars() or
                            android.view.WindowInsets.Type.displayCutout()
                    )
                    top = safe.top
                    bottom = safe.bottom
                } else {
                    @Suppress("DEPRECATION")
                    top = insets.systemWindowInsetTop
                    @Suppress("DEPRECATION")
                    bottom = insets.systemWindowInsetBottom
                }
                view.setPadding(0, top, 0, bottom)
                insets
            }
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(245, 246, 248))
        }
        val navigationRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(2), dp(8), 0)
        }
        val addressRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), dp(7))
        }

        back = chromeButton(R.drawable.ic_back, "Back") { if (webView.canGoBack()) webView.goBack() }
        forward = chromeButton(R.drawable.ic_forward, "Forward") { if (webView.canGoForward()) webView.goForward() }
        back.isEnabled = false
        forward.isEnabled = false
        back.alpha = 0.32f
        forward.alpha = 0.32f
        val reload = chromeButton(R.drawable.ic_refresh, "Reload") { webView.reload() }
        val home = chromeButton(R.drawable.ic_home, "Home") { navigate(homeUrl) }

        mode = chromeButton(R.drawable.ic_native, "Enable native renderer") {
            setNativeMode(!nativeMode)
        }

        address = EditText(this).apply {
            isSingleLine = true
            textSize = 14f
            hint = "Search or enter address"
            setTextColor(Color.rgb(35, 39, 45))
            setHintTextColor(Color.rgb(117, 124, 134))
            setPadding(dp(12), 0, dp(12), 0)
            setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_public, 0, 0, 0)
            compoundDrawablePadding = dp(9)
            background = roundedBackground(Color.WHITE, Color.rgb(210, 215, 223), 20f)
            setOnEditorActionListener { _, _, event ->
                if (event == null || event.keyCode == KeyEvent.KEYCODE_ENTER) {
                    navigate(text.toString())
                    true
                } else false
            }
            setOnFocusChangeListener { _, focused -> if (focused) selectAll() }
        }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }

        navigationRow.addView(back, squareParams())
        navigationRow.addView(forward, squareParams())
        navigationRow.addView(reload, squareParams())
        navigationRow.addView(home, squareParams())
        navigationRow.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        navigationRow.addView(mode, squareParams())

        val go = chromeButton(R.drawable.ic_go, "Go") { navigate(address.text.toString()) }
        addressRow.addView(address, LinearLayout.LayoutParams(0, dp(42), 1f))
        addressRow.addView(go, LinearLayout.LayoutParams(dp(44), dp(42)).apply { marginStart = dp(4) })
        bar.addView(navigationRow, LinearLayout.LayoutParams(-1, dp(48)))

        val viewport = FrameLayout(this)
        nativeSurface = NativeSurfaceView(this).apply {
            visibility = View.GONE
            desiredFrameRate = targetFrameRate
        }
        webView = WebView(this)
        nativeSurface.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) dismissKeyboard()
            false
        }
        viewport.addView(nativeSurface, FrameLayout.LayoutParams(-1, -1))
        viewport.addView(webView, FrameLayout.LayoutParams(-1, -1))

        root.addView(bar, LinearLayout.LayoutParams(-1, dp(48)))
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(2)))
        root.addView(viewport, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(addressRow, LinearLayout.LayoutParams(-1, dp(54)))
        return root
    }

    private fun chromeButton(icon: Int, description: String, action: () -> Unit) = ImageButton(this).apply {
        setImageResource(icon)
        contentDescription = description
        setPadding(dp(11), dp(11), dp(11), dp(11))
        scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        val selectable = android.util.TypedValue()
        if (theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, selectable, true)) {
            setBackgroundResource(selectable.resourceId)
        } else {
            setBackgroundColor(Color.TRANSPARENT)
        }
        setOnClickListener { action() }
    }

    private fun dismissKeyboard() {
        address.clearFocus()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
    }

    private fun squareParams() = LinearLayout.LayoutParams(dp(44), dp(44))

    private fun roundedBackground(fill: Int, stroke: Int, radiusDp: Float) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fill)
        if (Color.alpha(stroke) != 0) setStroke(dp(1), stroke)
        cornerRadius = dp(radiusDp.toInt()).toFloat()
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
            builtInZoomControls = false
            displayZoomControls = false
        }
        webView.addJavascriptInterface(NativeJavascriptBridge(), "ThreeBrowserNative")
        if (
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
        ) {
            WebViewCompat.addWebMessageListener(
                webView,
                "ThreeBrowserCommands",
                setOf("*")
            ) { _, message, _, isMainFrame, _ ->
                if (
                    nativeMode && isMainFrame &&
                    message.type == WebMessageCompat.TYPE_ARRAY_BUFFER
                ) {
                    NativeRuntime.submitCommandsAsync(message.arrayBuffer)
                }
            }
        }
        webView.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) dismissKeyboard()
            false
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host.equals("threebrowser.local", ignoreCase = true)) {
                    return localWebResponse(request.url)
                }
                if (!nativeMode || !isThreeCoreLibrary(request.url.toString())) return null
                return nativeThreeResponse(isEsmLibrary(request.url.lastPathSegment.orEmpty()))
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (nativeMode) NativeRuntime.reset()
            }

            override fun onPageFinished(view: WebView, url: String) {
                address.setText(url)
                back.isEnabled = view.canGoBack()
                forward.isEnabled = view.canGoForward()
                back.alpha = if (back.isEnabled) 1f else 0.32f
                forward.alpha = if (forward.isEnabled) 1f else 0.32f
                title = "${view.title ?: "ThreeBrowserDroid"} – ThreeBrowserDroid"
            }
        }
    }

    private fun navigate(raw: String) {
        val value = raw.trim()
        if (value.isEmpty()) return
        val url = when {
            value.startsWith("http://") || value.startsWith("https://") || value.startsWith("file://") -> value
            value.contains('.') && !value.contains(' ') -> "https://$value"
            else -> "https://www.google.com/search?q=${android.net.Uri.encode(value)}"
        }
        address.clearFocus()
        webView.loadUrl(url)
    }

    private fun setNativeMode(enabled: Boolean) {
        if (nativeMode == enabled) return
        nativeMode = enabled
        mode.contentDescription = if (enabled) "Disable native renderer" else "Enable native renderer"
        mode.background = roundedBackground(
            if (enabled) Color.rgb(232, 241, 255) else Color.TRANSPARENT,
            if (enabled) Color.rgb(122, 165, 224) else Color.TRANSPARENT,
            18f
        )
        mode.setColorFilter(if (enabled) Color.rgb(22, 101, 205) else Color.rgb(95, 99, 104))
        nativeSurface.visibility = if (enabled) View.VISIBLE else View.GONE
        webView.visibility = View.VISIBLE
        webView.setBackgroundColor(if (enabled) Color.TRANSPARENT else Color.WHITE)
        if (enabled) {
            Toast.makeText(this, "${NativeRuntime.backendName()} native THREE", Toast.LENGTH_SHORT).show()
            NativeRuntime.resume()
        } else {
            NativeRuntime.pause()
        }
        if (::webView.isInitialized && webView.url != null) {
            // The same three.js URL has different bytes in Web and Native modes.
            // Force Chromium to ask shouldInterceptRequest again on mode changes.
            webView.clearCache(true)
            webView.reload()
        }
    }

    private fun isThreeCoreLibrary(url: String): Boolean {
        val uri = android.net.Uri.parse(url)
        if (uri.getQueryParameter("tb-raw") != null) return false
        val path = uri.path.orEmpty().lowercase()
        if (path.contains("/addons/") || path.contains("/jsm/") || path.contains("three-native")) return false
        val file = path.substringAfterLast('/')
        return file in setOf("three.module.js", "three.module.min.js", "three.min.js", "three.cjs") ||
            (file == "three.js" && (path.contains("/build/") || path.contains("/npm/three") || path.contains("/ajax/libs/three.js/")))
    }

    private fun localWebResponse(uri: android.net.Uri): WebResourceResponse {
        val path = uri.path.orEmpty().trimStart('/').ifEmpty { "index.html" }
        if (path.split('/').any { it == ".." }) {
            return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
        val mime = when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "svg" -> "image/svg+xml"
            "glb" -> "model/gltf-binary"
            "gltf" -> "model/gltf+json"
            else -> "application/octet-stream"
        }
        return try {
            WebResourceResponse(
                mime,
                if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")) "utf-8" else null,
                200,
                "OK",
                mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store"),
                assets.open(path)
            )
        } catch (_: java.io.FileNotFoundException) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
    }

    private fun isEsmLibrary(file: String): Boolean {
        val lower = file.lowercase()
        return lower.contains(".module.") || lower.endsWith(".mjs") || lower.endsWith(".cjs")
    }

    private fun nativeThreeResponse(esm: Boolean): WebResourceResponse {
        val cached = if (esm) nativeEsmSource else nativeClassicSource
        val source = cached ?: synchronized(this) {
            val slices = assets.list("three").orEmpty()
                .filter { it.endsWith(".js") }
                .sorted()
                .joinToString("\n") { name ->
                    assets.open("three/$name").bufferedReader().use { it.readText() }
                }
            val exports = assets.list("three/exports").orEmpty()
                .filter { it.endsWith(".txt") }
                .sorted()
                .flatMap { name ->
                    assets.open("three/exports/$name").bufferedReader().useLines { lines ->
                        lines.map(String::trim)
                            .filter { it.isNotEmpty() && !it.startsWith('#') }
                            .toList()
                    }
                }
                .toSortedSet()
            val footer = buildString {
                appendLine("const T = globalThis.THREE;")
                appendLine("export default T;")
                exports.forEach { appendLine("export const $it = T.$it;") }
            }
            nativeClassicSource = slices
            nativeEsmSource = "$slices\n$footer"
            if (esm) nativeEsmSource!! else nativeClassicSource!!
        }
        val adapter = """
            (() => {
              const b = globalThis.ThreeBrowserNative;
              if (!b) return;
              if (!globalThis.__threeBrowserNativeFrameClock) {
                const rawRequest = globalThis.requestAnimationFrame.bind(globalThis);
                const rawCancel = globalThis.cancelAnimationFrame.bind(globalThis);
                const callbacks = new Map();
                const interval = 1000 / ${targetFrameRate};
                let nextId = 1;
                let pumpId = 0;
                let lastFrame = -Infinity;

                const pump = timestamp => {
                  if (timestamp - lastFrame + 0.01 < interval) {
                    pumpId = rawRequest(pump);
                    return;
                  }
                  pumpId = 0;
                  lastFrame = timestamp;
                  const ready = Array.from(callbacks.entries());
                  callbacks.clear();
                  for (const [, callback] of ready) {
                    try { callback(timestamp); }
                    catch (error) { setTimeout(() => { throw error; }); }
                  }
                  if (callbacks.size && !pumpId) pumpId = rawRequest(pump);
                };

                globalThis.requestAnimationFrame = callback => {
                  const id = nextId++;
                  callbacks.set(id, callback);
                  if (!pumpId) pumpId = rawRequest(pump);
                  return id;
                };
                globalThis.cancelAnimationFrame = id => {
                  callbacks.delete(id);
                  if (!callbacks.size && pumpId) {
                    rawCancel(pumpId);
                    pumpId = 0;
                  }
                };
                globalThis.__threeBrowserNativeFrameClock = true;
              }
              const n = {
                RuntimeStart: (w,h,t) => b.runtimeStart(w,h,t),
                RuntimeSetSize: (w,h) => b.resize(w,h),
                BackendName: () => b.status(),
                LastError: () => '',
                CmdSubmitB64: data => b.submitBase64(data),
                CmdSubmitIntervalMs: () => 1000 / ${targetFrameRate},
                BoneCreate: () => b.boneCreate(),
                SkeletonCreate: bones => b.skeletonCreate(bones),
                SkeletonSetInverses: (skeleton,data) => b.skeletonSetInverses(skeleton,data),
                PmremFromObject: (id,obj) => b.pmremFromObject(id,obj),
                SceneSetEnvironment: (scene,texture) => b.sceneSetEnvironment(scene,texture),
                ShaderMaterialCreate: (vertex,fragment) => b.shaderMaterialCreate(vertex,fragment),
                ShaderSetFlags: (material,side,depthWrite) => b.shaderSetFlags(material,side,depthWrite),
                ShaderUniformFloat: (material,name,value) => b.shaderUniformFloat(material,name,value),
                ShaderUniformVec2: (material,name,x,y) => b.shaderUniformVec2(material,name,x,y),
                ShaderUniformVec3: (material,name,x,y,z) => b.shaderUniformVec3(material,name,x,y,z),
                ShaderUniformVec4: (material,name,x,y,z,w) => b.shaderUniformVec4(material,name,x,y,z,w),
                RuntimeRender: () => 1
              };
              if (globalThis.ThreeBrowserCommands?.postMessage) {
                n.CmdSubmitBuffer = data => ThreeBrowserCommands.postMessage(data);
              }
              globalThis.chrome = globalThis.chrome || {};
              chrome.webview = chrome.webview || {};
              chrome.webview.hostObjects = { sync: { native: n } };
            })();
        """.trimIndent()
        val bytes = "$adapter\n$source".toByteArray(Charsets.UTF_8)
        return WebResourceResponse(
            "application/javascript",
            "utf-8",
            200,
            "OK",
            mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store"),
            ByteArrayInputStream(bytes)
        )
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onPause() {
        NativeRuntime.pause()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (nativeMode) NativeRuntime.resume()
    }

    override fun onDestroy() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.stopLoading()
        webView.removeJavascriptInterface("ThreeBrowserNative")
        webView.destroy()
        NativeRuntime.shutdown()
        super.onDestroy()
    }

    private inner class NativeJavascriptBridge {
        @JavascriptInterface
        fun status(): String = "Native bridge: ${NativeRuntime.backendName()}"

        @JavascriptInterface
        fun runtimeStart(width: Int, height: Int, title: String): Int {
            NativeRuntime.resize(width, height)
            NativeRuntime.resume()
            return 1
        }

        @JavascriptInterface
        fun resize(width: Int, height: Int) = NativeRuntime.resize(width, height)

        @JavascriptInterface
        fun submitBase64(commands: String): Int = try {
            NativeRuntime.submitCommands(Base64.getDecoder().decode(commands))
        } catch (_: IllegalArgumentException) {
            -1
        }

        @JavascriptInterface
        fun boneCreate(): Int = NativeRuntime.createBone()

        @JavascriptInterface
        fun skeletonCreate(csv: String): Int = NativeRuntime.createSkeleton(
            csv.split(',').mapNotNull { it.trim().toLongOrNull()?.toInt() }.toIntArray()
        )

        @JavascriptInterface
        fun skeletonSetInverses(skeleton: Int, data: String): Int = try {
            NativeRuntime.setSkeletonInverses(skeleton, Base64.getDecoder().decode(data))
        } catch (_: IllegalArgumentException) {
            0
        }

        @JavascriptInterface
        fun pmremFromObject(id: Int, objectId: Int): Int =
            NativeRuntime.pmremFromObject(id, objectId)

        @JavascriptInterface
        fun sceneSetEnvironment(scene: Int, texture: Int) =
            NativeRuntime.sceneSetEnvironment(scene, texture)

        @JavascriptInterface
        fun shaderMaterialCreate(vertex: String, fragment: String): Int =
            NativeRuntime.shaderMaterialCreate(vertex, fragment)

        @JavascriptInterface
        fun shaderSetFlags(material: Int, side: Int, depthWrite: Int) =
            NativeRuntime.shaderSetFlags(material, side, depthWrite)

        @JavascriptInterface
        fun shaderUniformFloat(material: Int, name: String, value: Float) =
            NativeRuntime.shaderUniformFloat(material, name, value)

        @JavascriptInterface
        fun shaderUniformVec2(material: Int, name: String, x: Float, y: Float) =
            NativeRuntime.shaderUniformVec2(material, name, x, y)

        @JavascriptInterface
        fun shaderUniformVec3(material: Int, name: String, x: Float, y: Float, z: Float) =
            NativeRuntime.shaderUniformVec3(material, name, x, y, z)

        @JavascriptInterface
        fun shaderUniformVec4(material: Int, name: String, x: Float, y: Float, z: Float, w: Float) =
            NativeRuntime.shaderUniformVec4(material, name, x, y, z, w)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

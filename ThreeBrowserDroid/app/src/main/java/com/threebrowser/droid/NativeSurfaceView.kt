package com.threebrowser.droid

import android.content.Context
import android.os.Build
import android.util.AttributeSet
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView

class NativeSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : SurfaceView(context, attrs), SurfaceHolder.Callback {

    var desiredFrameRate = 60f

    init {
        holder.addCallback(this)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            holder.surface.setFrameRate(
                desiredFrameRate,
                Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE
            )
        }
        NativeRuntime.attachSurface(holder.surface)
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        NativeRuntime.resize(width, height)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        NativeRuntime.detachSurface()
    }
}

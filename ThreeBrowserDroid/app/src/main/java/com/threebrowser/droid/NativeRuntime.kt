package com.threebrowser.droid

import android.view.Surface

object NativeRuntime {
    init {
        System.loadLibrary("threebrowser_droid")
    }

    external fun attachSurface(surface: Surface)
    external fun detachSurface()
    external fun resize(width: Int, height: Int)
    external fun pause()
    external fun resume()
    external fun shutdown()
    external fun reset()
    external fun backendName(): String
    external fun submitCommands(bytes: ByteArray): Int
    external fun submitCommandsAsync(bytes: ByteArray): Int
    external fun createBone(): Int
    external fun createSkeleton(bones: IntArray): Int
    external fun setSkeletonInverses(skeleton: Int, bytes: ByteArray): Int
    external fun pmremFromObject(id: Int, objectId: Int): Int
    external fun sceneSetEnvironment(scene: Int, texture: Int)
    external fun shaderMaterialCreate(vertexSource: String, fragmentSource: String): Int
    external fun shaderSetFlags(material: Int, side: Int, depthWrite: Int)
    external fun shaderUniformFloat(material: Int, name: String, value: Float)
    external fun shaderUniformVec2(material: Int, name: String, x: Float, y: Float)
    external fun shaderUniformVec3(material: Int, name: String, x: Float, y: Float, z: Float)
    external fun shaderUniformVec4(material: Int, name: String, x: Float, y: Float, z: Float, w: Float)
}

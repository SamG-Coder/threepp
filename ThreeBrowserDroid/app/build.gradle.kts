plugins {
    id("com.android.application")
}

android {
    namespace = "com.threebrowser.droid"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.threebrowser.droid"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        externalNativeBuild {
            cmake {
                cppFlags += listOf("-std=c++20", "-Wall", "-Wextra")
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildFeatures {
        viewBinding = false
        buildConfig = true
    }

    sourceSets["main"].assets.srcDirs(
        "src/main/assets",
        "../../host/ThreeBrowser/web"
    )

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.0")
}

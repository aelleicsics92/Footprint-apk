plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val fpVersion = (project.findProperty("fpVersionCode") ?: "1").toString().toInt()
val ksPath: String? = System.getenv("FP_KEYSTORE")?.takeIf { it.isNotEmpty() }

android {
    // Stesso applicationId e stessa firma dell'app del telefono: serve per il Data Layer
    namespace = "it.footprint.trail.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "it.footprint.trail"
        minSdk = 30
        targetSdk = 34
        versionCode = fpVersion
        versionName = "1.0.$fpVersion"
    }

    signingConfigs {
        create("fp") {
            if (ksPath != null) {
                storeFile = file(ksPath)
                storePassword = System.getenv("FP_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FP_KEY_ALIAS")
                keyPassword = System.getenv("FP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ksPath != null) signingConfigs.getByName("fp") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.wear:wear:1.3.0")
    implementation("androidx.wear:wear-ongoing:1.0.0")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "it.surfer.live"
    compileSdk = 34
    defaultConfig {
        applicationId = "it.surfer.live"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    // Scanner QR di Google (Play Services): nessun permesso fotocamera, nessun codice nostro da mantenere.
    // Se il telefono non ha i Play Services, resta il campo per incollare il link.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}

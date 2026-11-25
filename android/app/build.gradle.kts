import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firma di rilascio: i dati stanno in android/keystore.properties (MAI nel repository, vedi .gitignore).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
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
    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) create("release") {
            storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias")
            keyPassword = keystoreProps.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    // Scanner QR di Google (Play Services): nessun permesso fotocamera, nessun codice nostro da mantenere.
    // Se il telefono non ha i Play Services, resta il campo per incollare il link.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}

# NHAI Biometrics — Offline Face Recognition & Liveness Verification App

A high-performance, 100% offline, edge-AI biometric prototype built using **React Native**, **Expo**, **Google MLKit**, and **TensorFlow Lite (MobileFaceNet)**. Designed to operate completely offline, making it highly secure and reliable for integrations like attendance logging and CCTV feeds.

---

## 🚀 Key Features

* **Multi-Face Real-Time Detection & Identification**:
  * Continuous scanner (Live Scan mode) that detects up to 4 faces simultaneously.
  * Real-time projection of screen bounding boxes precisely over faces.
  * Instant visual matching: Green frames (`#10b981`) with user IDs for registered employees and Red frames (`#ef4444`) for unregistered faces.
* **Sequential Liveness Challenges**:
  * Anti-spoofing mechanism to prevent picture/video projection attacks.
  * Supported challenges: **Blink**, **Smile**, **Turn Head Left**, **Turn Head Right**, **Look Up**, and **Look Down**.
  * Customizable English and Hindi voice-equivalent visual prompts.
* **100% Offline Edge AI Engine**:
  * Runs face embedding extraction using a quantized **MobileFaceNet** model (`mobilefacenet.tflite`).
  * Utilizes Google MLKit via Vision Camera for ultra-fast facial attribute classification.
* **Retrieval-Augmented Generation (RAG) Matching**:
  * Context-aware matching utilizing local `VectorStore` (approximate nearest-neighbor).
  * Temporal consensus smoothing (filtering facial flickering) and margin filtering (ensuring unique identity matches).
  * High matching threshold (`0.93` fusion score) to eliminate false positives and identity mix-ups.
* **Secure Offline Database**:
  * Utilizes synchronous, encrypted `react-native-mmkv` for storage.
  * Admin dashboard to audit attendance logs and manage/delete registered face templates.
* **Lag-Free Performance**:
  * Camera hardware turns off completely when displaying Success/Failure screens to preserve battery and drop CPU overhead to 0%.

---

## 🛠️ Tech Stack

* **Framework**: React Native (Expo SDK 56)
* **Camera & Processing**: React Native Vision Camera (v4) & Reanimated Worklets (JSI)
* **Face Detection**: Google MLKit (via Vision Camera Face Detector)
* **AI Inference**: React Native Fast TFLite (CPU Delegate)
* **Storage**: React Native MMKV (Encrypted, Synchronous key-value database)

---

## ⚙️ Prerequisites

Before running the application, make sure you have:
1. **Node.js** (v18 or newer recommended).
2. **Java Development Kit (JDK) 17** (Compilation will fail with older or newer versions).
3. **Android SDK & Platform Tools** configured in path (`adb` command must be working).
4. A **Physical Android Device** connected via USB with **USB Debugging** enabled.

---

## 🏃‍♂️ Getting Started

### 1. Install Dependencies
Navigate to the project folder and install Node packages:
```bash
npm install
```

### 2. Configure Environment Variables (Crucial for Windows)
Ensure your `JAVA_HOME` environment variable points to **JDK 17** (e.g. Eclipse Adoptium OpenJDK 17).
In PowerShell, you can set it for the active session:
```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
```

### 3. Build & Install on Connected Device
With your Android phone plugged in, run the following command to compile the native Android bundle, install the APK, and launch the app:
```powershell
# Set JAVA_HOME and compile debug build
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"; npm run android
```

### 4. Run the Persistent ADB Tunnel (Optional)
To ensure the Metro bundler server (`localhost:8081`) remains securely connected to your phone even if you unplug/replug the USB cable:
```bash
node adb-tunnel.js
```

---

## 📂 Project Structure

```text
BiometricReactNative/
├── assets/                  # Quantized MobileFaceNet TFLite model & UI assets
├── src/
│   ├── screens/
│   │   ├── HomeScreen.tsx        # App entry dashboard
│   │   ├── EnrollScreen.tsx      # Multi-angle enrollment flow
│   │   ├── AuthScreen.tsx        # Verification with active liveness prompts
│   │   ├── LiveScanScreen.tsx    # Continuous multi-face CCTV scanning mode
│   │   └── DashboardScreen.tsx   # Admin panel for audit logs & face template deletion
│   ├── ModelLoader.ts            # TFLite model loader
│   ├── StorageEngine.ts          # MMKV storage interface
│   ├── VectorStore.ts            # In-memory vector store & search
│   ├── RAGPipeline.ts            # Match engine & consensus manager
│   ├── NativeFaceRecognition.ts  # L2 normalization & cosine similarity metrics
│   ├── LivenessEngine.ts         # MLKit facial attribute threshold checkers
│   └── QualityGate.ts            # Pose and size quality checkers
├── adb-tunnel.js            # Persistent adb reverse TCP tunnel utility
├── package.json
└── tsconfig.json
```

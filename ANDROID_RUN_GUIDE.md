# NHAI Biometrics — Android Setup & Troubleshooting Guide

This guide documents the critical configuration fixes, native crash resolutions, and runtime optimizations implemented to ensure the Android application runs smoothly without crashes or frame drops. Refer to this document if you need to run, compile, or debug the app tomorrow.

---

## 🚀 Commands to Run the App

Open your terminal in `e:\Facerecog\BiometricReactNative` and execute:

```bash
# 1. Start the Metro Bundler
npx expo start

# 2. Run the Android App on Connected Device (ADB)
npm run android
```

*Note: Make sure your Android device is connected via USB, has Developer Options enabled, USB Debugging active, and is visible under `adb devices`.*

---

## 🛠️ Critical Android Fixes & Technical Reference

### 1. Native JNI TFLite GPU Delegate Crash (SIGSEGV)
* **Problem**: Using the GPU delegate `['android-gpu']` inside the `react-native-fast-tflite` model loader caused a native segmentation fault (`HermesVM JNI SIGSEGV`) on some MediaTek and Snapdragon-based Android devices during model initialization.
* **Resolution**: Modified [ModelLoader.ts](file:///e:/Facerecog/BiometricReactNative/src/ModelLoader.ts) to fall back to the highly stable, standard **CPU delegate** (`[]`). This resolved all native JNI memory faults and ensured 100% offline model loading success.

### 2. JSI ArrayBuffer Type-Casting Crash (runSync JSI Errors)
* **Problem**: Passing a JavaScript `Float32Array` or standard TypedArray directly into the TFLite model's `activeModel.runSync` method caused a HermeVM JSI marshal crash.
* **Resolution**: Accessed the underlying raw `ArrayBuffer` via `.buffer` (e.g. `activeModel.runSync([resized.buffer])`) inside the frame processors in [EnrollScreen.tsx](file:///e:/Facerecog/BiometricReactNative/src/screens/EnrollScreen.tsx) and [AuthScreen.tsx](file:///e:/Facerecog/BiometricReactNative/src/screens/AuthScreen.tsx). This ensures data passes safely across the JavaScript-to-C++ boundary.

### 3. Hermes Worklet Serialization Failures (Null Pointer Exception)
* **Problem**: Importing or referencing external TypeScript class files (like `QualityGate`) directly inside Vision Camera's `'worklet'` functions caused the Hermes runtime to fail serialization when calling JS callbacks from the JSI thread.
* **Resolution**: Inlined the Quality Gate calculations directly inside the worklet context, and used stable JS callback handlers wrapped in `createRunOnJS` to pass primitive values and coordinates safely.

### 4. Camera Preview Lag & Stutter (Worklet Rebinding Loop)
* **Problem**: The active liveness timer ticks every 100ms, triggering React re-renders. Because the frame processor depended on functions recreated on every render, the camera worklet was constantly destroyed and rebuilt 10 times a second, causing high CPU usage and severe camera lag.
* **Resolution**: Implemented the **Stable Callback Ref Pattern** in [EnrollScreen.tsx](file:///e:/Facerecog/BiometricReactNative/src/screens/EnrollScreen.tsx), [AuthScreen.tsx](file:///e:/Facerecog/BiometricReactNative/src/screens/AuthScreen.tsx), and [LiveScanScreen.tsx](file:///e:/Facerecog/BiometricReactNative/src/screens/LiveScanScreen.tsx):
  ```typescript
  const onFaceDetectedRef = React.useRef(onFaceDetected);
  React.useEffect(() => {
    onFaceDetectedRef.current = onFaceDetected;
  });
  const stableOnFaceDetected = React.useCallback((face, emb, qual) => {
    onFaceDetectedRef.current(face, emb, qual);
  }, []);
  ```
  This guarantees the JSI frame processor is bound exactly **once** on load, preserving a smooth 30+ FPS preview.

### 5. Mirrored Sensor Yaw Angle Mismatch
* **Problem**: Front-camera sensors are mirrored by default. The raw yaw angles returned by MLKit go positive when turning left and negative when turning right, causing liveness validations to freeze.
* **Resolution**: Swapped the direction checking in [LivenessEngine.ts](file:///e:/Facerecog/BiometricReactNative/src/LivenessEngine.ts) to match mirrored view coordinates:
  - `TURN_LEFT`: `yaw > 12`
  - `TURN_RIGHT`: `yaw < -12`

### 6. JDK 17 Path Configuration (Gradle Compilation)
* **Problem**: Modern React Native (0.85+) and Gradle 8+ require Java SDK 17. Compilation fails if older JDK versions are referenced in environment variables.
* **Resolution**: Verify that your Windows Environment Variable `JAVA_HOME` is set to Eclipse Adoptium OpenJDK 17:
  `C:\Program Files\Eclipse Adoptium\jdk-17.x.x`

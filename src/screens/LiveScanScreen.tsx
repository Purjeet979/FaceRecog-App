import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Dimensions } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets } from 'react-native-worklets-core';
import { NitroModules } from 'react-native-nitro-modules';
import { useIsFocused } from '@react-navigation/native';

import { getOrLoadModel, getLoadedModel } from '../ModelLoader';
import { RAGPipeline, MatchResult } from '../RAGPipeline';
import { QualityReport } from '../QualityGate';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MappedBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type JSIFaceData = {
  bounds: FaceBox;
  embedding: number[];
  quality: {
    blurScore: number;
    lightingScore: number;
    angleScore: number;
    sizeScore: number;
    overallScore: number;
    isAcceptable: boolean;
  };
};

type DetectedFaceResult = {
  box: MappedBox;
  match: MatchResult;
};

export default function LiveScanScreen({ navigation }: any) {
  try {
    const [scanStatus, setScanStatus] = useState<'idle' | 'scanning'>('idle');
    const [hasPermission, setHasPermission] = useState(false);
    const [isHindi, setIsHindi] = useState(false);

    // Live UI State for multiple detected faces
    const [detectedFaces, setDetectedFaces] = useState<DetectedFaceResult[]>([]);
    const [recentMatches, setRecentMatches] = useState<{id: string, time: number}[]>([]);
    const [statusText, setStatusText] = useState('Position faces in front of the camera');

    const device = useCameraDevice ? useCameraDevice('front') : null;
    const isFocused = useIsFocused();

    const [modelLoaded, setModelLoaded] = useState(!!getLoadedModel());

    useEffect(() => {
      if (!isFocused) {
        setScanStatus('idle');
        setDetectedFaces([]);
      }
    }, [isFocused]);

    useEffect(() => {
      if (!modelLoaded) {
        getOrLoadModel()
          .then(() => setModelLoaded(true))
          .catch((e) => console.error('[LiveScanScreen] Model loading error:', e));
      }
    }, [modelLoaded]);

    const model = getLoadedModel();
    const boxedModel = React.useMemo(() => {
      return model ? NitroModules.box(model) : null;
    }, [model]);

    const faceDetectionOptions = React.useRef({
      performanceMode: 'fast' as const,
      classificationMode: 'all' as const,
      landmarkMode: 'none' as const,
      minFaceSize: 0.1,
      trackingEnabled: true,
      cameraFacing: 'front' as const,
    }).current;

    const faceDetectorInstance = useFaceDetector ? useFaceDetector(faceDetectionOptions) : null;
    const resizePluginInstance = useResizePlugin ? useResizePlugin() : null;

    useEffect(() => {
      if (isFocused) {
        (async () => {
          if (Camera) {
            const status = await Camera.getCameraPermissionStatus();
            setHasPermission(status === 'granted');
          }
        })();
      }
    }, [isFocused]);

    const startScan = async () => {
      if (!Camera) return;

      let status = await Camera.getCameraPermissionStatus();
      if (status !== 'granted') status = await Camera.requestCameraPermission();

      if (status !== 'granted') {
        return;
      }

      setHasPermission(true);
      setScanStatus('scanning');
      setRecentMatches([]);
      setStatusText(isHindi ? 'स्कैनिंग चालू है...' : 'Continuous Scanning Active...');
    };

    const processMultipleMatchesJS = async (payloads: JSIFaceData[], frameWidth: number, frameHeight: number) => {
      if (payloads.length === 0) {
        setDetectedFaces([]);
        setStatusText(isHindi ? 'कृपया कैमरे की ओर देखें' : 'Continuous Scanning Active...');
        return;
      }

      const sensorWidth = frameWidth;
      const sensorHeight = frameHeight;

      const scale = screenHeight / sensorWidth;
      const previewWidth = sensorHeight * scale;
      const cropOffset = (previewWidth - screenWidth) / 2;

      const results = await Promise.all(
        payloads.map(async (p) => {
          const normX = p.bounds.x / sensorWidth;
          const normY = p.bounds.y / sensorHeight;
          const normW = p.bounds.width / sensorWidth;
          const normH = p.bounds.height / sensorHeight;

          const mappedTop = normX * screenHeight;
          const mappedHeight = normW * screenHeight;

          const mappedLeft = (1.0 - normY - normH) * previewWidth - cropOffset;
          const mappedWidth = normH * previewWidth;

          const mappedBox = {
            left: mappedLeft,
            top: mappedTop,
            width: mappedWidth,
            height: mappedHeight
          };

          // Run RAG match using the current embedding
          // We pass [p.embedding] directly as the history slice to avoid crosstalk between different faces
          const result = await RAGPipeline.matchFace(p.embedding, p.quality, [p.embedding]);

          return {
            box: mappedBox,
            match: result
          };
        })
      );

      setDetectedFaces(results);

      // Extract unique matched user IDs
      const matchedUsers = results.filter(r => r.match.matched && r.match.userId).map(r => r.match.userId as string);
      const uniqueMatchedUsers = Array.from(new Set(matchedUsers));
      if (uniqueMatchedUsers.length > 0) {
        setRecentMatches(prev => {
          let updated = [...prev];
          for (const uid of uniqueMatchedUsers) {
            updated = updated.filter(p => p.id !== uid);
            updated.unshift({ id: uid, time: Date.now() });
          }
          return updated.slice(0, 5);
        });
        setStatusText(isHindi ? `पहचाने गए: ${uniqueMatchedUsers.join(', ')}` : `Identified: ${uniqueMatchedUsers.join(', ')}`);
      } else {
        setStatusText(isHindi ? 'स्कैनिंग चालू है...' : 'Continuous Scanning Active...');
      }
    };

    const onFaceDetected = (facePayloads: any, frameH?: number, frameW?: number) => {
      if (!facePayloads || !Array.isArray(facePayloads) || !frameH || !frameW) {
        setDetectedFaces([]);
        setStatusText(isHindi ? 'कृपया कैमरे की ओर देखें' : 'Looking for faces...');
        return;
      }
      
      processMultipleMatchesJS(facePayloads, frameW, frameH);
    };

    const onFaceDetectedRef = React.useRef(onFaceDetected);
    React.useEffect(() => {
      onFaceDetectedRef.current = onFaceDetected;
    });

    const stableOnFaceDetected = React.useCallback((facePayloads: any, frameH?: number, frameW?: number) => {
      onFaceDetectedRef.current(facePayloads, frameH, frameW);
    }, []);

    const handleFrameData = React.useMemo(() => {
      return Worklets && Worklets.createRunOnJS
        ? Worklets.createRunOnJS(stableOnFaceDetected)
        : stableOnFaceDetected;
    }, [stableOnFaceDetected]);

    const frameProcessor = useFrameProcessor((frame: any) => {
      'worklet';
      if (!boxedModel || !faceDetectorInstance || !resizePluginInstance) return;

      try {
        const activeModel = boxedModel.unbox();
        if (!activeModel) return;

        const faces = faceDetectorInstance.detectFaces(frame);
        const facePayloads: JSIFaceData[] = [];

        if (faces && faces.length > 0) {
          // Limit to max 4 concurrent faces for CPU/memory efficiency
          const facesToProcess = faces.slice(0, 4);

          for (let i = 0; i < facesToProcess.length; i++) {
            const face = facesToProcess[i];
            const yaw = face.yawAngle ?? 0;
            const pitch = face.pitchAngle ?? 0;
            const maxAllowedAngle = 30;
            const yawPenalty = Math.min(Math.abs(yaw) / maxAllowedAngle, 1);
            const pitchPenalty = Math.min(Math.abs(pitch) / maxAllowedAngle, 1);
            const angleScore = 1.0 - Math.max(yawPenalty, pitchPenalty);

            const faceArea = face.bounds.width * face.bounds.height;
            const frameArea = frame.width * frame.height;
            const sizeRatio = faceArea / frameArea;
            
            let sizeScore = 0;
            if (sizeRatio > 0.06 && sizeRatio < 0.40) {
              sizeScore = 1.0;
            } else if (sizeRatio <= 0.06) {
              sizeScore = Math.max(0, sizeRatio / 0.06);
            } else {
              sizeScore = Math.max(0, 1 - ((sizeRatio - 0.40) * 2));
            }

            const blurScore = sizeScore > 0.5 ? 0.9 : 0.6; 
            const lightingScore = 0.8;

            const overallScore = (
              (angleScore * 0.4) + 
              (sizeScore * 0.3) + 
              (blurScore * 0.2) + 
              (lightingScore * 0.1)
            );

            const isAcceptable = overallScore > 0.70 && angleScore > 0.6 && sizeScore > 0.5;
            const quality = {
              blurScore,
              lightingScore,
              angleScore,
              sizeScore,
              overallScore,
              isAcceptable
            };

            const faceBounds = face.bounds;
            const cropX = Math.max(0, Math.min(faceBounds.x || 0, frame.width - 1));
            const cropY = Math.max(0, Math.min(faceBounds.y || 0, frame.height - 1));
            const cropW = Math.max(1, Math.min(faceBounds.width || 1, frame.width - cropX));
            const cropH = Math.max(1, Math.min(faceBounds.height || 1, frame.height - cropY));

            const resized = resizePluginInstance.resize(frame, {
              scale: { width: 112, height: 112 },
              crop: { x: cropX, y: cropY, width: cropW, height: cropH },
              pixelFormat: 'rgb',
              dataType: 'float32',
            });

            for (let j = 0; j < resized.length; j++) resized[j] = (resized[j] * 2.0) - 1.0;

            if (isAcceptable) {
              const outputs = activeModel.runSync([resized.buffer]);
              if (outputs && outputs[0]) {
                const embedding = Array.from(new Float32Array(outputs[0] as ArrayBuffer));
                facePayloads.push({
                  bounds: faceBounds,
                  embedding,
                  quality
                });
              }
            }
          }
        }
        
        // Swap width and height for coordinate scaling because portrait frames are rotated
        handleFrameData(facePayloads, frame.height, frame.width);
      } catch (e) {
      }
    }, [boxedModel, faceDetectorInstance, resizePluginInstance, handleFrameData]);

    const renderOverlay = () => {
      if (detectedFaces.length === 0) return null;

      return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {detectedFaces.map((item, idx) => {
            const isMatched = item.match.matched;
            const confidencePercent = Math.round(item.match.confidence * 100);
            const boxColor = isMatched ? '#10b981' : '#ef4444';
            const labelText = isMatched ? `${item.match.userId} ${confidencePercent}%` : (isHindi ? 'अज्ञात चेहरा' : 'UNKNOWN');

            return (
              <View 
                key={idx}
                style={[
                  styles.dynamicBox, 
                  { 
                    borderColor: boxColor,
                    left: item.box.left,
                    top: item.box.top,
                    width: item.box.width,
                    height: item.box.height,
                    position: 'absolute'
                  }
                ]}
              >
                <View style={[styles.nameLabel, { backgroundColor: boxColor }]}>
                  <Text style={styles.nameText}>{labelText}</Text>
                </View>
                {isMatched && (
                  <View style={styles.confidenceBarContainer}>
                    <View style={[styles.confidenceBar, { width: `${confidencePercent}%`, backgroundColor: confidencePercent > 90 ? '#10b981' : '#f59e0b' }]} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      );
    };

    if (scanStatus === 'scanning' && isFocused && hasPermission && device && Camera) {
      return (
        <View style={styles.container}>
          <View style={styles.cameraContainer}>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={isFocused}
              pixelFormat="yuv"
              orientation="portrait"
              frameProcessor={frameProcessor}
              onError={(e) => console.log('Camera Error:', e)}
            />
            
            {renderOverlay()}

            <View style={styles.topBar}>
              <Text style={styles.topBarText}>{statusText}</Text>
              <View style={styles.langToggle}>
                <Text style={styles.langText}>EN</Text>
                <Switch value={isHindi} onValueChange={setIsHindi} trackColor={{ false: '#334155', true: '#38bdf8' }} thumbColor="white" />
                <Text style={styles.langText}>HI</Text>
              </View>
            </View>

            {recentMatches.length > 0 && (
              <View style={styles.recentList}>
                <Text style={styles.recentTitle}>{isHindi ? 'हाल ही में पहचाने गए' : 'Recently Recognized'}</Text>
                {recentMatches.map(r => (
                  <Text key={r.id} style={styles.recentItem}>
                    ✓ {r.id} ({Math.round((Date.now() - r.time)/1000)}s ago)
                  </Text>
                ))}
              </View>
            )}

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setScanStatus('idle')}>
                <Text style={styles.cancelTxt}>{isHindi ? 'रोकें' : 'Stop Scan'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <View style={styles.langToggleOuter}>
          <Text style={styles.langTextOuter}>EN</Text>
          <Switch value={isHindi} onValueChange={setIsHindi} trackColor={{ false: '#334155', true: '#38bdf8' }} thumbColor="white" />
          <Text style={styles.langTextOuter}>HI</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.header}>{isHindi ? 'लाइव स्कैन' : 'Live Scan Mode'}</Text>
          <Text style={styles.desc}>
            {isHindi ? 'बिना किसी रुकावट के वास्तविक समय में चेहरे का पता लगाएं और पहचानें।' : 'Continuous real-time face scanning and instant identification.'}
          </Text>

          <TouchableOpacity style={styles.btn} onPress={startScan}>
            <Text style={styles.btnText}>{isHindi ? 'स्कैनर शुरू करें' : 'Start Live Scan'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  } catch (err: any) {
    return (
      <View style={{ flex: 1, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Error in LiveScanScreen:</Text>
        <Text style={{ color: 'white', fontSize: 14, textAlign: 'center', marginBottom: 10 }}>{err.message}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center' },
  cameraContainer: { flex: 1, borderRadius: 12, overflow: 'hidden', margin: 10 },
  card: { backgroundColor: '#1e293b', padding: 20, margin: 20, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  header: { fontSize: 24, color: 'white', fontWeight: 'bold', marginBottom: 10 },
  desc: { color: '#94a3b8', marginBottom: 20, lineHeight: 20 },
  btn: { backgroundColor: '#38bdf8', padding: 15, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#0f172a', fontWeight: 'bold', fontSize: 16 },
  
  langToggleOuter: { position: 'absolute', top: 50, right: 20, flexDirection: 'row', alignItems: 'center' },
  langTextOuter: { color: 'white', marginHorizontal: 5, fontWeight: 'bold' },

  topBar: { position: 'absolute', top: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.85)', padding: 12, borderRadius: 8 },
  topBarText: { color: '#38bdf8', fontWeight: 'bold', fontSize: 16, flex: 1, marginRight: 10 },
  langToggle: { flexDirection: 'row', alignItems: 'center' },
  langText: { color: 'white', fontSize: 12, marginHorizontal: 4 },

  dynamicBox: { position: 'absolute', borderWidth: 3, borderRadius: 8, justifyContent: 'space-between' },
  nameLabel: { position: 'absolute', top: -35, alignSelf: 'center', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 20 },
  nameText: { color: 'white', fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
  confidenceBarContainer: { position: 'absolute', bottom: -15, width: '100%', height: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden' },
  confidenceBar: { height: '100%' },

  recentList: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: 'rgba(15, 23, 42, 0.7)', padding: 15, borderRadius: 12 },
  recentTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 5 },
  recentItem: { color: 'white', fontSize: 14, marginBottom: 3, fontWeight: 'bold' },

  buttonRow: { position: 'absolute', bottom: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'center' },
  cancelBtn: { flex: 1, backgroundColor: '#ef4444', padding: 15, borderRadius: 8, alignItems: 'center' },
  cancelTxt: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});

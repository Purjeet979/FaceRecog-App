import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets } from 'react-native-worklets-core';
import { NitroModules } from 'react-native-nitro-modules';
import { useIsFocused } from '@react-navigation/native';
import { getOrLoadModel, getLoadedModel } from '../ModelLoader';

import { CryptoLayer } from '../CryptoLayer';
import { StorageEngine } from '../StorageEngine';
import { LivenessEngine, LivenessChallenge } from '../LivenessEngine';
import { QualityGate, QualityReport } from '../QualityGate';
import { NativeFaceRecognition } from '../NativeFaceRecognition';

function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const len = embeddings[0].length;
  const avg = new Array(len).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < len; i++) {
      avg[i] += emb[i];
    }
  }
  for (let i = 0; i < len; i++) {
    avg[i] /= embeddings.length;
  }
  return avg;
}

export default function EnrollScreen({ navigation }: any) {
  try {
    const [empId, setEmpId] = useState('');
    const [isEnrolling, setIsEnrolling] = useState(false);
    const [hasPermission, setHasPermission] = useState(false);
    const [isFaceDetected, setIsFaceDetected] = useState(false);
    const [isFaceAcceptable, setIsFaceAcceptable] = useState(false);

    // Liveness and Capture state
    const [livenessStatus, setLivenessStatus] = useState<'idle' | 'processing' | 'completed' | 'success' | 'failed'>('idle');
    const [challenges, setChallenges] = useState<LivenessChallenge[]>([]);
    const [currentChallengeIdx, setCurrentChallengeIdx] = useState(0);
    const [challengeStatuses, setChallengeStatuses] = useState<('pending' | 'passed' | 'failed')[]>([]);
    const [feedback, setFeedback] = useState('Position your face in front of the camera');
    
    // Multi-angle embeddings
    const [frontEmbeddings, setFrontEmbeddings] = useState<number[][]>([]);
    const [leftEmbeddings, setLeftEmbeddings] = useState<number[][]>([]);
    const [rightEmbeddings, setRightEmbeddings] = useState<number[][]>([]);
    const [qualityScores, setQualityScores] = useState<number[]>([]);

    const device = useCameraDevice ? useCameraDevice('front') : null;
    const isFocused = useIsFocused();

    const [modelLoaded, setModelLoaded] = useState(!!getLoadedModel());
    const latestEmbeddingRef = React.useRef<number[] | null>(null);

    useEffect(() => {
      if (!isFocused) {
        setIsEnrolling(false);
        setIsFaceDetected(false);
        setIsFaceAcceptable(false);
      }
    }, [isFocused]);

    useEffect(() => {
      if (!modelLoaded) {
        getOrLoadModel()
          .then(() => setModelLoaded(true))
          .catch((e) => console.error('[EnrollScreen] Model loading error:', e));
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

    useEffect(() => {
      return () => {
        if (faceDetectorInstance && faceDetectorInstance.stopListeners) {
          faceDetectorInstance.stopListeners();
        }
      };
    }, [faceDetectorInstance]);

    const startEnrollment = async () => {
      const trimmedId = empId.trim();
      if (!trimmedId) {
        Alert.alert('Error', 'Please enter an Employee ID');
        return;
      }
      if (trimmedId.length < 4) {
        Alert.alert('Error', 'Employee ID must be at least 4 characters long');
        return;
      }
      const existingUser = StorageEngine.loadTemplate(trimmedId);
      if (existingUser) {
        Alert.alert('Error', 'Employee ID already enrolled. Please use a unique ID.');
        return;
      }
      if (!Camera) return;

      let status = await Camera.getCameraPermissionStatus();
      if (status !== 'granted') status = await Camera.requestCameraPermission();

      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera permission is required.');
        return;
      }

      setHasPermission(true);

      const session = LivenessEngine.generateEnrollSession();
      setChallenges(session);
      setCurrentChallengeIdx(0);
      setChallengeStatuses(session.map(() => 'pending'));
      
      setFrontEmbeddings([]);
      setLeftEmbeddings([]);
      setRightEmbeddings([]);
      setQualityScores([]);
      
      setIsFaceDetected(false);
      setIsFaceAcceptable(false);
      setLivenessStatus('processing');
      setFeedback('Looking straight ahead to begin capture...');
      setIsEnrolling(true);
    };

    const saveEnrolledFace = async (fEmbs: number[][], lEmbs: number[][], rEmbs: number[][], qScores: number[]) => {
      try {
        setLivenessStatus('completed');
        setFeedback('Averaging face templates...');
        
        // Average and L2-normalize each angle
        const frontAvg = NativeFaceRecognition.l2Normalize(averageEmbeddings(fEmbs));
        const leftAvg = NativeFaceRecognition.l2Normalize(averageEmbeddings(lEmbs));
        const rightAvg = NativeFaceRecognition.l2Normalize(averageEmbeddings(rEmbs));
        
        // Master embedding is the Front average
        const masterEmbedding = frontAvg;
        
        const avgQuality = qScores.reduce((a, b) => a + b, 0) / qScores.length;
        
        StorageEngine.saveTemplate(empId, masterEmbedding, {
          angle_embeddings: { front: frontAvg, left: leftAvg, right: rightAvg },
          quality_score: avgQuality,
          enrollment_frame_count: fEmbs.length + lEmbs.length + rEmbs.length,
          deviceId: CryptoLayer.getDeviceId()
        });
        
        StorageEngine.saveRecord({
          userId: empId,
          timestamp: Date.now(),
          confidence: 1.0,
          livenessPassed: true,
        });

        setLivenessStatus('success');
        setFeedback('Face enrolled successfully!');
        
        Alert.alert('Success', `Face enrolled successfully for employee ID: ${empId}`, [
          { text: 'OK', onPress: () => {
            setIsEnrolling(false);
            setLivenessStatus('idle');
            navigation.navigate('Home');
          }}
        ]);
      } catch (err: any) {
        setLivenessStatus('failed');
        setFeedback(`Enrollment failed: ${err.message}`);
        Alert.alert('Error', `Enrollment failed: ${err.message}`);
      }
    };

    const onFaceDetected = (face: any, embedding?: number[], quality?: QualityReport, debugInfo?: string) => {
      if (embedding) {
        latestEmbeddingRef.current = embedding;
      } else {
        latestEmbeddingRef.current = null;
      }
      
      if (!face || !quality) {
        latestEmbeddingRef.current = null;
        setIsFaceDetected(false);
        setIsFaceAcceptable(false);
        setFeedback(`Keep face inside target circle${debugInfo ? ` (${debugInfo})` : ''}`);
        return;
      }
      setIsFaceDetected(true);

      const challenge = challenges[currentChallengeIdx];
      if (!challenge) {
        setIsFaceAcceptable(false);
        return;
      }

      // Verify quality based on challenge type
      let isAngleAcceptable = true;
      if (challenge.type === 'LOOK_FRONT' || challenge.type === 'SMILE' || challenge.type === 'BLINK') {
        isAngleAcceptable = quality.angleScore > 0.5; // requires frontal face
      } else if (challenge.type === 'TURN_LEFT' || challenge.type === 'TURN_RIGHT') {
        // yaw is allowed to be turned, but pitch should be relatively straight
        const pitch = Math.abs(face.pitchAngle ?? 0);
        isAngleAcceptable = pitch < 20; 
      } else if (challenge.type === 'LOOK_UP' || challenge.type === 'LOOK_DOWN') {
        // pitch is allowed to be tilted, but yaw should be relatively straight
        const yaw = Math.abs(face.yawAngle ?? 0);
        isAngleAcceptable = yaw < 20;
      }

      const isFaceGood = quality.sizeScore > 0.3 && isAngleAcceptable;
      setIsFaceAcceptable(isFaceGood);

      if (!isFaceGood) {
        if (quality.sizeScore < 0.3) {
          setFeedback(`Move closer to the camera (${debugInfo})`);
        } else {
          setFeedback(`Look straight at the camera (${debugInfo})`);
        }
        return;
      }

      if (livenessStatus === 'processing') {
        const isPassed = LivenessEngine.validateFrame(challenge.type, {
          leftEyeOpenProbability: face.leftEyeOpenProbability,
          rightEyeOpenProbability: face.rightEyeOpenProbability,
          smilingProbability: face.smilingProbability,
          headEulerAngleY: face.yawAngle,
          headEulerAngleX: face.pitchAngle,
        });

        if (isPassed && embedding) {
          // We capture 5 embeddings per challenge
          let isComplete = false;
          let fCount = frontEmbeddings.length;
          let lCount = leftEmbeddings.length;
          let rCount = rightEmbeddings.length;

          if (challenge.type === 'LOOK_FRONT' && fCount < 5) {
            setFrontEmbeddings(prev => [...prev, embedding]);
            setQualityScores(prev => [...prev, quality.overallScore]);
            fCount++;
            setFeedback(`Capturing Front: ${fCount}/5 (${debugInfo})`);
            if (fCount >= 5) isComplete = true;
          } else if (challenge.type === 'TURN_LEFT' && lCount < 5) {
            setLeftEmbeddings(prev => [...prev, embedding]);
            setQualityScores(prev => [...prev, quality.overallScore]);
            lCount++;
            setFeedback(`Capturing Left: ${lCount}/5 (${debugInfo})`);
            if (lCount >= 5) isComplete = true;
          } else if (challenge.type === 'TURN_RIGHT' && rCount < 5) {
            setRightEmbeddings(prev => [...prev, embedding]);
            setQualityScores(prev => [...prev, quality.overallScore]);
            rCount++;
            setFeedback(`Capturing Right: ${rCount}/5 (${debugInfo})`);
            if (rCount >= 5) isComplete = true;
          }

          if (isComplete) {
            const nextStatuses = [...challengeStatuses];
            nextStatuses[currentChallengeIdx] = 'passed';
            setChallengeStatuses(nextStatuses);

            if (currentChallengeIdx < challenges.length - 1) {
              setCurrentChallengeIdx(prev => prev + 1);
            } else {
              saveEnrolledFace(
                challenge.type === 'LOOK_FRONT' ? [...frontEmbeddings, embedding] : frontEmbeddings,
                challenge.type === 'TURN_LEFT' ? [...leftEmbeddings, embedding] : leftEmbeddings,
                challenge.type === 'TURN_RIGHT' ? [...rightEmbeddings, embedding] : rightEmbeddings,
                [...qualityScores, quality.overallScore]
              );
            }
          }
        } else {
          setFeedback(`Challenge ${currentChallengeIdx + 1}/3: ${challenge.promptEn} (${debugInfo})`);
        }
      }
    };

    const onFaceDetectedRef = React.useRef(onFaceDetected);
    React.useEffect(() => {
      onFaceDetectedRef.current = onFaceDetected;
    });

    const stableOnFaceDetected = React.useCallback((face: any, embedding?: number[], quality?: QualityReport, debugInfo?: string) => {
      onFaceDetectedRef.current(face, embedding, quality, debugInfo);
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
        const debugInfo = faces && faces[0] ? `Yaw: ${Math.round(faces[0].yawAngle)}° | Pitch: ${Math.round(faces[0].pitchAngle)}°` : 'No Face';

        if (faces && faces.length >= 1) {
          console.log('[FrameProcessor] Face detected. Selecting largest...');
          let face = faces[0];
          for (let i = 1; i < faces.length; i++) {
            const areaCurrent = face.bounds.width * face.bounds.height;
            const areaNext = faces[i].bounds.width * faces[i].bounds.height;
            if (areaNext > areaCurrent) face = faces[i];
          }
          
          console.log('[FrameProcessor] Assessing quality gate inline...');
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
          if (sizeRatio > 0.05 && sizeRatio < 0.40) {
            sizeScore = 1.0;
          } else if (sizeRatio <= 0.05) {
            sizeScore = Math.max(0, sizeRatio / 0.05);
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

          const isAcceptable = overallScore > 0.65 && angleScore > 0.5 && sizeScore > 0.3;
          const quality = {
            blurScore,
            lightingScore,
            angleScore,
            sizeScore,
            overallScore,
            isAcceptable
          };

          console.log('[FrameProcessor] Computing crop bounds...');
          const faceBounds = face.bounds;
          const cropX = Math.max(0, Math.min(faceBounds.x || 0, frame.width - 1));
          const cropY = Math.max(0, Math.min(faceBounds.y || 0, frame.height - 1));
          const cropW = Math.max(1, Math.min(faceBounds.width || 1, frame.width - cropX));
          const cropH = Math.max(1, Math.min(faceBounds.height || 1, frame.height - cropY));

          console.log('[FrameProcessor] Cropping and resizing frame...');
          const resized = resizePluginInstance.resize(frame, {
            scale: { width: 112, height: 112 },
            crop: { x: cropX, y: cropY, width: cropW, height: cropH },
            pixelFormat: 'rgb',
            dataType: 'float32',
          });

          console.log('[FrameProcessor] Normalizing pixel buffer...');
          for (let i = 0; i < resized.length; i++) resized[i] = (resized[i] * 2.0) - 1.0;

          console.log('[FrameProcessor] Running TFLite model...');
          const outputs = activeModel.runSync([resized.buffer]);
          console.log('[FrameProcessor] Inference successful!');

          if (outputs && outputs[0]) {
            const emb = Array.from(new Float32Array(outputs[0] as ArrayBuffer));
            handleFrameData(face, emb, quality, debugInfo);
          } else {
            handleFrameData(face, undefined, quality, debugInfo);
          }
        } else {
          handleFrameData(null, undefined, undefined, debugInfo);
        }
      } catch (e: any) {
        if (Worklets && Worklets.createRunOnJS) {
           Worklets.createRunOnJS((msg: string) => setFeedback(`ERROR: ${msg}`))(e.message || 'Unknown error');
        }
      }
    }, [boxedModel, faceDetectorInstance, resizePluginInstance, handleFrameData]);

    if (isEnrolling && isFocused) {
      if (!hasPermission || !device || !Camera) {
        return (
          <View style={[styles.container, { padding: 20, justifyContent: 'center' }]}>
            <Text style={[styles.whiteTxt, { marginBottom: 20, fontSize: 18, fontWeight: 'bold' }]}>Camera or models not available</Text>
            <TouchableOpacity style={{ backgroundColor: '#ef4444', padding: 15, borderRadius: 8, alignItems: 'center' }} onPress={() => setIsEnrolling(false)}>
              <Text style={styles.cancelTxt}>Go Back</Text>
            </TouchableOpacity>
          </View>
        );
      }
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
            <View style={[styles.faceGuideBox, isFaceAcceptable && { borderColor: 'rgba(16, 185, 129, 0.4)' }]}>
              <View style={[styles.corner, styles.cornerTL, isFaceAcceptable && { borderColor: '#10b981' }]} />
              <View style={[styles.corner, styles.cornerTR, isFaceAcceptable && { borderColor: '#10b981' }]} />
              <View style={[styles.corner, styles.cornerBL, isFaceAcceptable && { borderColor: '#10b981' }]} />
              <View style={[styles.corner, styles.cornerBR, isFaceAcceptable && { borderColor: '#10b981' }]} />
            </View>

            <View style={styles.hud}>
              <Text style={styles.promptMainText}>{feedback}</Text>
              {challenges.length > 0 && (
                <View style={styles.challengesContainer}>
                  {challenges.map((c, idx) => {
                    const status = challengeStatuses[idx];
                    const isActive = idx === currentChallengeIdx;
                    return (
                      <View key={c.id} style={styles.challengeBadge}>
                        <Text style={[styles.badgeDot, status === 'passed' && { color: '#10b981' }, isActive && status !== 'passed' && { color: '#f59e0b' }]}>
                          {status === 'passed' ? '✓' : isActive ? '●' : '○'}
                        </Text>
                        <Text style={[styles.badgeTxt, isActive && { color: 'white', fontWeight: 'bold' }]}>
                          {c.type === 'LOOK_FRONT' ? 'Front' : c.type === 'TURN_LEFT' ? 'Left' : c.type === 'TURN_RIGHT' ? 'Right' : c.type}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                disabled={!isFaceAcceptable || !latestEmbeddingRef.current}
                style={[styles.captureBtn, (!isFaceAcceptable || !latestEmbeddingRef.current) && styles.captureBtnDisabled]}
                onPress={() => {
                  if (!latestEmbeddingRef.current) {
                    Alert.alert('No Face', 'No face detected yet! Please look at the camera.');
                    return;
                  }

                const embedding = latestEmbeddingRef.current;
                const challenge = challenges[currentChallengeIdx];
                if (!challenge) return;

                if (challenge.type === 'LOOK_FRONT') {
                  const embs = new Array(5).fill(embedding);
                  setFrontEmbeddings(embs);
                  setQualityScores(prev => [...prev, 1.0]);
                  
                  const nextStatuses = [...challengeStatuses];
                  nextStatuses[currentChallengeIdx] = 'passed';
                  setChallengeStatuses(nextStatuses);
                  setCurrentChallengeIdx(1);
                  setFeedback('Front angle captured! Now turn head left.');
                } else if (challenge.type === 'TURN_LEFT') {
                  const embs = new Array(5).fill(embedding);
                  setLeftEmbeddings(embs);
                  setQualityScores(prev => [...prev, 1.0]);
                  
                  const nextStatuses = [...challengeStatuses];
                  nextStatuses[currentChallengeIdx] = 'passed';
                  setChallengeStatuses(nextStatuses);
                  setCurrentChallengeIdx(2);
                  setFeedback('Left angle captured! Now turn head right.');
                } else if (challenge.type === 'TURN_RIGHT') {
                  const embs = new Array(5).fill(embedding);
                  const nextStatuses = [...challengeStatuses];
                  nextStatuses[currentChallengeIdx] = 'passed';
                  setChallengeStatuses(nextStatuses);
                  
                  saveEnrolledFace(frontEmbeddings, leftEmbeddings, embs, [...qualityScores, 1.0]);
                }
              }}>
                <Text style={styles.captureTxt}>Manual Capture</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsEnrolling(false)}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.header}>Enroll Face</Text>
            <Text style={styles.desc}>Register your Employee ID and capture 15 multi-angle face features.</Text>
            <Text style={styles.label}>Employee ID:</Text>
            <TextInput style={styles.input} placeholder="e.g. NHAI-1042" placeholderTextColor="#475569" value={empId} onChangeText={setEmpId} autoCapitalize="characters" />
            <TouchableOpacity style={styles.btn} onPress={startEnrollment}>
              <Text style={styles.btnText}>Start Multi-Angle Capture</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  } catch (err: any) {
    return (
      <View style={{ flex: 1, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Error in EnrollScreen:</Text>
        <Text style={{ color: 'white', fontSize: 14, textAlign: 'center', marginBottom: 10 }}>{err.message}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  whiteTxt: { color: 'white', textAlign: 'center', fontSize: 16 },
  cameraContainer: { flex: 1, borderRadius: 12, overflow: 'hidden', margin: 10 },
  card: { backgroundColor: '#1e293b', padding: 20, margin: 20, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  header: { fontSize: 24, color: 'white', fontWeight: 'bold', marginBottom: 10 },
  desc: { color: '#94a3b8', marginBottom: 20, lineHeight: 20 },
  label: { color: '#cbd5e1', marginBottom: 8, fontWeight: '500' },
  input: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 8, color: 'white', padding: 12, fontSize: 16, marginBottom: 20 },
  btn: { backgroundColor: '#10b981', padding: 15, borderRadius: 8, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  hud: { position: 'absolute', top: 20, left: 20, right: 20, backgroundColor: 'rgba(15, 23, 42, 0.85)', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  promptMainText: { color: '#38bdf8', fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  challengesContainer: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 5 },
  challengeBadge: { flexDirection: 'row', alignItems: 'center' },
  badgeDot: { color: '#64748b', fontSize: 16, marginRight: 5 },
  badgeTxt: { color: '#94a3b8', fontSize: 12 },
  faceGuideBox: { position: 'absolute', top: '22%', left: '15%', width: '70%', height: '50%', borderColor: 'rgba(56, 189, 248, 0.2)', borderWidth: 1, borderRadius: 8 },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: '#38bdf8' },
  cornerTL: { top: -2, left: -2, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 4 },
  cornerTR: { top: -2, right: -2, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 4 },
  cornerBL: { bottom: -2, left: -2, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: -2, right: -2, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 4 },
  buttonRow: { position: 'absolute', bottom: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  captureBtn: { flex: 2, backgroundColor: '#10b981', padding: 15, borderRadius: 8, alignItems: 'center' },
  captureBtnDisabled: { backgroundColor: '#334155', opacity: 0.5 },
  captureTxt: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { flex: 1, backgroundColor: '#ef4444', padding: 15, borderRadius: 8, alignItems: 'center' },
  cancelTxt: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Switch } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { NitroModules } from 'react-native-nitro-modules';
import { useIsFocused } from '@react-navigation/native';

import { getOrLoadModel, getLoadedModel } from '../ModelLoader';
import { StorageEngine } from '../StorageEngine';
import { RAGPipeline, MatchResult } from '../RAGPipeline';
import { QualityGate, QualityReport } from '../QualityGate';
import { LivenessEngine, LivenessChallenge } from '../LivenessEngine';

type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function AuthScreen({ navigation }: any) {
  try {
    const [authStatus, setAuthStatus] = useState<'idle' | 'scanning'>('idle');
    const [hasPermission, setHasPermission] = useState(false);
    const [isHindi, setIsHindi] = useState(false);

    // Live UI State
    const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
    const [matchInfo, setMatchInfo] = useState<MatchResult | null>(null);
    const [recentMatches, setRecentMatches] = useState<{id: string, time: number}[]>([]);

    // Liveness states
    const [challenges, setChallenges] = useState<LivenessChallenge[]>([]);
    const [currentChallengeIdx, setCurrentChallengeIdx] = useState(0);
    const [livenessState, setLivenessState] = useState<'idle' | 'challenging' | 'passed' | 'failed'>('idle');
    const [feedback, setFeedback] = useState('Position your face in front of the camera');
    const [timeLeft, setTimeLeft] = useState(3.0);

    const device = useCameraDevice ? useCameraDevice('front') : null;
    const isFocused = useIsFocused();

    const [modelLoaded, setModelLoaded] = useState(!!getLoadedModel());
    
    // History queue for temporal smoothing
    const frameHistoryRef = useRef<number[][]>([]);

    // Timer for active liveness challenge
    const challengeStartRef = useRef<number>(0);

    useEffect(() => {
      if (!isFocused) {
        setAuthStatus('idle');
        setFaceBox(null);
        setMatchInfo(null);
        setChallenges([]);
        setCurrentChallengeIdx(0);
        setLivenessState('idle');
        challengeStartRef.current = 0;
        setFeedback('Position your face in front of the camera');
      }
    }, [isFocused]);

    useEffect(() => {
      if (livenessState !== 'challenging') {
        setTimeLeft(5.0);
        return;
      }

      const challenge = challenges[currentChallengeIdx];
      const initialTime = challenge ? challenge.timeoutMs / 1000 : 5.0;
      setTimeLeft(initialTime);

      let currentRemaining = initialTime;

      const interval = setInterval(() => {
        currentRemaining = Math.max(0, parseFloat((currentRemaining - 0.1).toFixed(1)));
        setTimeLeft(currentRemaining);

        if (currentRemaining <= 0) {
          clearInterval(interval);
          setLivenessState('failed');
          setFeedback(isHindi ? 'प्रमाणीकरण विफल: समय समाप्त' : 'Auth Failed: Liveness Timeout');
          setFaceBox(null);
          setMatchInfo(null);
        }
      }, 100);

      return () => clearInterval(interval);
    }, [livenessState, currentChallengeIdx, isHindi, isFocused, challenges]);

    useEffect(() => {
      if (!modelLoaded) {
        getOrLoadModel()
          .then(() => setModelLoaded(true))
          .catch((e) => console.error('[AuthScreen] Model loading error:', e));
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

    const startAuth = async () => {
      if (!Camera) return;

      let status = await Camera.getCameraPermissionStatus();
      if (status !== 'granted') status = await Camera.requestCameraPermission();

      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera permission is required.');
        return;
      }

      setHasPermission(true);
      setAuthStatus('scanning');
      setRecentMatches([]);

      const session = LivenessEngine.generateAuthSession();
      setChallenges(session);
      setCurrentChallengeIdx(0);
      setLivenessState('challenging');
      setFeedback(isHindi ? session[0].promptHi : session[0].promptEn);
    };

    const retryAuth = () => {
      setRecentMatches([]);
      frameHistoryRef.current = [];
      setMatchInfo(null);
      const session = LivenessEngine.generateAuthSession();
      setChallenges(session);
      setCurrentChallengeIdx(0);
      setLivenessState('challenging');
      setFeedback(isHindi ? session[0].promptHi : session[0].promptEn);
    };

    const processMatchJS = async (embedding: number[], quality: QualityReport, bounds: FaceBox) => {
      setFaceBox(bounds);
      
      // Update history
      frameHistoryRef.current.push(embedding);
      if (frameHistoryRef.current.length > 5) {
        frameHistoryRef.current.shift();
      }

      // Run RAG Pipeline Match
      const result = await RAGPipeline.matchFace(embedding, quality, frameHistoryRef.current);
      setMatchInfo(result);

      if (result.matched && result.userId) {
        const uid = result.userId;
        setRecentMatches(prev => {
          const filtered = prev.filter(p => p.id !== uid);
          return [{ id: uid, time: Date.now() }, ...filtered].slice(0, 3);
        });

        setFeedback(isHindi ? `पहुंच प्रदान की गई: ${uid}` : `Access Granted: ${uid}`);

        // Throttle saves to DB to avoid spamming
        const lastSaved = StorageEngine.getAllRecords().find(r => r.userId === uid);
        if (!lastSaved || Date.now() - lastSaved.timestamp > 60000) {
          StorageEngine.saveRecord({
            userId: uid,
            timestamp: Date.now(),
            confidence: result.confidence,
            livenessPassed: true,
          });
        }
      } else {
        setFeedback(isHindi ? 'पहुंच अस्वीकृत: अज्ञात चेहरा' : 'Access Denied: Unknown Face');
      }
    };

    const onFaceDetected = (face: any, embedding?: number[], quality?: QualityReport) => {
      if (livenessState === 'challenging') {
        if (!face || !quality) {
          setFaceBox(null);
          setMatchInfo(null);
          const challenge = challenges[currentChallengeIdx];
          const prompt = challenge ? (isHindi ? challenge.promptHi : challenge.promptEn) : '';
          setFeedback(isHindi 
            ? `कैमरे की ओर देखें | ${prompt}` 
            : `Look at the camera | ${prompt}`
          );
          return;
        }

        setFaceBox(face.bounds);

        const challenge = challenges[currentChallengeIdx];
        if (!challenge) return;

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

        if (!isFaceGood) {
          if (quality.sizeScore < 0.3) {
            setFeedback(isHindi ? `कैमरे के करीब आएं` : `Move closer to the camera`);
          } else {
            setFeedback(isHindi ? `कैमरे की ओर सीधे देखें` : `Look straight at the camera`);
          }
          return;
        }

        const isPassed = LivenessEngine.validateFrame(challenge.type, {
          leftEyeOpenProbability: face.leftEyeOpenProbability,
          rightEyeOpenProbability: face.rightEyeOpenProbability,
          smilingProbability: face.smilingProbability,
          headEulerAngleY: face.yawAngle,
          headEulerAngleX: face.pitchAngle,
        });

        if (isPassed && embedding) {
          if (currentChallengeIdx < challenges.length - 1) {
            setCurrentChallengeIdx(prev => prev + 1);
            const nextCh = challenges[currentChallengeIdx + 1];
            setFeedback(isHindi ? nextCh.promptHi : nextCh.promptEn);
          } else {
            // Liveness fully passed! Execute face recognition match
            setLivenessState('passed');
            setFeedback(isHindi ? 'सत्यापन हो रहा है...' : 'Verifying identity...');
            processMatchJS(embedding, quality, face.bounds);
          }
        } else {
          const prompt = isHindi ? challenge.promptHi : challenge.promptEn;
          setFeedback(prompt);
        }
      } else if (livenessState === 'passed') {
        if (!face) {
          setFaceBox(null);
          setMatchInfo(null);
          return;
        }
        setFaceBox(face.bounds);
      } else {
        setFaceBox(null);
      }
    };

    const onFaceDetectedRef = React.useRef(onFaceDetected);
    React.useEffect(() => {
      onFaceDetectedRef.current = onFaceDetected;
    });

    const stableOnFaceDetected = React.useCallback((face: any, embedding?: number[], quality?: QualityReport) => {
      onFaceDetectedRef.current(face, embedding, quality);
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
        if (faces && faces.length >= 1) {
          // Find closest/largest face
          let face = faces[0];
          for (let i = 1; i < faces.length; i++) {
            const areaCurrent = face.bounds.width * face.bounds.height;
            const areaNext = faces[i].bounds.width * faces[i].bounds.height;
            if (areaNext > areaCurrent) face = faces[i];
          }
          
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

          for (let i = 0; i < resized.length; i++) resized[i] = (resized[i] * 2.0) - 1.0;

          const outputs = activeModel.runSync([resized.buffer]);
          if (outputs && outputs[0]) {
            const emb = Array.from(new Float32Array(outputs[0] as ArrayBuffer));
            handleFrameData(face, emb, quality);
          } else {
            handleFrameData(null);
          }
        } else {
          handleFrameData(null);
        }
      } catch (e) {
      }
    }, [boxedModel, faceDetectorInstance, resizePluginInstance, handleFrameData]);

    // Live Render logic
    const renderOverlay = () => {
      if (livenessState !== 'passed' || !faceBox) return null;

      const isMatched = matchInfo?.matched;
      const confidencePercent = matchInfo ? Math.round(matchInfo.confidence * 100) : 0;
      const boxColor = isMatched ? '#10b981' : '#ef4444';
      
      const labelText = isMatched ? `${matchInfo.userId} ${confidencePercent}%` : 'UNKNOWN';

      return (
        <View style={StyleSheet.absoluteFill}>
          <View style={[
            styles.dynamicBox, 
            { 
              borderColor: boxColor,
              top: '25%', left: '20%', width: '60%', height: '40%'
            }
          ]}>
            <View style={[styles.nameLabel, { backgroundColor: boxColor }]}>
              <Text style={styles.nameText}>{labelText}</Text>
            </View>
            {isMatched && (
              <View style={styles.confidenceBarContainer}>
                <View style={[styles.confidenceBar, { width: `${confidencePercent}%`, backgroundColor: confidencePercent > 90 ? '#10b981' : '#f59e0b' }]} />
              </View>
            )}
          </View>
        </View>
      );
    };

    if (authStatus === 'scanning' && isFocused && hasPermission && device && Camera) {
      if (livenessState === 'failed') {
        return (
          <View style={styles.container}>
            <View style={styles.popupCard}>
              <View style={[styles.statusIconContainer, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
                <Text style={styles.statusIconText}>❌</Text>
              </View>
              <Text style={styles.popupHeader}>
                {isHindi ? 'प्रमाणीकरण विफल' : 'Authentication Failed'}
              </Text>
              <Text style={styles.popupDesc}>
                {feedback}
              </Text>
              
              <View style={styles.popupActionRow}>
                <TouchableOpacity 
                  style={[styles.cancelBtn, { flex: 1, marginRight: 12, backgroundColor: '#475569' }]} 
                  onPress={() => {
                    setAuthStatus('idle');
                    setLivenessState('idle');
                  }}
                >
                  <Text style={styles.cancelTxt}>{isHindi ? 'बंद करें' : 'Close'}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.btn, { flex: 1 }]} 
                  onPress={retryAuth}
                >
                  <Text style={styles.btnText}>{isHindi ? 'पुनः प्रयास करें' : 'Retry'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      }

      if (livenessState === 'passed') {
        const isMatched = matchInfo?.matched;
        
        if (matchInfo && isMatched) {
          return (
            <View style={styles.container}>
              <View style={styles.popupCard}>
                <View style={[styles.statusIconContainer, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
                  <Text style={styles.statusIconText}>✅</Text>
                </View>
                <Text style={styles.popupHeader}>
                  {isHindi ? 'प्रमाणीकरण सफल' : 'Authentication Successful'}
                </Text>
                <Text style={styles.popupDesc}>
                  {isHindi ? `कर्मचारी आईडी: ${matchInfo.userId}` : `Employee ID: ${matchInfo.userId}`}
                </Text>
                <Text style={styles.popupSubDesc}>
                  {isHindi ? `विश्वास स्तर: ${Math.round(matchInfo.confidence * 100)}%` : `Confidence: ${Math.round(matchInfo.confidence * 100)}%`}
                </Text>
                
                <TouchableOpacity 
                  style={[styles.btn, { width: '100%', marginTop: 24, backgroundColor: '#10b981' }]} 
                  onPress={() => {
                    setAuthStatus('idle');
                    setLivenessState('idle');
                  }}
                >
                  <Text style={[styles.btnText, { color: 'white' }]}>{isHindi ? 'ठीक है' : 'Done'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }

        if (matchInfo && !isMatched) {
          return (
            <View style={styles.container}>
              <View style={styles.popupCard}>
                <View style={[styles.statusIconContainer, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
                  <Text style={styles.statusIconText}>👤❌</Text>
                </View>
                <Text style={styles.popupHeader}>
                  {isHindi ? 'प्रमाणीकरण विफल' : 'Authentication Failed'}
                </Text>
                <Text style={styles.popupDesc}>
                  {isHindi ? 'अज्ञात चेहरा (चेहरा मैच नहीं हुआ)' : 'Unknown Face (Face match failed)'}
                </Text>
                
                <View style={styles.popupActionRow}>
                  <TouchableOpacity 
                    style={[styles.cancelBtn, { flex: 1, marginRight: 12, backgroundColor: '#475569' }]} 
                    onPress={() => {
                      setAuthStatus('idle');
                      setLivenessState('idle');
                    }}
                  >
                    <Text style={styles.cancelTxt}>{isHindi ? 'बंद करें' : 'Close'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.btn, { flex: 1 }]} 
                    onPress={retryAuth}
                  >
                    <Text style={styles.btnText}>{isHindi ? 'पुनः प्रयास करें' : 'Retry'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }

        return (
          <View style={styles.container}>
            <View style={styles.popupCard}>
              <Text style={[styles.popupHeader, { marginBottom: 16 }]}>
                {isHindi ? 'सत्यापन हो रहा है...' : 'Verifying Identity...'}
              </Text>
              <Text style={styles.popupDesc}>
                {isHindi ? 'कृपया प्रतीक्षा करें' : 'Please wait while we match your face'}
              </Text>
            </View>
          </View>
        );
      }

      return (
        <View style={styles.container}>
          <View style={styles.cameraContainer}>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={isFocused && livenessState === 'challenging'}
              pixelFormat="yuv"
              orientation="portrait"
              frameProcessor={frameProcessor}
              onError={(e) => console.log('Camera Error:', e)}
            />
            
            {renderOverlay()}

            <View style={[
              styles.topBar, 
              { 
                backgroundColor: '#d97706', 
                paddingVertical: 12,
                flexDirection: 'column',
                alignItems: 'stretch'
              }
            ]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <Text style={[styles.topBarText, { color: 'white', flex: 1, marginRight: 10 }]}>
                  {feedback}
                  {livenessState === 'challenging' ? ` (${timeLeft.toFixed(1)}s)` : ''}
                </Text>
                <View style={styles.langToggle}>
                  <Text style={styles.langText}>EN</Text>
                  <Switch value={isHindi} onValueChange={setIsHindi} trackColor={{ false: '#334155', true: '#38bdf8' }} thumbColor="white" />
                  <Text style={styles.langText}>HI</Text>
                </View>
              </View>
              {livenessState === 'challenging' && (
                <View style={{ height: 4, backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: 2, marginTop: 8, overflow: 'hidden', width: '100%' }}>
                  <View style={{
                    height: '100%',
                    width: `${(timeLeft / 5.0) * 100}%`,
                    backgroundColor: timeLeft < 1.5 ? '#f43f5e' : timeLeft < 3.0 ? '#fb923c' : '#38bdf8',
                    borderRadius: 2
                  }} />
                </View>
              )}
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
              <TouchableOpacity style={styles.cancelBtn} onPress={() => {
                setAuthStatus('idle');
                setLivenessState('idle');
              }}>
                <Text style={styles.cancelTxt}>{isHindi ? 'रद्द करें' : 'Stop'}</Text>
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
          <Text style={styles.header}>{isHindi ? 'प्रमाणीकरण' : 'Authenticate'}</Text>
          <Text style={styles.desc}>
            {isHindi ? 'रैग पाइपलाइन के साथ मूवी-ग्रेड चेहरे की पहचान।' : 'Movie-grade precise face recognition with offline RAG pipeline.'}
          </Text>

          <TouchableOpacity style={styles.btn} onPress={startAuth}>
            <Text style={styles.btnText}>{isHindi ? 'कैमरा शुरू करें' : 'Start Live Camera'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  } catch (err: any) {
    return (
      <View style={{ flex: 1, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Error in AuthScreen:</Text>
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

  topBar: { position: 'absolute', top: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.7)', padding: 10, borderRadius: 8 },
  topBarText: { color: '#38bdf8', fontWeight: 'bold', fontSize: 16 },
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
  
  popupCard: {
    backgroundColor: '#1e293b',
    padding: 24,
    margin: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  statusIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusIconText: {
    fontSize: 32,
  },
  popupHeader: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 12,
  },
  popupDesc: {
    fontSize: 16,
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  popupSubDesc: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 8,
  },
  popupActionRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 24,
  },
});

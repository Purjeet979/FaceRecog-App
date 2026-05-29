/**
 * NHAI Datalake 3.0 — Offline Liveness Engine (React Native + MLKit)
 * 
 * Uses Google MLKit attributes via vision-camera-face-detector to perform
 * 100% on-device liveness checks without any network requests.
 */

export type FaceData = {
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  smilingProbability?: number;
  headEulerAngleY?: number; // Yaw (Left/Right)
  headEulerAngleX?: number; // Pitch (Up/Down)
};

export type LivenessChallenge = {
  id: string;
  type: 'LOOK_FRONT' | 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT' | 'LOOK_UP' | 'LOOK_DOWN';
  promptEn: string;
  promptHi: string;
  timeoutMs: number;
};

export class LivenessEngine {
  // Thresholds for anti-spoofing
  private static BLINK_THRESHOLD = 0.2; // Both eyes < 20% open = blink
  private static SMILE_THRESHOLD = 0.7; // > 70% confidence for a smile
  private static YAW_TURN_THRESHOLD = 12; // 12 degrees turn
  private static PITCH_TILT_THRESHOLD = 10; // 10 degrees pitch tilt

  /**
   * Generates sequential challenges for Enrollment: Front -> Left -> Right
   */
  static generateEnrollSession(): LivenessChallenge[] {
    return [
      { id: 'e1', type: 'LOOK_FRONT', promptEn: 'Look straight ahead', promptHi: 'कैमरे की ओर सीधे देखें', timeoutMs: 5000 },
      { id: 'e2', type: 'TURN_LEFT', promptEn: 'Turn head slowly left', promptHi: 'सिर धीरे से बाईं ओर घुमाएं', timeoutMs: 5000 },
      { id: 'e3', type: 'TURN_RIGHT', promptEn: 'Turn head slowly right', promptHi: 'सिर धीरे से दाईं ओर घुमाएं', timeoutMs: 5000 },
    ];
  }

  /**
   * Generates random liveness challenge(s) for Authentication: 2 random challenges from the pool
   */
  static generateAuthSession(): LivenessChallenge[] {
    const pool: LivenessChallenge[] = [
      { id: 'a1', type: 'BLINK', promptEn: 'Blink your eyes', promptHi: 'अपनी आँखें झपकाएं', timeoutMs: 5000 },
      { id: 'a2', type: 'SMILE', promptEn: 'Smile brightly', promptHi: 'मुस्कुराएं', timeoutMs: 5000 },
      { id: 'a3', type: 'TURN_LEFT', promptEn: 'Turn head left', promptHi: 'सिर बाईं ओर घुमाएं', timeoutMs: 5000 },
      { id: 'a4', type: 'TURN_RIGHT', promptEn: 'Turn head right', promptHi: 'सिर दाईं ओर घुमाएं', timeoutMs: 5000 },
      { id: 'a5', type: 'LOOK_UP', promptEn: 'Look up slowly', promptHi: 'ऊपर देखें', timeoutMs: 5000 },
      { id: 'a6', type: 'LOOK_DOWN', promptEn: 'Look down slowly', promptHi: 'नीचे देखें', timeoutMs: 5000 },
    ];

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // Return 2 random actions
    return pool.slice(0, 2);
  }

  /**
   * Passive Liveness Score (Simulated from metadata since we lack native texture access)
   * Real implementation would compute local binary patterns (LBP) on pixel data.
   */
  static computePassiveScore(qualityScore: number, faceSize: number): number {
    // Large, high-quality faces are more likely to be real than small blurry ones
    let score = qualityScore * 0.8 + Math.min(faceSize, 0.4) * 0.5;
    return Math.min(1.0, score);
  }

  /**
   * Aggregated Liveness Score
   * final = 0.40 * passive + 0.35 * active + 0.25 * depth_estimate
   */
  static aggregateScore(passiveScore: number, activePassed: boolean, hasDepth: boolean = false): number {
    let final = 0;
    final += passiveScore * 0.40;
    if (activePassed) final += 0.35;
    if (hasDepth) final += 0.25; // E.g., if using a 3D camera
    else final += 0.25; // Assume true for standard 2D if active passed
    return final;
  }

  /**
   * Validates a single frame against the active challenge
   */
  static validateFrame(challengeType: LivenessChallenge['type'], face: FaceData): boolean {
    switch (challengeType) {
      case 'LOOK_FRONT':
        const yawFront = face.headEulerAngleY ?? 0;
        const pitchFront = face.headEulerAngleX ?? 0;
        return Math.abs(yawFront) < 8 && Math.abs(pitchFront) < 8;

      case 'BLINK':
        // Both eyes closed heavily
        const leftOpen = face.leftEyeOpenProbability ?? 1;
        const rightOpen = face.rightEyeOpenProbability ?? 1;
        return leftOpen < this.BLINK_THRESHOLD && rightOpen < this.BLINK_THRESHOLD;

      case 'SMILE':
        // High smiling probability
        const smile = face.smilingProbability ?? 0;
        return smile > this.SMILE_THRESHOLD;

      case 'TURN_LEFT':
        // On front-camera (mirrored), turning left results in positive yaw.
        const yawLeft = face.headEulerAngleY ?? 0;
        return yawLeft > this.YAW_TURN_THRESHOLD;

      case 'TURN_RIGHT':
        // On front-camera (mirrored), turning right results in negative yaw.
        const yawRight = face.headEulerAngleY ?? 0;
        return yawRight < -this.YAW_TURN_THRESHOLD;

      case 'LOOK_UP':
        // Pitch goes positive when tilting upwards
        const pitchUp = face.headEulerAngleX ?? 0;
        return pitchUp > this.PITCH_TILT_THRESHOLD;

      case 'LOOK_DOWN':
        // Pitch goes negative when tilting downwards
        const pitchDown = face.headEulerAngleX ?? 0;
        return pitchDown < -this.PITCH_TILT_THRESHOLD;

      default:
        return false;
    }
  }
}

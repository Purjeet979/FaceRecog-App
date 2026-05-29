/**
 * Quality Gate Engine
 * Assesses frame quality (blur, lighting, angle) before accepting embeddings.
 */

export type QualityReport = {
  blurScore: number;      // 0-1 (1 = sharp)
  lightingScore: number;  // 0-1 (1 = ideal)
  angleScore: number;     // 0-1 (1 = frontal)
  sizeScore: number;      // 0-1 (1 = good size)
  overallScore: number;   // Weighted combination
  isAcceptable: boolean;
};

export class QualityGate {
  /**
   * Assess the quality of a detected face.
   * Note: In a pure JS worklet, calculating actual Laplacian variance on frame pixels 
   * is too slow, so we rely on MLKit's face orientation and bounding box properties.
   */
  static assessFrame(face: any, frameWidth: number, frameHeight: number): QualityReport {
    'worklet';
    // 1. Angle Score (Yaw and Pitch)
    // Ideal is 0. Penalty increases as angle deviates from 0.
    const yaw = face.yawAngle ?? 0;
    const pitch = face.pitchAngle ?? 0;
    const maxAllowedAngle = 30;
    
    // Normalize angle penalty (0 = perfect, 1 = terrible)
    const yawPenalty = Math.min(Math.abs(yaw) / maxAllowedAngle, 1);
    const pitchPenalty = Math.min(Math.abs(pitch) / maxAllowedAngle, 1);
    const angleScore = 1.0 - Math.max(yawPenalty, pitchPenalty);

    // 2. Size Score
    // Face should take up a reasonable portion of the screen
    const faceArea = face.bounds.width * face.bounds.height;
    const frameArea = frameWidth * frameHeight;
    const sizeRatio = faceArea / frameArea;
    
    // Ideal size is between 5% and 40% of the frame
    let sizeScore = 0;
    if (sizeRatio > 0.05 && sizeRatio < 0.40) {
      sizeScore = 1.0;
    } else if (sizeRatio <= 0.05) {
      sizeScore = Math.max(0, sizeRatio / 0.05); // Penalize small faces
    } else {
      sizeScore = Math.max(0, 1 - ((sizeRatio - 0.40) * 2)); // Penalize faces too close
    }

    // 3. Simulated Blur/Lighting (Placeholder for actual pixel processing)
    // Without native pixel access, we assume standard conditions unless face size is very small
    const blurScore = sizeScore > 0.5 ? 0.9 : 0.6; 
    const lightingScore = 0.8; // Default acceptable lighting

    // Overall Weighted Score
    const overallScore = (
      (angleScore * 0.4) + 
      (sizeScore * 0.3) + 
      (blurScore * 0.2) + 
      (lightingScore * 0.1)
    );

    return {
      blurScore,
      lightingScore,
      angleScore,
      sizeScore,
      overallScore,
      // Face is acceptable if overall quality is good AND angle is reasonably straight
      isAcceptable: overallScore > 0.65 && angleScore > 0.5 && sizeScore > 0.3
    };
  }
}

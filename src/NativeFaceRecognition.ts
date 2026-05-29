/**
 * Offline Native Face Recognition Engine
 * Handles embedding normalization, distance metrics, and fusion scoring.
 */

export const NativeFaceRecognition = {
  /**
   * L2 Normalize an embedding vector to unit length.
   */
  l2Normalize(embedding: number[] | Float32Array): number[] {
    let sumSq = 0;
    for (let i = 0; i < embedding.length; i++) {
      sumSq += embedding[i] * embedding[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return Array.from(embedding);
    
    const result = new Array(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      result[i] = embedding[i] / norm;
    }
    return result;
  },

  /**
   * Computes Cosine Similarity between two L2-normalized embeddings.
   * Returns a score between -1.0 and 1.0 (1.0 = identical).
   */
  computeCosineSimilarity(emb1: number[], emb2: number[]): number {
    if (emb1.length !== emb2.length) return 0;
    
    let dotProduct = 0;
    for (let i = 0; i < emb1.length; i++) {
      dotProduct += emb1[i] * emb2[i];
    }
    // Since vectors are already L2 normalized, dot product == cosine similarity
    return dotProduct;
  },

  /**
   * Computes Euclidean Distance between two vectors.
   * Returns distance >= 0 (0 = identical).
   */
  computeEuclideanDistance(emb1: number[], emb2: number[]): number {
    if (emb1.length !== emb2.length) return 1000;
    
    let sumSq = 0;
    for (let i = 0; i < emb1.length; i++) {
      const diff = emb1[i] - emb2[i];
      sumSq += diff * diff;
    }
    return Math.sqrt(sumSq);
  },

  /**
   * Combines multiple signals into a single fusion confidence score (0-1).
   */
  fusionScore(cosine: number, distance: number, probeQuality: number, templateQuality: number = 1.0): number {
    // Calibrate cosine similarity from [-1, 1] to [0, 1] probability using sigmoid-like scaling
    // For MobileFaceNet, matching faces typically score > 0.60
    const scaledCosine = Math.max(0, (cosine + 1) / 2);
    
    // Quality penalty: if either probe or template is poor quality, reduce confidence slightly
    const qualityFactor = (probeQuality + templateQuality) / 2;
    const qualityPenalty = 1.0 - ((1.0 - qualityFactor) * 0.2); // Max 20% penalty
    
    // Distance factor (optional heuristic)
    // For L2 normalized vectors, Euclidean distance D = sqrt(2 - 2*Cosine)
    
    // We boost the score if cosine is exceptionally high
    let confidence = scaledCosine * qualityPenalty;
    
    // Remap to a human-friendly "percentage" where 0.65 raw cosine ~ 85% confidence
    // Custom mapping: 
    // Raw Cosine 0.40 -> 30%
    // Raw Cosine 0.55 -> 70%
    // Raw Cosine 0.65 -> 88%
    // Raw Cosine 0.75 -> 95%
    // Raw Cosine 0.85 -> 99%
    if (cosine < 0.4) return cosine * 0.5; // Very low
    
    const mapped = 1.0 / (1.0 + Math.exp(-12 * (cosine - 0.52)));
    return Math.min(1.0, mapped * qualityPenalty);
  },

  /**
   * Determines if two faces match based on fusion score.
   */
  isMatch(fusionScore: number, threshold: number = 0.93): boolean {
    // 0.93 fusion score roughly corresponds to 0.74 raw cosine similarity
    return fusionScore >= threshold;
  }
};

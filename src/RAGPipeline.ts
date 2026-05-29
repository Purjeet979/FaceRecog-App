/**
 * RAG Pipeline (Retrieval-Augmented Match Engine)
 * Context-aware offline face matching using VectorStore and temporal signals.
 */

import { VectorStore, globalVectorStore, SearchResult } from './VectorStore';
import { NativeFaceRecognition } from './NativeFaceRecognition';
import { StorageEngine } from './StorageEngine';
import { QualityGate, QualityReport } from './QualityGate';

export type MatchResult = {
  matched: boolean;
  userId: string | null;
  confidence: number;
  signals: {
    rawCosine: number;
    qualityWeight: number;
    temporalConsensus: number;
    marginConfidence: number;
  };
};

export class RAGPipeline {
  
  /**
   * Main entry point for RAG-based authentication.
   * 1. Retrieve candidates
   * 2. Augment with context
   * 3. Decide match
   */
  static async matchFace(
    probeEmbedding: number[],
    qualityReport: QualityReport,
    frameHistory: number[][]
  ): Promise<MatchResult> {
    // 1. L2 Normalize probe
    const normalizedProbe = NativeFaceRecognition.l2Normalize(probeEmbedding);

    // 2. RETRIEVE top candidates from Vector Store
    const candidates = globalVectorStore.search(normalizedProbe, 3);
    
    if (candidates.length === 0) {
      return this.emptyResult();
    }

    // 3. AUGMENT with contextual signals
    const topCandidate = candidates[0];
    
    // Fetch template metadata to get enrolled quality score
    const template = StorageEngine.loadTemplate(topCandidate.userId);
    const templateQuality = template?.quality_score ?? 0.85; // Default if missing

    // Fusion score combining vector similarity and image quality
    const fusionConfidence = NativeFaceRecognition.fusionScore(
      topCandidate.similarity,
      topCandidate.distance,
      qualityReport.overallScore,
      templateQuality
    );

    // Margin confidence: distance between #1 and #2 match
    // Larger margin = higher certainty it's not a twin or similar face
    let marginConfidence = 1.0;
    if (candidates.length > 1) {
      const margin = topCandidate.similarity - candidates[1].similarity;
      marginConfidence = Math.min(1.0, margin / 0.15); // Max margin credit at 0.15 gap
    }

    // Temporal consensus: Do recent frames agree?
    let temporalConsensus = 1.0;
    if (frameHistory.length >= 3) {
      // Compare current frame to history average
      let matchCount = 0;
      for (const hist of frameHistory) {
        const sim = NativeFaceRecognition.computeCosineSimilarity(normalizedProbe, hist);
        if (sim > 0.80) matchCount++; // Same face in recent frames
      }
      temporalConsensus = matchCount / frameHistory.length;
    }

    // 4. DECIDE
    // Boost final confidence if temporal consensus and margin are strong
    let finalConfidence = fusionConfidence;
    if (temporalConsensus > 0.8 && marginConfidence > 0.5) {
      finalConfidence = Math.min(1.0, finalConfidence * 1.05); // 5% boost
    } else if (temporalConsensus < 0.4) {
      finalConfidence *= 0.9; // 10% penalty for flickering face
    }

    const isMatch = NativeFaceRecognition.isMatch(finalConfidence, 0.93);

    return {
      matched: isMatch,
      userId: isMatch ? topCandidate.userId : null,
      confidence: finalConfidence,
      signals: {
        rawCosine: topCandidate.similarity,
        qualityWeight: qualityReport.overallScore,
        temporalConsensus,
        marginConfidence
      }
    };
  }

  private static emptyResult(): MatchResult {
    return {
      matched: false,
      userId: null,
      confidence: 0,
      signals: {
        rawCosine: 0,
        qualityWeight: 0,
        temporalConsensus: 0,
        marginConfidence: 0
      }
    };
  }
}

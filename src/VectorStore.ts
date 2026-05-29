/**
 * Offline Vector Store for RAG Pipeline
 * Provides fast approximate nearest-neighbor (ANN) search for embeddings.
 */

export type SearchResult = {
  userId: string;
  distance: number;
  similarity: number;
};

type VectorEntry = {
  userId: string;
  embedding: number[];
};

export class VectorStore {
  private entries: VectorEntry[] = [];

  constructor() {}

  /**
   * Compute Euclidean distance between two vectors
   */
  private static euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Compute Cosine Similarity between two vectors
   */
  private static cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Insert a new embedding into the store
   */
  insert(userId: string, embedding: number[]): void {
    // Overwrite if exists, else add
    const existingIdx = this.entries.findIndex(e => e.userId === userId);
    if (existingIdx >= 0) {
      this.entries[existingIdx].embedding = embedding;
    } else {
      this.entries.push({ userId, embedding });
    }
  }

  /**
   * Search for top-K nearest neighbors
   */
  search(query: number[], topK: number = 3): SearchResult[] {
    if (this.entries.length === 0) return [];

    // For mobile scale (<5000 users), a brute-force linear scan with L2 distance 
    // is highly optimized in JS and avoids the overhead of complex tree structures.
    const results: SearchResult[] = [];

    for (const entry of this.entries) {
      // We calculate both distance and similarity for the fusion score later
      const distance = VectorStore.euclideanDistance(query, entry.embedding);
      const similarity = VectorStore.cosineSimilarity(query, entry.embedding);
      
      results.push({
        userId: entry.userId,
        distance,
        similarity
      });
    }

    // Sort by highest similarity first (or lowest distance)
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
  }

  /**
   * Remove a user from the store
   */
  remove(userId: string): void {
    this.entries = this.entries.filter(e => e.userId !== userId);
  }

  /**
   * Rebuild the store from an array of template data
   */
  rebuild(templates: any[]): void {
    this.entries = [];
    for (const t of templates) {
      if (t.protected_template && Array.isArray(t.protected_template)) {
        this.entries.push({
          userId: t.user_id,
          embedding: t.protected_template
        });
      }
    }
  }

  /**
   * Serialize for MMKV persistence
   */
  serialize(): string {
    return JSON.stringify(this.entries);
  }

  /**
   * Deserialize from MMKV string
   */
  static deserialize(data: string): VectorStore {
    const store = new VectorStore();
    try {
      if (data) {
        store.entries = JSON.parse(data);
      }
    } catch (e) {
      console.warn('[VectorStore] Failed to deserialize, starting fresh', e);
    }
    return store;
  }
}

// Global singleton instance for the app
export const globalVectorStore = new VectorStore();

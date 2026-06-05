export interface EmbeddingResult {
  embedding: number[];
  totalTokens: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

export interface IEmbeddingProvider {
  readonly model: string;
  generateEmbedding(text: string): Promise<EmbeddingResult>;
  generateEmbeddings(texts: string[]): Promise<BatchEmbeddingResult>;
}

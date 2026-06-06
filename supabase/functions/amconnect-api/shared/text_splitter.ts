export class TextSplitter {
  constructor(
    private readonly chunkSize = 800,
    private readonly chunkOverlap = 150,
    private readonly minChunkSize = 80,
  ) {}

  split(text: string): string[] {
    if (!text) return [""];
    if (text.length <= this.chunkSize) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const chunk = text.slice(start, end);
      chunks.push(chunk);

      if (end >= text.length) break;

      // Buscar un límite de palabra dentro del overlap (espacio o salto de línea)
      let lastSpace = -1;
      const searchStart = Math.max(start, end - this.chunkOverlap);
      for (let i = end - 1; i >= searchStart; i--) {
        if (text[i] === " " || text[i] === "\n") {
          lastSpace = i;
          break;
        }
      }

      if (lastSpace !== -1) {
        start = lastSpace + 1;
      } else {
        start = end;
      }
    }

    // Filtrar chunks muy pequeños, excepto si es el último
    return chunks.filter(
      (c) => c.trim().length >= this.minChunkSize || c === chunks[chunks.length - 1],
    );
  }
}

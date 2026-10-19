export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`dim mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function topK<T extends { vector: number[] }>(
  query: number[],
  items: T[],
  k: number,
  threshold = 0
): (T & { score: number })[] {
  return items
    .map((it) => ({ ...it, score: cosine(query, it.vector) }))
    .filter((it) => it.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

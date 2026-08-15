import "server-only";

/**
 * pgvector accepts vectors as text in the form "[v1,v2,...]" cast with
 * ::vector. The `pg` driver has no native vector type, so persistence and
 * search code pass this string and let Postgres parse it.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

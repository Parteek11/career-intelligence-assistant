// Vitest runs outside Next.js's webpack build, which is what normally
// no-ops the `server-only` package for server-side code. This stub lets
// tests import server-only modules (db, rag) without the guard throwing.
export {};

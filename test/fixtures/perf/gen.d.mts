/**
 * Type declarations for the deterministic perf-fixture generator (gen.mjs).
 * The implementation is plain JS (.mjs) so it can run directly via `node`
 * without a build step; these declarations give the vitest bench full typing.
 */

/** Generate a ~1,000-line markdown document (no anchors). */
export function gen1kDoc(): string;

/** Generate a ~10,000-line markdown document carrying 200 span anchor pairs. */
export function gen10kDoc(): string;

/** Write doc-1k.md and doc-10k.md next to the generator. */
export function writeFixtures(): void;

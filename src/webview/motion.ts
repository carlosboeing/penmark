/**
 * Motion preference for the preview webview.
 *
 * Penmark gates its non-essential JS-driven motion (currently the smooth
 * comment-to-highlight jumps) on the user's `prefers-reduced-motion` setting,
 * mirroring the CSS `@media (prefers-reduced-motion: reduce)` rules. Guarded for
 * environments without `matchMedia` (older embed hosts / unit harness), where it
 * defaults to false (full motion).
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

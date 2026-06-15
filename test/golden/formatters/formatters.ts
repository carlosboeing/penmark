/**
 * In-memory formatter passes for the T11 golden gate.
 *
 * The P0.1 spike (`spikes/anchor-torture-test/run-formatters.sh`) ran three
 * mechanical formatters over the anchored corpus via their CLIs and temp files.
 * For the permanent CI gate we run the same three passes string-in/string-out
 * via the Node APIs — no temp files, no CLI, no `.gitignore` interaction:
 *
 *   - prettier defaults
 *   - prettier `proseWrap: always`  (hostile reflow through marker pairs)
 *   - markdownlint `--fix`          (lint + applyFixes, single pass)
 */

import * as prettier from "prettier";
import { lint } from "markdownlint/sync";
import { applyFixes } from "markdownlint";

/** Format markdown with Prettier defaults. */
export async function prettierDefault(src: string): Promise<string> {
  return prettier.format(src, { parser: "markdown" });
}

/** Format markdown with Prettier `proseWrap: always` (the hostile reflow pass). */
export async function prettierProseWrap(src: string): Promise<string> {
  return prettier.format(src, { parser: "markdown", proseWrap: "always" });
}

/**
 * Apply markdownlint's fixable rules to a string, mirroring `markdownlint-cli2 --fix`.
 *
 * Uses the `markdownlint` library directly: `lint` produces the rule violations
 * (each with optional `fixInfo`), then `applyFixes` rewrites the source for the
 * fixable ones. This is a single fix pass — the same as the CLI's default
 * behaviour over a one-shot string.
 */
export function markdownlintFix(src: string): string {
  const results = lint({ strings: { doc: src } });
  const errors = results.doc ?? [];
  return applyFixes(src, errors);
}

/** The three formatter passes keyed by a stable, filename-safe id. */
export const FORMATTERS: ReadonlyArray<{
  readonly id: string;
  readonly run: (src: string) => string | Promise<string>;
}> = [
  { id: "prettier-default", run: prettierDefault },
  { id: "prettier-prosewrap", run: prettierProseWrap },
  { id: "markdownlint-fix", run: markdownlintFix },
];

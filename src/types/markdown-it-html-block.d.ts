// @types/markdown-it declares the parser but not the individual rule modules.
// The renderer imports the stock html_block rule so it can wrap it (see
// src/core/render/markdown.ts) rather than reimplement CommonMark's HTML-block
// scanning. Minimal ambient declaration for that one subpath.
declare module "markdown-it/lib/rules_block/html_block.mjs" {
  import type { ParserBlock } from "markdown-it/lib/parser_block.mjs";
  const htmlBlock: ParserBlock.RuleBlock;
  export default htmlBlock;
}

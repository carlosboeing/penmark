// markdown-it-task-lists has no @types package; minimal ambient declaration.
declare module "markdown-it-task-lists" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

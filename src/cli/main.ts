import { run } from "./run.js";

const code = run(process.argv.slice(2));
process.exit(code);

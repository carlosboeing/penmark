import { run } from "./run.js";

// Set the exit code and let the process end by itself. process.exit() does not
// wait for a pending stdout write, and a write to a pipe is asynchronous on
// POSIX, so a result larger than the pipe buffer would be cut short.
process.exitCode = run(process.argv.slice(2));

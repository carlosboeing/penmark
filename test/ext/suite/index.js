// Mocha test runner entry point loaded by @vscode/test-electron inside VS Code.
// Registers tsx/cjs so the TypeScript test files can be required directly.
// Exports run() as required by the extension test host protocol.

"use strict";

const path = require("path");
const Mocha = require("mocha");

// Register tsx so .ts files in this suite can be required without pre-compilation.
require("tsx/cjs");

// previewPanel's lazy `import("./render.js")` is a dynamic import(), which bypasses
// the tsx/cjs require hook and hits Node's native ESM resolver — failing to map
// ./render.js -> render.ts when the extension is loaded from source by these tests.
// Register tsx's ESM loader too so dynamic import() of the TS source resolves.
// (Production loads dist/render.js, emitted as a sibling chunk by the build, so this
// only affects the source-loaded test path.)
require("tsx/esm/api").register();

/** @returns {Promise<void>} */
exports.run = function () {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 10000 });

  // activation.test.ts runs FIRST so its activation-time assertion observes a
  // cold activate() (before smoke/preview trigger the command — see T12).
  mocha.addFile(path.join(__dirname, "activation.test.ts"));
  mocha.addFile(path.join(__dirname, "smoke.test.ts"));
  mocha.addFile(path.join(__dirname, "preview.test.ts"));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
};

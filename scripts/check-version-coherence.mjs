/**
 * Verify that a VSIX release has one exact three-component version everywhere
 * it is represented.
 *
 * Usage:
 *   node scripts/check-version-coherence.mjs --tag v0.5.6 \
 *     package.json package-lock.json extension-package.json extension.vsixmanifest
 *   node scripts/check-version-coherence.mjs --no-tag \
 *     package.json package-lock.json extension-package.json extension.vsixmanifest
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * @typedef {Object} VersionSources
 * @property {string} [tagName]
 * @property {string} packageVersion
 * @property {string} lockfileVersion
 * @property {string} vsixPackageVersion
 * @property {string} manifestVersion
 */

/**
 * @typedef {Object} VersionCheckResult
 * @property {string} expectedVersion
 * @property {string[]} errors
 * @property {boolean} passed
 */

/**
 * Compare package, lockfile, VSIX manifest, and optional tag versions.
 *
 * @param {VersionSources} sources
 * @returns {VersionCheckResult}
 */
export function checkVersionCoherence(sources) {
  const errors = [];
  const expectedVersion = sources.packageVersion;

  if (!VERSION_PATTERN.test(expectedVersion)) {
    errors.push(`package version ${expectedVersion} must match MAJOR.MINOR.PATCH`);
  }

  const packagedVersions = [
    ["lockfile", sources.lockfileVersion],
    ["VSIX package", sources.vsixPackageVersion],
    ["VSIX manifest", sources.manifestVersion],
  ];

  for (const [label, version] of packagedVersions) {
    if (!VERSION_PATTERN.test(version)) {
      errors.push(`${label} version ${version} must match MAJOR.MINOR.PATCH`);
    } else if (version !== expectedVersion) {
      errors.push(`${label} version ${version} does not match package version ${expectedVersion}`);
    }
  }

  if (sources.tagName !== undefined) {
    const tagMatch = /^v(\d+\.\d+\.\d+)$/.exec(sources.tagName);
    if (!tagMatch) {
      errors.push(`tag ${sources.tagName} must match vMAJOR.MINOR.PATCH`);
    } else if (tagMatch[1] !== expectedVersion) {
      errors.push(`tag ${sources.tagName} does not match package version ${expectedVersion}`);
    }
  }

  return { expectedVersion, errors, passed: errors.length === 0 };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readManifestVersion(filePath) {
  const manifest = fs.readFileSync(filePath, "utf8");
  const match = /<Identity\b[^>]*\bVersion="([^"]+)"/i.exec(manifest);
  if (!match) {
    throw new Error(`VSIX identity version not found in ${filePath}`);
  }
  return match[1];
}

function parseArguments(args) {
  const mode = args[0];
  if (mode !== "--tag" && mode !== "--no-tag") {
    throw new Error("first argument must be --tag <tag> or --no-tag");
  }

  const tagName = mode === "--tag" ? args[1] : undefined;
  const fileStart = mode === "--tag" ? 2 : 1;
  if (mode === "--tag" && !tagName) {
    throw new Error("--tag requires a tag name");
  }
  if (args.length - fileStart !== 4) {
    throw new Error(
      "expected root package.json, package-lock.json, VSIX package.json, and extension.vsixmanifest",
    );
  }

  return { tagName, files: args.slice(fileStart) };
}

function main() {
  try {
    const { tagName, files } = parseArguments(process.argv.slice(2));
    const [packagePath, lockfilePath, vsixPackagePath, manifestPath] = files;
    const packageJson = readJson(packagePath);
    const lockfile = readJson(lockfilePath);
    const vsixPackageJson = readJson(vsixPackagePath);
    const result = checkVersionCoherence({
      ...(tagName === undefined ? {} : { tagName }),
      packageVersion: packageJson.version,
      lockfileVersion: lockfile.packages?.[""].version,
      vsixPackageVersion: vsixPackageJson.version,
      manifestVersion: readManifestVersion(manifestPath),
    });

    if (!result.passed) {
      console.error("Version coherence FAILED:");
      for (const error of result.errors) console.error(`  - ${error}`);
      process.exit(1);
    }

    console.log(`Version coherence PASSED: ${result.expectedVersion}`);
  } catch (error) {
    console.error(
      `Version coherence FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

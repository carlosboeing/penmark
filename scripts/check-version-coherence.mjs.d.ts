export interface VersionSources {
  tagName?: string;
  packageVersion: string;
  lockfileVersion: string;
  vsixPackageVersion: string;
  manifestVersion: string;
}

export interface VersionCheckResult {
  expectedVersion: string;
  errors: string[];
  passed: boolean;
}

export function checkVersionCoherence(sources: VersionSources): VersionCheckResult;

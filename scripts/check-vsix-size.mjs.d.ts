export interface VsixEntry {
  name: string;
  compressedSize: number;
}

export interface VsixSizeResult {
  coreBytes: number;
  mermaidBytes: number;
  totalBytes: number;
  entries: VsixEntry[];
  passed: boolean;
}

export function checkVsixSize(vsixPath: string): VsixSizeResult;

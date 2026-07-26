export interface IdeTarget {
  name: string;
  command: string;
  fallbacks: string[];
}

export function resolveCli(ide: IdeTarget): string | null;
export function installedVersion(cli: string): string | null;

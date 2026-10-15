/** Profiles come from Syncthing build tags, never from disk case sensitivity. */
export type Platform = 'windows' | 'darwin' | 'ios' | 'linux' | 'android';

export interface CompileContext {
  readonly platform: Platform;
  /** Optional filesystem root; without it, include reader receives relative paths. */
  readonly root?: string;
  /** Follows accessible includes, including symlink aliases. Failures must reject. */
  readonly readInclude?: (path: string) => Promise<string | Uint8Array>;
}

export interface MatchResult {
  readonly ignored: boolean;
  readonly deletable: boolean;
  readonly caseFolded: boolean;
  /** True only for an ignored path whose descendants cannot be allowed. */
  readonly canSkipDir: boolean;
}

export interface Matcher {
  /** Clean relative path in native Unicode normalization (NFC; NFD on Darwin/iOS). */
  match(relativePath: string): MatchResult;
}

export interface Diagnostic {
  readonly source: string;
  /** Distinguishes the main rule list from a real include with the same name. */
  readonly isRoot?: boolean;
  readonly line: number;
  readonly code: 'pattern' | 'escape' | 'include-read' | 'multiple-include' | 'include-syntax' | 'line-too-long';
  readonly reason: string;
}

export interface IncludeDependency {
  readonly path: string;
  /** Digest of the loaded contents; independent of the compiled pattern revision. */
  readonly revision: string;
}

export type CompileResult = {
  readonly ok: true;
  readonly matcher: Matcher;
  readonly revision: string;
  readonly dependencies: readonly IncludeDependency[];
  readonly diagnostics: readonly Diagnostic[];
} | {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
};

/** Internal representation, compiled once and held by the immutable matcher. */
export interface CompiledPattern {
  readonly pattern: string;
  readonly ignored: boolean;
  readonly deletable: boolean;
  readonly caseFolded: boolean;
  readonly allowsSkipping: boolean;
  /** Optional UTF-8 byte string prepared from this exact path by the matcher. */
  readonly test: (path: string, encodedPath?: string) => boolean;
}

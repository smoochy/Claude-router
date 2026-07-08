/**
 * Terminal styling helpers — zero dependencies.
 * Visual language matches Claude Code: warm orange accent, dim secondary
 * text, minimal chrome, ✓/✗/! glyphs. Colors disable automatically when
 * output is not a TTY, NO_COLOR is set, or TERM=dumb (FORCE_COLOR wins).
 */
import type { Tier } from '../types.js';
export declare function stripAnsi(s: string): string;
export declare function supportsColor(stream?: NodeJS.WriteStream): boolean;
export interface Term {
    accent: (s: string) => string;
    red: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
    cyan: (s: string) => string;
    magenta: (s: string) => string;
    dim: (s: string) => string;
    bold: (s: string) => string;
    /** Consistent tier coloring: haiku=cyan, sonnet=yellow, opus=magenta */
    tier: (t: Tier | string) => string;
    ok: () => string;
    fail: () => string;
    warn: () => string;
    /** Red message to stderr */
    errorLine: (msg: string) => void;
    /** Box with width computed from visible (ANSI-stripped) content */
    box: (title: string, rows: Array<[string, string]>) => string;
    readonly enabled: boolean;
}
export declare function createTerm(opts?: {
    forceColor?: boolean;
}): Term;
/** Shared default instance for stdout */
export declare const term: Term;
//# sourceMappingURL=term.d.ts.map
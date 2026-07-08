import type { Provider } from './handler.js';
import type { ModelPricing, RoutingTuning, Tier } from '../types.js';
export interface RouterPaths {
    configDir: string;
    configFile: string;
    daemonStateFile: string;
    logFile: string;
    historyFile: string;
    plistFile: string;
    claudeSettingsFile: string;
    zshrcFile: string;
    bashrcFile: string;
}
export declare function routerPaths(homeDir?: string): RouterPaths;
export declare const PLIST_LABEL = "com.claude-router.proxy";
/** Shape of ~/.claude-router/config.json. Every field optional; CLI flags win. */
export interface FileConfig {
    port?: number;
    /** Bind address (default 127.0.0.1 — use 0.0.0.0 to expose on the network) */
    host?: string;
    verbose?: boolean;
    classifier?: 'heuristic' | 'ai' | 'hybrid';
    provider?: Provider;
    region?: string;
    forceRoute?: boolean;
    /** Override the model ID used for each tier. */
    tiers?: Partial<Record<Tier, string>>;
    /** Override pricing ($/1M tokens) for savings math, keyed by model ID. */
    pricing?: Record<string, ModelPricing>;
    /** Classifier thresholds/band/timeout/cache tuning. */
    routing?: RoutingTuning;
}
export interface LoadedFileConfig {
    config: FileConfig;
    loaded: boolean;
    error?: string;
}
export declare function loadFileConfig(configFile?: string): LoadedFileConfig;
export interface ServeOptions {
    port: number;
    host: string;
    verbose: boolean;
    classifier: 'heuristic' | 'ai' | 'hybrid';
    provider: Provider;
    region: string;
    forceRoute: boolean;
    tiers?: Partial<Record<Tier, string>>;
    pricing?: Record<string, ModelPricing>;
    routing?: RoutingTuning;
}
/** Thrown for user-facing argument errors; the CLI prints it red and exits 1. */
export declare class CliUsageError extends Error {
}
/**
 * Parse start/install flags. File config supplies defaults; flags override.
 * Throws CliUsageError on invalid or unknown flags.
 */
export declare function parseServeArgs(args: string[], file?: FileConfig): ServeOptions;
/** Region flags map onto the provider SDK env vars unless already set. */
export declare function applyRegionEnv(options: Pick<ServeOptions, 'provider' | 'region'>): void;
/** Serve flags to re-create these options in a spawned/registered process. */
export declare function serveArgsFrom(options: ServeOptions): string[];
export declare function getVersion(): string;
/** Closest known command within edit distance 2, or null. */
export declare function suggestCommand(input: string, commands: string[]): string | null;
//# sourceMappingURL=cli-config.d.ts.map
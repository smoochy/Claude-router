import { type RouterPaths } from './cli-config.js';
export type PlatformName = 'windows' | 'macos' | 'linux';
export declare function platformName(): PlatformName;
export interface StepResult {
    ok: boolean;
    /** Human-readable detail — path written, or why the step failed/was skipped */
    detail: string;
    /** Step was intentionally skipped (unsupported/absent tool/conflict) rather than failed */
    skipped?: boolean;
}
export declare function buildPlist(nodePath: string, cliPath: string, serveArgs: string[], logFile: string): string;
/** Command line stored in the HKCU Run key — quotes paths that may contain spaces. */
export declare function buildRunKeyCommand(nodePath: string, cliPath: string, serveArgs: string[]): string;
export declare function buildSystemdUnit(nodePath: string, cliPath: string, serveArgs: string[]): string;
export declare function buildRcBlock(port: number): string;
/** Remove our marker-delimited block, plus the legacy single-marker format. */
export declare function removeRcBlock(content: string): string;
/** Statusline command for ~/.claude/settings.json — node is guaranteed present. */
export declare function buildStatuslineCommand(port: number): string;
/** Matches any statusline command this tool has ever installed. */
export declare function isOurStatusline(command: string): boolean;
export declare function installAutostart(serveArgs: string[], paths?: RouterPaths): StepResult;
export declare function uninstallAutostart(paths?: RouterPaths): StepResult;
export declare function isAutostartRegistered(paths?: RouterPaths): boolean;
/**
 * PID of the proxy if the OS autostart supervisor (launchd / systemd) is
 * currently running it. Lets `install` record the supervised process in the
 * daemon state file instead of starting a redundant daemon that would race it
 * on the port. Returns null when no supervisor owns the process (e.g. Windows,
 * or a manually started daemon).
 */
export declare function supervisorPid(paths?: RouterPaths): number | null;
export declare function unloadLaunchAgent(paths?: RouterPaths): void;
export declare function setEnvVar(port: number, paths?: RouterPaths): StepResult;
export declare function unsetEnvVar(paths?: RouterPaths): StepResult;
export declare function isEnvVarSet(port: number): boolean;
export declare function addStatusline(port: number, paths?: RouterPaths): StepResult;
export declare function removeStatusline(paths?: RouterPaths): StepResult;
export declare function isStatuslineConfigured(paths?: RouterPaths): boolean;
//# sourceMappingURL=platform.d.ts.map
import { type RouterPaths } from './cli-config.js';
export interface DaemonState {
    pid: number;
    port: number;
    startedAt: string;
    args: string[];
}
export declare function readDaemonState(paths?: RouterPaths): DaemonState | null;
export declare function writeDaemonState(state: DaemonState, paths?: RouterPaths): void;
export declare function clearDaemonState(paths?: RouterPaths): void;
export declare function isProcessAlive(pid: number): boolean;
export interface HealthInfo {
    status: string;
    service: string;
    classifier: string;
    provider: string;
    forceRoute: boolean;
    requests: number;
    lastTier: string | null;
    lastModel: string | null;
}
/**
 * Fetch /health and verify it is actually our proxy (not some other service
 * on the port). Uses 127.0.0.1 — localhost can resolve to ::1 on Windows.
 */
export declare function checkHealth(port: number, timeoutMs?: number): Promise<HealthInfo | null>;
export interface StartDaemonResult {
    ok: boolean;
    pid?: number;
    detail: string;
}
/**
 * Spawn the proxy as a detached background process and wait for /health to
 * pass before reporting success — no ✓ until the server is actually up.
 */
export declare function startDaemon(serveArgs: string[], port: number, paths?: RouterPaths): Promise<StartDaemonResult>;
export interface StopDaemonResult {
    ok: boolean;
    detail: string;
}
export declare function stopDaemon(paths?: RouterPaths): Promise<StopDaemonResult>;
//# sourceMappingURL=daemon.d.ts.map
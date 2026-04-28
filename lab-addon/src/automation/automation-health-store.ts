export interface AutomationHealthSnapshot {
    updatedAt: string;
    lastRoute?: string;
    lastDeviceId?: string;
    lastStartHeadless?: unknown;
    lastSuccessfulStartHeadless?: unknown;
    lastControlPlaneSuccessfulStartHeadless?: unknown;
    lastStopHeadless?: unknown;
    lastRecoverHeadless?: unknown;
    lastFailure?: unknown;
    lastNetworkInspection?: unknown;
    activationMode?: 'safe-stub' | 'adb-activation' | 'partial';
}

export class AutomationHealthStore {
    private snapshot: AutomationHealthSnapshot = {
        updatedAt: new Date(0).toISOString()
    };

    getSnapshot(): AutomationHealthSnapshot {
        return { ...this.snapshot };
    }

    patch(update: Partial<AutomationHealthSnapshot>): AutomationHealthSnapshot {
        this.snapshot = {
            ...this.snapshot,
            ...update,
            updatedAt: new Date().toISOString()
        };

        return this.getSnapshot();
    }
}

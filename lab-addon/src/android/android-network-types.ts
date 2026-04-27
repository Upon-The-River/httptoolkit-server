export type AndroidSettingValue = string | null;

export interface AndroidProxySettings {
    globalHttpProxy: AndroidSettingValue;
    globalHttpProxyHost: AndroidSettingValue;
    globalHttpProxyPort: AndroidSettingValue;
    globalHttpProxyExclusionList: AndroidSettingValue;
}

export interface AndroidPrivateDnsSettings {
    mode: AndroidSettingValue;
    specifier: AndroidSettingValue;
}

export interface AndroidVpnEvidence {
    alwaysOnVpnApp: AndroidSettingValue;
    lockdownVpn: AndroidSettingValue;
    vpnSummary: string;
    connectivitySummary: string;
    activeNetworkMentionsVpn: boolean;
}

export interface AndroidNetworkSafetyReport {
    ok: true;
    inspectedAt: string;
    deviceId: string;
    inspectMode: 'read-only';
    proxy: AndroidProxySettings;
    privateDns: AndroidPrivateDnsSettings;
    vpn: AndroidVpnEvidence;
    warnings: string[];
}

export interface AndroidNetworkRescueOptions {
    deviceId?: string;
    dryRun?: boolean;
    clearHttpProxy?: boolean;
    clearPrivateDns?: boolean;
    clearAlwaysOnVpn?: boolean;
    includeAfterInspection?: boolean;
}

export type AndroidNetworkRescueRiskLevel = 'low' | 'medium' | 'high';

export interface AndroidNetworkRescueAction {
    id: string;
    description: string;
    riskLevel: AndroidNetworkRescueRiskLevel;
    command?: string;
    executed: boolean;
    skipped: boolean;
    reason?: string;
    stdout?: string;
}

export interface AndroidNetworkRescueReport {
    ok: boolean;
    implemented: true;
    deviceId?: string;
    dryRun: boolean;
    actions: AndroidNetworkRescueAction[];
    warnings: string[];
    before?: AndroidNetworkSafetyReport;
    after?: AndroidNetworkSafetyReport;
}

export interface AndroidNetworkCapabilities {
    inspect: {
        implemented: true;
        mutatesDeviceState: false;
    };
    rescue: {
        implemented: true;
        mutatesDeviceState: true;
        defaultDryRun: true;
        limitations: string[];
    };
}

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

export interface AndroidNetworkRescueStubResult {
    ok: false;
    implemented: false;
    reason: 'rescue migration pending';
}

export interface AndroidNetworkCapabilities {
    inspect: {
        implemented: true;
        mutatesDeviceState: false;
    };
    rescue: {
        implemented: false;
        mutatesDeviceState: false;
        reason: 'rescue migration pending';
    };
}

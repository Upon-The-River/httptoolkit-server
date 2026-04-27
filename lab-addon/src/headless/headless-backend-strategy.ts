export type HeadlessBackendKind =
    | 'safe-stub'
    | 'local-process'
    | 'external-official-cli'
    | 'core-hook-required';

export interface HeadlessBackendStrategy {
    kind: HeadlessBackendKind;
    name: string;
    implemented: boolean;
    mutatesHostProcessState: boolean;
    mutatesAndroidDeviceState: boolean;
    description: string;
    limitations: string[];
    safetyNotes: string[];
}

export const safeStubStrategy: HeadlessBackendStrategy = {
    kind: 'safe-stub',
    name: 'Safe Stub Backend',
    implemented: true,
    mutatesHostProcessState: false,
    mutatesAndroidDeviceState: false,
    description: 'Conservative no-op backend used by default for headless start/stop/recover during migration.',
    limitations: [
        'Does not start or stop any host process.',
        'Does not mutate Android device state.'
    ],
    safetyNotes: [
        'Prevents recursive endpoint/script invocations.',
        'Safe default when backend configuration is missing.'
    ]
};

export const localProcessStrategy: HeadlessBackendStrategy = {
    kind: 'local-process',
    name: 'Local Addon Process Backend',
    implemented: true,
    mutatesHostProcessState: true,
    mutatesAndroidDeviceState: false,
    description: 'Starts and tracks only addon-started local processes via an in-memory registry.',
    limitations: [
        'Requires LAB_ADDON_HEADLESS_START_COMMAND to be configured.',
        'Only processes recorded by this addon are eligible for stop actions.',
        'Cross-platform process termination remains conservative.'
    ],
    safetyNotes: [
        'Never inspects or claims ownership of arbitrary external processes.',
        'No direct Android mutation in this backend.'
    ]
};

export const externalOfficialCliStrategy: HeadlessBackendStrategy = {
    kind: 'external-official-cli',
    name: 'External Official CLI Backend',
    implemented: false,
    mutatesHostProcessState: true,
    mutatesAndroidDeviceState: true,
    description: 'Future backend that delegates lifecycle control to an official CLI entrypoint.',
    limitations: [
        'Not implemented in this migration slice.',
        'Needs explicit safe non-recursive integration contract.'
    ],
    safetyNotes: [
        'Must avoid addon endpoint recursion.',
        'Should be explicit about device-side mutations.'
    ]
};

export const coreHookRequiredStrategy: HeadlessBackendStrategy = {
    kind: 'core-hook-required',
    name: 'Minimal Core Hook Backend',
    implemented: false,
    mutatesHostProcessState: true,
    mutatesAndroidDeviceState: true,
    description: 'Future option when addon-only orchestration is insufficient and an official core hook is required.',
    limitations: [
        'Requires explicit minimal core patch approval.',
        'Cannot be enabled from addon-only changes.'
    ],
    safetyNotes: [
        'Must follow core patch proposal & approval workflow before implementation.'
    ]
};

export const allHeadlessBackendStrategies: HeadlessBackendStrategy[] = [
    safeStubStrategy,
    localProcessStrategy,
    externalOfficialCliStrategy,
    coreHookRequiredStrategy
];

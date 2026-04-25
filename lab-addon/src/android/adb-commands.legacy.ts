import * as stream from 'stream';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import adb, * as Adb from '@devicefarmer/adbkit';
import { delay, isErrorLike } from '@httptoolkit/util';

import { logError } from '../../error-tracking';
import { waitUntil } from '../../util/promise';
import { getCertificateFingerprint, parseCert } from '../../certificates';
import { streamToBuffer } from '../../util/stream';

export const ANDROID_TEMP = '/data/local/tmp';
export const SYSTEM_CA_PATH = '/system/etc/security/cacerts';

export const EMULATOR_HOST_IPS = [
    '10.0.2.2', // Standard emulator localhost ip
    '10.0.3.2', // Genymotion localhost ip
];

let reportedAdbConnError = false;

export function createAdbClient() {
    const client = adb.createClient({
        port: process.env['ANDROID_ADB_SERVER_PORT']
            ? parseInt(process.env['ANDROID_ADB_SERVER_PORT'], 10)
            : 5037,
        // The path used to start adb, if it isn't already running:
        bin: process.env['ANDROID_HOME']
            ? path.join(process.env['ANDROID_HOME'], 'platform-tools', 'adb')
            : 'adb'
    });

    if (process.platform === 'win32') {
        // If ADB is connected (=if list works) then we try to connect to 58526 automatically
        // (but asychronously) at start up. This is the local debug port for Windows
        // Subsystem for Android:
        // https://learn.microsoft.com/en-us/windows/android/wsa/#connect-to-the-windows-subsystem-for-android-for-debugging

        client.listDevices()
            .then(() => client.connect('127.0.0.1', 58526))
            .then(() => console.log('Connected to WSA via ADB'))
            .catch(() => {}); // Just best-efforts, so we ignore any failures here
    }

    // We listen for errors and report them. This only happens if adbkit completely
    // fails to handle or listen to a connection error. We'd rather report that than crash.
    client.on('error', (e) => {
        // We only report the first error though. Note that most errors will also surface
        // elsewhere, e.g. as a rejection from the relevant promise. This is mostly here
        // for weird connection errors that might appear async elsewhere.
        if (!reportedAdbConnError) {
            reportedAdbConnError = true;
            console.log('ADB connection error:', e.message ?? e);
            logError(e);
        }
    });

    return client;
}

// Batch async calls, so that all calls whilst one call is ongoing return the same result.
// Always uses the arguments from the first call, so this isn't safe for some cases!
const batchCalls = <A extends any[], R>(
    fn: (...args: A) => Promise<R>
) => {
    let ongoingCall: Promise<R> | undefined = undefined;

    return (...args: A) => {
        if (!ongoingCall) {
            ongoingCall = fn(...args)
                .then((result) => {
                    ongoingCall = undefined;
                    return result;
                })
                .catch((error) => {
                    ongoingCall = undefined;
                    throw error;
                });
        }

        return ongoingCall;
    };
}

export const getConnectedDevices = batchCalls(
    async (adbClient: Adb.Client): Promise<Record<string, Record<string, string>>> => {
        try {
            const devices = await (adbClient.listDevices() as Promise<Adb.Device[]>);
            const deviceIds = devices
                .filter((d) =>
                    d.type !== 'offline' &&
                    d.type !== 'unauthorized' &&
                    !d.type.startsWith("no permissions")
                ).map(d => d.id);

            const deviceDetails = Object.fromEntries(await Promise.all(
                deviceIds.map(async (id): Promise<[string, Record<string, string>]> => {
                    const name = await getDeviceName(adbClient, id);
                    return [id, { id, name }];
                })
            ));

            // Clear any non-present device names from the cache
            filterDeviceNameCache(deviceIds);
            return deviceDetails;
        } catch (e) {
            if (isErrorLike(e) && (
                    e.code === 'ENOENT' || // No ADB available
                    e.code === 'EACCES' || // ADB available, but we aren't allowed to run it
                    e.code === 'EPERM' || // Permissions error launching ADB
                    e.code === 'EBADF' || // ADB launch failed do to ulimit, I think?
                    e.code === 'ECONNREFUSED' || // Tried to start ADB, but still couldn't connect
                    e.code === 'ENOTDIR' || // ADB path contains something that's not a directory
                    e.signal === 'SIGKILL' || // In some envs 'adb start-server' is always killed (why?)
                    (e.cmd && e.code)      // ADB available, but "adb start-server" failed
                )
            ) {
                if (e.code !== 'ENOENT') {
                    console.log(`ADB unavailable, ${e.cmd
                        ? `${e.cmd} exited with ${e.code}`
                        : `due to ${e.code}`
                    }`);
                }
                return {};
            } else {
                logError(e);
                throw e;
            }
        }
    }
);


const cachedDeviceNames: { [deviceId: string]: string | undefined } = {};

const getDeviceName = async (adbClient: Adb.Client, deviceId: string) => {
    if (cachedDeviceNames[deviceId]) {
        return cachedDeviceNames[deviceId]!;
    }

    let deviceName: string;
    try {
        const device = adbClient.getDevice(deviceId);

        if (deviceId.startsWith('emulator-')) {
            const props = await device.getProperties();

            const avdName = (
                props['ro.boot.qemu.avd_name'] || // New emulators
                props['ro.kernel.qemu.avd_name']  // Old emulators
            )?.replace(/_/g, ' ');

            const osVersion = props['ro.build.version.release'];

            deviceName = avdName || `Android ${osVersion} emulator`;
        } else {
            const name = (
                await run(device, ['settings', 'get', 'global', 'device_name'])
                    .catch(() => {})
            )?.trim();

            if (name && !name.startsWith('cmd: Failure calling service')) {
                deviceName = name;
            } else {
                const props = await device.getProperties();

                deviceName = props['ro.product.model'] || deviceId;
            }
        }
    } catch (e: any) {
        console.log(`Error getting device name for ${deviceId}`, e.message);
        deviceName = deviceId;
        // N.b. we do cache despite the error - many errors could be persistent, and it's
        // no huge problem (and more consistent) to stick with the raw id instead.
    }

    cachedDeviceNames[deviceId] = deviceName;
    return deviceName;
};

// Clear any non-connected device names from the cache (to avoid leaks, and
// so that we do update the name if they reconnect later.)
const filterDeviceNameCache = (connectedIds: string[]) => {
    Object.keys(cachedDeviceNames).forEach((id) => {
        if (!connectedIds.includes(id)) {
            delete cachedDeviceNames[id];
        }
    });
};

export function stringAsStream(input: string) {
    const contentStream = new stream.Readable();
    contentStream._read = () => {};
    contentStream.push(input);
    contentStream.push(null);
    return contentStream;
}

export async function runAdbShellCommand(
    adbClient: Adb.DeviceClient,
    command: string[],
    options: {
        timeout?: number,
        skipLogging?: boolean
    } = {
        timeout: 10000
    }
): Promise<string> {
    return Promise.race([
        adbClient.shell(command)
            .then(adb.util.readAll)
            .then((buffer: Buffer) => buffer.toString('utf8'))
            .then((result) => {
                if (!options.skipLogging) {
                    console.debug("Android command", command, "returned", `\`${result.trimEnd()}\``);
                }
                return result;
            }),
        ...(options.timeout
            ? [
                delay(options.timeout)
                .then(() => { throw new Error(`Timeout for ADB command ${command}`) })
            ]
            : []
        )
    ]).catch((e) => {
        if (!options.skipLogging) {
            console.debug("Android command", command, "threw", e.message);
        }
        throw e;
    });
}

const run = runAdbShellCommand;

export async function pushFile(
    adbClient: Adb.DeviceClient,
    contents: string | stream.Readable,
    path: string,
    mode?: number
) {
    const transfer = await adbClient.push(contents, path, mode);

    return new Promise((resolve, reject) => {
        transfer.on('end', resolve);
        transfer.on('error', reject);
    });
}

export async function isProbablyRooted(deviceClient: Adb.DeviceClient) {
    let hasSu = await run(deviceClient, ['command', '-v', 'su'], {
            timeout: 500,
            skipLogging: true
        })
        .then((result) => result.includes('/su'))
        .catch(() => false);

    if (hasSu) return true;

    // Check if we're currently running commands as root.
    // Requires the user to have run `adb root` beforehand
    return run(deviceClient, ['id'], {
            timeout: 500,
            skipLogging: true
        })
        .then((result) => result.includes('uid=0(root)'))
        .catch(() => false);
}

const runAsRootCommands = [
    // Maybe we're already root?
    (...cmd: string[]) => [...cmd],
    // Su on many physical rooted devices requires quotes. Adbkit automatically quotes
    // each argument in the array, so we just have to make it a single arg:
    (...cmd: string[]) => ['su', '-c', cmd.join(' ')],
    // But sometimes it doesn't like them, so try that too:
    (...cmd: string[]) => ['su', '-c', ...cmd],
    // 'su' as available on official emulators, no quoting of commands required:
    (...cmd: string[]) => ['su', 'root', ...cmd],
    // 'su' with a single-arg command here too, just in case:
    (...cmd: string[]) => ['su', 'root', cmd.join(' ')]
];

type RootCmd = (...cmd: string[]) => string[];

export async function getRootCommand(adbClient: Adb.DeviceClient): Promise<RootCmd | undefined> {
    const rootTestScriptPath = `${ANDROID_TEMP}/htk-root-test.sh`;

    try {
        // Just running 'id' doesn't fully check certain tricky cases around how the root commands handle
        // multiple arguments etc. N.b. whoami also doesn't exist on older devices. Pushing & running
        // this script is an accurate test of which root mechanisms will actually work on this device:
        let rootTestCommand = ['sh', rootTestScriptPath];
        try {
            await pushFile(adbClient, stringAsStream(`
                set -e # Fail on error
                id # Log the current user details, to confirm if we're root
            `), rootTestScriptPath, 0o444);
        } catch (e) {
            console.log(`Couldn't write root test script to ${rootTestScriptPath}`, e);
            // Ok, so we can't write the test script, but let's still test for root  directly,
            // because maybe if we get root then that won't be a problem
            rootTestCommand = ['id'];
        }

        // Run our root test script with each of the possible root commands
        const rootCheckResults = await Promise.all(
            runAsRootCommands.map(async (runAsRoot) => {
                try {
                    const result = await run(adbClient, runAsRoot(...rootTestCommand), { timeout: 1000 });
                    return { cmd: runAsRoot, result };
                } catch (e) {
                    return {
                        cmd: runAsRoot,
                        result: '',
                        errorMessage: isErrorLike(e) ? e.message : String(e)
                    };
                }
            })
        );

        // Filter to just commands that successfully printed 'uid=0(root)'
        const validRootCommands = rootCheckResults
            .filter((result) => (result.result || '').includes('uid=0(root)'))
            .map((result) => result.cmd);

        if (validRootCommands.length === 0) {
            const failedVariantCount = rootCheckResults.filter((result) => result.errorMessage).length;
            if (failedVariantCount > 0) {
                console.log(`Root command probes failed for ${failedVariantCount} variant(s), falling back to adb root`);
            }
        }

        if (validRootCommands.length >= 1) return validRootCommands[0];

        // If no explicit root commands are available, try to restart adb in root
        // mode instead. If this works, *all* commands will run as root.
        // We prefer explicit "su" calls if possible, to limit access & side effects.
        await adbClient.root().catch((e: any) => {
            if (isErrorLike(e) && e.message?.includes("adbd is already running as root")) return;
            else console.log(e.message ?? e);
        });

        // Sometimes switching to root can disconnect ADB devices, so double-check
        // they're still here, and wait a few seconds for them to come back if not.

        await delay(500); // Wait, since they may not disconnect immediately
        const idResult = await waitUntil(250, 10, (): Promise<string | false> => {
            return run(adbClient, rootTestCommand, { timeout: 1000 }).catch(() => false)
        }).catch(console.log);

        return (idResult || '').includes('uid=0(root)')
            ? (...cmd: string[]) => cmd // All commands now run as root
            : undefined; // Still not root, no luck.
    } catch (e) {
        console.error(e);
        logError('ADB root check crashed');
        return undefined;
    } finally {
        // Try to clean up the root test script, just to be tidy
        run(adbClient, ['rm', '-f', rootTestScriptPath]).catch(() => {});
    }
}

export async function hasCertInstalled(
    adbClient: Adb.DeviceClient,
    certHash: string,
    expectedFingerprint: string
) {
    // We have to check both of these paths. If /system exists but /apex does not, then something
    // has gone wrong and we need to reinstall the cert to fix it.
    const systemCertPath = `/system/etc/security/cacerts/${certHash}.0`;
    const apexCertPath = `/apex/com.android.conscrypt/cacerts/${certHash}.0`;

    try {
        const existingCertChecks = await Promise.all([
            adbClient.pull(systemCertPath)
                .then(async (certStream) => {
                    if (await isMatchingCert(certStream, expectedFingerprint)) {
                        console.log('Matching /system cacert exists');
                        return true;
                    } else {
                        console.log('/system cacert exists but mismatched');
                        return false;
                    }
                }),

            run(adbClient, ['ls', '/apex/com.android.conscrypt'])
                .then(async (lsOutput) => {
                    if (lsOutput.includes('cacerts')) {
                        const certStream = await adbClient.pull(apexCertPath);
                        if (await isMatchingCert(certStream, expectedFingerprint)) {
                            console.log('Matching /apex cacert exists');
                            return true;
                        } else {
                            console.log('/apex cacert exists but mismatched');
                            return false;
                        }
                    } else {
                        console.log('No need for /apex cacerts injection');
                        // If apex dir doesn't exist, we don't need to inject anything
                        return true;
                    }
                })
        ]);

        return existingCertChecks.every(result => result === true);
    } catch (e: any) {
        // Couldn't read the cert, or some other error - either way, we probably
        // don't have a working system cert installed.
        console.log(`Couldn't detect cert via ADB: ${e.message}`);
        return false;
    }
}

// The device already has an HTTP Toolkit cert. But is it the right one?
const isMatchingCert = async (certStream: stream.Readable, expectedFingerprint: string) => {
    // Wait until it's clear that the read is successful
    const data = await streamToBuffer(certStream);

    // Note that due to https://github.com/DeviceFarmer/adbkit/issues/464 we may see
    // 'empty' data for files that are actually missing entirely.
    if (data.byteLength === 0) return false;

    const certData = data.toString('utf8');
    const existingCert = parseCert(certData);
    const existingFingerprint = getCertificateFingerprint(existingCert);
    return expectedFingerprint === existingFingerprint;
}

export async function injectSystemCertificate(
    adbClient: Adb.DeviceClient,
    runAsRoot: RootCmd,
    certificatePath: string
) {
    const injectionScriptPath = `${ANDROID_TEMP}/htk-inject-system-cert.sh`;

    // We have a challenge here. How do we add a new cert to /system/etc/security/cacerts,
    // when that's generally read-only & often hard to remount (emulators require startup
    // args to allow RW system files). Solution: mount a virtual temporary FS on top of it.
    await pushFile(
        adbClient,
        stringAsStream(`
            set -e # Fail on error

            echo "\n---\nInjecting certificate:"

            # Create a separate temp directory, to hold the current certificates
            # Without this, when we add the mount we can't read the current certs anymore.
            mkdir -p /data/local/tmp/htk-ca-copy
            chmod 700 /data/local/tmp/htk-ca-copy
            rm -rf /data/local/tmp/htk-ca-copy/*

            # Copy out the existing certificates
            if [ -d "/apex/com.android.conscrypt/cacerts" ]; then
                cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/htk-ca-copy/
            else
                cp /system/etc/security/cacerts/* /data/local/tmp/htk-ca-copy/
            fi

            # Create the in-memory mount on top of the system certs folder
            mount -t tmpfs tmpfs /system/etc/security/cacerts

            # Copy the existing certs back into the tmpfs mount, so we keep trusting them
            mv /data/local/tmp/htk-ca-copy/* /system/etc/security/cacerts/

            # Copy our new cert in, so we trust that too
            mv ${certificatePath} /system/etc/security/cacerts/

            # Update the perms & selinux context labels, so everything is as readable as before
            chown root:root /system/etc/security/cacerts/*
            chmod 644 /system/etc/security/cacerts/*

            chcon u:object_r:system_file:s0 /system/etc/security/cacerts/
            chcon u:object_r:system_file:s0 /system/etc/security/cacerts/*

            echo 'System cacerts setup completed'

            # Deal with the APEX overrides in Android 14+, which need injecting into each namespace:
            if [ -d "/apex/com.android.conscrypt/cacerts" ]; then
                echo 'Injecting certificates into APEX cacerts'

                # When the APEX manages cacerts, we need to mount them at that path too. We can't do
                # this globally as APEX mounts are namespaced per process, so we need to inject a
                # bind mount for this directory into every mount namespace.

                # First we mount for the shell itself, for completeness and so we can see this
                # when we check for correct installation on later runs
                mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts

                # First we get the Zygote process(es), which launch each app
                ZYGOTE_PID=$(pidof zygote || true)
                ZYGOTE64_PID=$(pidof zygote64 || true)
                Z_PIDS="$ZYGOTE_PID $ZYGOTE64_PID"
                # N.b. some devices appear to have both, some have >1 of each (!)

                # Apps inherit the Zygote's mounts at startup, so we inject here to ensure all newly
                # started apps will see these certs straight away:
                for Z_PID in $Z_PIDS; do
                    if [ -n "$Z_PID" ]; then
                        nsenter --mount=/proc/$Z_PID/ns/mnt -- \
                            /bin/mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts
                    fi
                done

                echo 'Zygote APEX certificates remounted'

                # Then we inject the mount into all already running apps, so they see these certs immediately.

                # Get the PID of every process whose parent is one of the Zygotes:
                APP_PIDS=$(
                    echo $Z_PIDS | \
                    xargs -n1 ps -o 'PID' -P | \
                    grep -v PID
                )

                # Inject into the mount namespace of each of those apps:
                for PID in $APP_PIDS; do
                    nsenter --mount=/proc/$PID/ns/mnt -- \
                        /bin/mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts &
                done
                wait # Launched in parallel - wait for completion here

                echo "APEX certificates remounted for $(echo $APP_PIDS | wc -w) apps"
            fi

            # Delete the temp cert directory & this script itself
            rm -r /data/local/tmp/htk-ca-copy
            rm ${injectionScriptPath}

            echo "System cert successfully injected\n---\n"
        `),
        injectionScriptPath,
        // Due to an Android bug, user mode is always duplicated to group & others. We set as read-only
        // to avoid making this writable by others before we run it as root in a moment.
        // More details: https://github.com/openstf/adbkit/issues/126
        0o444
    );

    // Actually run the script that we just pushed above, as root
    const scriptOutput = await run(adbClient, runAsRoot('sh', injectionScriptPath));

    if (!scriptOutput.includes("System cert successfully injected")) {
        throw new Error('System certificate injection failed');
    }
}

export async function setChromeFlags(
    adbClient: Adb.DeviceClient,
    runAsRoot: RootCmd,
    flags: string[]
) {
    const flagsFileContent = `chrome ${flags.join(' ')}`;

    const chromeFlagsLocations = [
        'chrome',
        'android-webview',
        'webview',
        'content-shell'
    ].flatMap((variant) => [
        `/data/local/${variant}-command-line`,
        `/data/local/tmp/${variant}-command-line`,
    ]);

    const chromeFlagsScriptPath = `${ANDROID_TEMP}/htk-set-chrome-flags.sh`;

    await pushFile(
        adbClient,
        stringAsStream(`
            set -e # Fail on error

            ${
                chromeFlagsLocations.map((flagsFilePath) => `
            echo "${flagsFileContent}" > "${flagsFilePath}"
            chmod 744 "${flagsFilePath}"
            chcon "u:object_r:shell_data_file:s0" "${flagsFilePath}"`
                ).join('\n')
            }

            rm ${chromeFlagsScriptPath}

            echo "Chrome flags script completed"
        `),
        chromeFlagsScriptPath,
        // Due to an Android bug, user mode is always duplicated to group & others. We set as read-only
        // to avoid making this writable by others before we run it as root in a moment.
        // More details: https://github.com/openstf/adbkit/issues/126
        0o444
    );

    // Actually run the script that we just pushed above, as root
    const scriptOutput = await run(adbClient, runAsRoot('sh', chromeFlagsScriptPath));
    console.log(scriptOutput);

    // Try to restart chrome, now that the flags have probably been changed:
    await run(adbClient, runAsRoot('am', 'force-stop', 'com.android.chrome')).catch(() => {});
}

export async function bringToFront(
    adbClient: Adb.DeviceClient,
    activityName: string // Of the form: com.package/com.package.YourActivity
) {
    // Wake the device up, so it's at least obviously locked if locked.
    // It's not possible to unlock the device over ADB. Does nothing if already awake.
    await run(adbClient, [
        "input", "keyevent", "KEYCODE_WAKEUP"
    ], { skipLogging: true });

    await delay(10);

    // Bring the activity to the front, so we can interact with it (this will
    // silently fail if the device is locked, but we're ok with that).
    await run(adbClient, [
        "am", "start", "--activity-single-top", activityName
    ], { skipLogging: true });
}

function parseResolvedActivity(result: string, packageName: string): string | undefined {
    const lines = result
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const candidate = lines.find((line) => line.includes('/')) || '';
    if (!candidate) return;

    const normalizedCandidate = candidate.startsWith(packageName + '/')
        ? candidate
        : candidate.includes('/')
            ? `${packageName}/${candidate.split('/')[1]}`
            : '';

    if (!normalizedCandidate.startsWith(packageName + '/')) return;

    const activityName = normalizedCandidate.split('/')[1];
    if (!activityName || activityName === 'No') return;

    return normalizedCandidate;
}

export async function resolveLauncherActivity(
    adbClient: Adb.DeviceClient,
    packageName: string
): Promise<string | undefined> {
    const resolvers = [
        ['cmd', 'package', 'resolve-activity', '--brief', packageName],
        ['pm', 'resolve-activity', '--brief', packageName],
    ];

    for (const command of resolvers) {
        const result = await run(adbClient, command, { skipLogging: true }).catch(() => undefined);
        if (!result) continue;

        const parsedActivity = parseResolvedActivity(result, packageName);
        if (parsedActivity) return parsedActivity;
    }

    return undefined;
}

export async function bringPackageToFront(
    adbClient: Adb.DeviceClient,
    packageName: string
): Promise<void> {
    const launcherActivity = await resolveLauncherActivity(adbClient, packageName);

    if (launcherActivity) {
        await bringToFront(adbClient, launcherActivity);
        return;
    }

    await run(adbClient, ['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
}

export async function startActivity(
    adbClient: Adb.DeviceClient,
    options: {
        action?: string,
        data?: string,
        retries?: number
    }
): Promise<void> {
    const retries = options.retries ?? 0;

    try {
        await adbClient.startActivity({
            wait: true,
            action: options.action,
            data: options.data
        });
    } catch (e) {
        if (retries <= 0) throw e;
        else {
            await delay(1000);

            return startActivity(adbClient, {
                ...options,
                retries: retries - 1
            });
        }
    }
}

export async function resetAndroidStateLogBuffer(adbClient: Adb.DeviceClient): Promise<void> {
    await run(adbClient, ['logcat', '-c'], {
        timeout: 5000,
        skipLogging: true
    }).catch(() => {});
}

const DEFAULT_ANDROID_ACTIVATION_TIMEOUT = 15000;
const DEFAULT_ANDROID_ACTIVATION_POLL_INTERVAL = 1000;
const HTTP_TOOLKIT_ANDROID_PACKAGE = 'tech.httptoolkit.android.v1';
const ANDROID_STATE_LOG_TAG = 'HTK-ANDROID-STATE';

type AndroidStateSnapshot = {
    connected: boolean;
    connectionFailed: boolean;
    failureReason?: string;
    states: string[];
    latestState?: string;
    hasActivationStartSignal: boolean;
};

const KNOWN_ANDROID_FAILURE_REASONS = new Set([
    'config-parse-failed',
    'desktop-unreachable',
    'ca-fetch-failed',
    'fingerprint-mismatch',
    'vpn-prepare-required',
    'vpn-start-failed',
    'handshake-timeout',
    'handshake-failed',
    'connected-signal-timeout',
    'vpn-permission-required',
    'connect-failed'
]);

function normalizeAndroidFailureReason(reason?: string): string | undefined {
    if (!reason) return;

    const normalized = reason.toLowerCase().trim();
    if (!normalized) return;
    if (KNOWN_ANDROID_FAILURE_REASONS.has(normalized)) return normalized;

    return normalized;
}

function getConnectedVpnSignal(dumpsysOutput: string, packageName: string): string | undefined {
    const lines = dumpsysOutput
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const packageLineIndexes = lines
        .map((line, index) => line.toLowerCase().includes(packageName.toLowerCase()) ? index : -1)
        .filter((index) => index >= 0);

    if (packageLineIndexes.length === 0) return;

    const packageScopedSnippet = packageLineIndexes
        .flatMap((index) => lines.slice(Math.max(0, index - 2), index + 3))
        .join('\n')
        .toLowerCase();

    const hasExplicitVpnOwnership = (
        /\bactive vpn\b/.test(packageScopedSnippet) ||
        /\balways-on vpn\b/.test(packageScopedSnippet) ||
        /\bvpn\b.{0,60}\bowner\b/.test(packageScopedSnippet) ||
        /\bowner\b.{0,60}\bvpn\b/.test(packageScopedSnippet)
    );
    const hasEstablishedSignal = (
        /\bstate\s*[:=]\s*connected\b/.test(packageScopedSnippet) ||
        /\bstatus\s*[:=]\s*connected\b/.test(packageScopedSnippet) ||
        /\bvpn-(started|established)\b/.test(packageScopedSnippet) ||
        /\binterface\s*[:=]\s*tun\d+\b/.test(packageScopedSnippet) ||
        /\btun\d+\b/.test(packageScopedSnippet)
    );
    const hasDisconnectedSignal = (
        /\bdisconnected\b/.test(packageScopedSnippet) ||
        /\bconnect-failed\b/.test(packageScopedSnippet)
    );

    if (hasExplicitVpnOwnership && hasEstablishedSignal && !hasDisconnectedSignal) {
        return 'vpn-owner';
    }
}

function getConnectedActivitySignal(activityOutput: string, packageName: string): string | undefined {
    const lines = activityOutput
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const packageLineIndexes = lines
        .map((line, index) => line.toLowerCase().includes(packageName.toLowerCase()) ? index : -1)
        .filter((index) => index >= 0);

    if (packageLineIndexes.length === 0) return;

    const packageScopedSnippet = packageLineIndexes
        .flatMap((index) => lines.slice(Math.max(0, index - 1), index + 2))
        .join('\n')
        .toLowerCase();

    const hasExplicitConnectedState = (
        /htk-android-state/.test(packageScopedSnippet) && (
            /\bstate\s*[:=]\s*connected\b/.test(packageScopedSnippet) ||
            /\bvpn-(established|started)\b/.test(packageScopedSnippet) ||
            /\bremote-control-connected\b/.test(packageScopedSnippet)
        )
    );
    const hasDisconnectedSignal = /\bdisconnected\b/.test(packageScopedSnippet);

    if (hasExplicitConnectedState && !hasDisconnectedSignal) {
        return 'app-state';
    }
}

function parseAndroidStateLogcat(logcatOutput: string): AndroidStateSnapshot | undefined {
    const relevantLines = logcatOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().includes(ANDROID_STATE_LOG_TAG.toLowerCase()));
    if (relevantLines.length === 0) return;

    const normalizedLines = relevantLines.map((line) => line.toLowerCase());
    const stateTokens = normalizedLines.map((line) => {
        const stateValue = line.match(/\bstate\s*[:=]\s*([a-z0-9._-]+)/)?.[1];
        if (stateValue) return stateValue;

        const connectFailedReason = line.match(/\bconnect[-_ ]failed(?:[:=]\s*|\s+reason[:=]\s*)([a-z0-9._-]+)/)?.[1];
        if (connectFailedReason) return `connect-failed:${connectFailedReason}`;

        const afterTag = line.match(/htk-android-state[^:]*:\s*([a-z0-9._:-]+)/)?.[1];
        if (afterTag) return afterTag;

        return undefined;
    }).filter((state): state is string => Boolean(state));
    const latestLine = normalizedLines[normalizedLines.length - 1];
    const hasActivationStartSignal = stateTokens.some((token) =>
        token === 'activate_received' || token === 'state=activate_received'
    ) || normalizedLines.some((line) => /\bactivate_received\b/.test(line));

    const failureLine = normalizedLines
        .slice()
        .reverse()
        .find((line) => /\bconnect[-_ ]failed\b/.test(line));
    const desktopReachabilityFailureLine = normalizedLines
        .slice()
        .reverse()
        .find((line) => /\bdesktop[-_ ]reachable\b/.test(line) && /\b(false|failed|no)\b/.test(line));
    const connectionFailed = Boolean(failureLine) ||
        Boolean(desktopReachabilityFailureLine) ||
        normalizedLines.some((line) => /\bvpn[-_ ]permission[-_ ]required\b/.test(line));

    const connected = normalizedLines.some((line) => (
        /\bconnected\b/.test(line) ||
        /\bstate\s*[:=]\s*connected\b/.test(line) ||
        /\bvpn-(started|established)\b/.test(line) ||
        /\bdesktop-handshake-ok\b/.test(line)
    )) && !connectionFailed;

    const reasonFromConnectFailed = failureLine?.match(/\bconnect[-_ ]failed(?:[:=]\s*|\s+reason[:=]\s*)([a-z0-9._-]+)/)?.[1];
    const reasonFromDesktopReachability = desktopReachabilityFailureLine?.match(/\breason\s*[:=]\s*([a-z0-9._-]+)/)?.[1]
        ?? (desktopReachabilityFailureLine ? 'desktop-unreachable' : undefined);
    const reasonFromLastErrorReason = normalizedLines
        .slice()
        .reverse()
        .map((line) => line.match(/\blasterrorreason\s*[:=]\s*([a-z0-9._-]+)/)?.[1])
        .find(Boolean);

    const failureReason = normalizeAndroidFailureReason(
        reasonFromConnectFailed || reasonFromLastErrorReason || reasonFromDesktopReachability
    );

    return {
        connected,
        connectionFailed,
        failureReason,
        states: stateTokens,
        latestState: latestLine,
        hasActivationStartSignal
    };
}

function getConnectedLogcatSignal(
    logcatOutput: string,
    options: {
        requireActivationStartSignal?: boolean
    } = {}
): string | undefined {
    const state = parseAndroidStateLogcat(logcatOutput);
    if (
        state?.connected &&
        (!options.requireActivationStartSignal || state.hasActivationStartSignal)
    ) {
        return 'app-log';
    }
}

function parseAndroidStateFromActivityDump(activityOutput: string): AndroidStateSnapshot | undefined {
    const normalizedOutput = activityOutput.toLowerCase();
    if (!normalizedOutput.includes(ANDROID_STATE_LOG_TAG.toLowerCase())) return;

    return parseAndroidStateLogcat(activityOutput);
}

function getConnectivityDiagnostics(connectivityOutput: string, packageName: string): string[] {
    const diagnostics: string[] = [];
    const normalizedOutput = connectivityOutput.toLowerCase();

    if (!normalizedOutput.trim()) return diagnostics;

    if (/can'?t find service:\s*connectivity/.test(normalizedOutput)) {
        diagnostics.push('connectivity-service-unavailable');
        return diagnostics;
    }

    if (/\bactive(\s+default)?\s+network\b.{0,80}\bwifi\b/.test(normalizedOutput)) {
        diagnostics.push('active-network-wifi');
    }

    if (/\bnot_vpn\b/.test(normalizedOutput)) {
        diagnostics.push('default-network-not-vpn');
    }

    if (/networkrequest/.test(normalizedOutput) && normalizedOutput.includes(packageName.toLowerCase())) {
        diagnostics.push('app-networkrequest-without-vpn');
    }

    if (/\bconnected\b/.test(normalizedOutput)) {
        diagnostics.push('generic-connected-text-present');
    }

    return diagnostics;
}

async function detectAndroidToolkitConnectedSignal(
    adbClient: Adb.DeviceClient,
    packageName: string,
    options: {
        requireActivationStartSignal?: boolean
    } = {}
): Promise<{ signal?: string, observedStates: string[], explicitFailureReason?: string }> {
    const observedStates: string[] = [];

    const activityDump = await run(adbClient, ['dumpsys', 'activity', 'activities'], {
        skipLogging: true
    }).catch(() => '');

    const activityState = parseAndroidStateFromActivityDump(activityDump);
    const activitySignal = getConnectedActivitySignal(activityDump, packageName);
    if (
        activitySignal &&
        (
            !options.requireActivationStartSignal ||
            activityState?.hasActivationStartSignal
        )
    ) {
        return { signal: activitySignal, observedStates };
    }
    if (activityState?.states.length) {
        observedStates.push(...activityState.states.map((state) => `app-state:${state}`));
    }
    if (activityState?.connected && options.requireActivationStartSignal && !activityState.hasActivationStartSignal) {
        observedStates.push('connected-without-activate-received');
    }
    if (activityState?.connectionFailed) {
        const reason = activityState.failureReason
            ?? (activityState.latestState?.includes('vpn_permission_required')
                ? 'vpn-permission-required'
                : 'connect-failed');
        observedStates.push(`explicit-app-failure:${reason}`);
        return {
            observedStates,
            explicitFailureReason: reason
        };
    }

    if (activityDump.toLowerCase().includes(packageName.toLowerCase())) {
        observedStates.push('app-running-without-explicit-vpn-state');
    }

    const logcatOutput = await run(adbClient, [
        'logcat', '-d', '-t', '200', '-s', `${ANDROID_STATE_LOG_TAG}:*`, 'HttpToolkit:*', 'VpnService:*'
    ], {
        skipLogging: true
    }).catch(() => '');
    const logcatSignal = getConnectedLogcatSignal(logcatOutput, {
        requireActivationStartSignal: options.requireActivationStartSignal
    });
    if (logcatSignal) return { signal: logcatSignal, observedStates };

    const appState = parseAndroidStateLogcat(logcatOutput);
    if (appState?.states.length) {
        observedStates.push(...appState.states.map((state) => `app-state:${state}`));
    }
    if (appState?.connected && options.requireActivationStartSignal && !appState.hasActivationStartSignal) {
        observedStates.push('connected-without-activate-received');
    }
    if (appState?.connectionFailed) {
        const reason = appState.failureReason
            ?? (/\bvpn[-_ ]permission[-_ ]required\b/.test(appState.latestState ?? '')
                ? 'vpn-permission-required'
                : 'connect-failed');
        observedStates.push(`explicit-app-failure:${reason}`);
        return {
            observedStates,
            explicitFailureReason: reason
        };
    } else if (logcatOutput.trim()) {
        observedStates.push('app-logcat-without-connected-state');
    }

    const vpnDump = await run(adbClient, ['dumpsys', 'vpn'], { skipLogging: true })
        .catch(() => '');
    const vpnSignal = getConnectedVpnSignal(vpnDump, packageName);
    if (vpnSignal) {
        observedStates.push('vpn-owner-signal-observed-without-app-state');
    }

    if (/can'?t find service:\s*vpn/i.test(vpnDump)) {
        observedStates.push('vpn-service-unavailable');
    } else if (vpnDump.trim()) {
        observedStates.push('vpn-without-owner-signal');
    }

    const connectivityDump = await run(adbClient, ['dumpsys', 'connectivity'], { skipLogging: true })
        .catch(() => '');
    observedStates.push(...getConnectivityDiagnostics(connectivityDump, packageName));

    return { observedStates };
}

export async function waitForAndroidToolkitConnected(
    adbClient: Adb.DeviceClient,
    options: {
        packageName?: string,
        timeoutMs?: number,
        pollIntervalMs?: number,
        requireActivationStartSignal?: boolean
    } = {}
): Promise<{ connected: boolean, signal?: string, reason?: string }> {
    const packageName = options.packageName ?? HTTP_TOOLKIT_ANDROID_PACKAGE;
    const timeoutMs = options.timeoutMs ?? DEFAULT_ANDROID_ACTIVATION_TIMEOUT;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_ANDROID_ACTIVATION_POLL_INTERVAL;
    const deadline = Date.now() + timeoutMs;
    let latestObservedStates: string[] = [];
    let latestFailureReason: string | undefined;

    do {
        const requireActivationStartSignal = options.requireActivationStartSignal ?? true;
        const result = await detectAndroidToolkitConnectedSignal(adbClient, packageName, {
            requireActivationStartSignal
        });
        latestObservedStates = result.observedStates;
        latestFailureReason = result.explicitFailureReason ?? latestFailureReason;
        if (result.signal) {
            console.log(`Android connected-state source = ${result.signal}`);
            return { connected: true, signal: result.signal };
        }
        if (result.explicitFailureReason) {
            console.log(`Android connected-state source = app-failure (${result.explicitFailureReason})`);
            return {
                connected: false,
                reason: `app_connect_failed:${result.explicitFailureReason}`
            };
        }

        if (Date.now() >= deadline) break;
        await delay(pollIntervalMs);
    } while (Date.now() < deadline);

    console.log('Android connected-state source = none (timeout)');

    return {
        connected: false,
        reason: latestObservedStates.length
            ? `timeout_waiting_for_vpn_connected:${latestObservedStates.join(',')}`
            : `timeout_waiting_for_vpn_connected:${latestFailureReason ?? 'no-explicit-vpn-signal'}`
    };
}

const adbTunnelIds: { [id: string]: NodeJS.Timeout } = {};
const execFileAsync = promisify(execFile);

export interface CommandResult {
    success: boolean;
    command: string[];
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
}

export async function runHostAdbCommand(
    deviceId: string,
    args: string[],
    options: { timeout?: number } = {}
): Promise<CommandResult> {
    const adbPath = process.env['ANDROID_HOME']
        ? path.join(process.env['ANDROID_HOME'], 'platform-tools', 'adb')
        : 'adb';
    const command = ['-s', deviceId, ...args];

    try {
        const result = await execFileAsync(adbPath, command, {
            timeout: options.timeout ?? 10000,
            windowsHide: true,
            maxBuffer: 1024 * 1024
        });

        return {
            success: true,
            command: [adbPath, ...command],
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: 0
        };
    } catch (error) {
        const typedError = isErrorLike(error) ? error : undefined;
        return {
            success: false,
            command: [adbPath, ...command],
            stdout: (typedError as any)?.stdout ?? '',
            stderr: (typedError as any)?.stderr ?? '',
            exitCode: Number((typedError as any)?.code ?? -1),
            error: typedError?.message ?? String(error)
        };
    }
}

type AdbTunnelStatus = 'healthy' | 'failing' | 'disconnected';

export interface AdbTunnelDiagnosticSnapshot {
    id: string;
    deviceId: string;
    localPort: number;
    remotePort: number;
    status: AdbTunnelStatus;
    failures: number;
    lastError?: string;
    lastFailureAt?: number;
    diagnosis?: string;
}

const adbTunnelDiagnostics: { [id: string]: AdbTunnelDiagnosticSnapshot } = {};

export function diagnoseAdbTunnelError(errorMessage: string): string {
    const normalized = errorMessage.toLowerCase();
    if (normalized.includes('device offline')) {
        return 'device_offline:adb_transport_lost';
    }
    if (normalized.includes('device') && normalized.includes('not found')) {
        return 'device_not_found:adb_serial_missing';
    }
    if (normalized.includes('unauthorized')) {
        return 'device_unauthorized:usb_debugging_not_authorized';
    }
    if (normalized.includes('closed') || normalized.includes('eof')) {
        return 'adb_connection_closed:transport_interrupted';
    }
    if (normalized.includes('timeout')) {
        return 'adb_command_timeout:transport_unstable';
    }
    return 'unknown_tunnel_failure';
}

export function getAdbTunnelDiagnostic(
    adbClient: Adb.DeviceClient,
    localPort: number | string,
    remotePort: number | string,
): AdbTunnelDiagnosticSnapshot | undefined {
    const id = `${adbClient.serial}:${localPort}->${remotePort}`;
    const diagnostic = adbTunnelDiagnostics[id];
    if (!diagnostic) return undefined;

    return { ...diagnostic };
}

export function closeReverseTunnel(
    adbClient: Adb.DeviceClient,
    localPort: number | string,
    remotePort: number | string,
) {
    const id = `${adbClient.serial}:${localPort}->${remotePort}`;
    const tunnelInterval = adbTunnelIds[id];
    if (!tunnelInterval) return;

    // This ensures the interval maintaining the tunnel stops:
    clearInterval(tunnelInterval);
    delete adbTunnelIds[id];

    const existingDiagnostic = adbTunnelDiagnostics[id];
    if (existingDiagnostic) {
        adbTunnelDiagnostics[id] = {
            ...existingDiagnostic,
            status: 'disconnected'
        };
    }
}

export interface AndroidCleanupDeviceResult {
    deviceId: string;
    adbState: string;
    cleanupActions: string[];
    vpnActiveBefore: boolean;
    vpnActiveAfter: boolean;
    vpnCleanupSucceeded: boolean;
    reverseCleanupSucceeded: boolean;
    overallSuccess: boolean;
    skippedReason?: string;
    dumpsysVpn: string;
    dumpsysConnectivity: string;
    logcatSample: string;
    errors: string[];
}

export interface AndroidCleanupResult {
    success: boolean;
    overallSuccess: boolean;
    vpnCleanupSucceeded: boolean;
    reverseCleanupSucceeded: boolean;
    aggressive: boolean;
    adbAvailable: boolean;
    adbPath: string;
    adbVersion: string;
    deviceCount: number;
    devices: AndroidCleanupDeviceResult[];
    skippedDevices: Array<{ deviceId: string, reason: string }>;
    errors: string[];
    timestamp: string;
}

export interface AndroidVpnInspectionResult {
    deviceId: string;
    vpnActive: boolean;
    vpnPackage: string | null;
    lastHtkState: string | null;
    vpnStateHint?: string;
    warnings?: string[];
    errors: string[];
    rawSignals?: {
        dumpsysVpn?: string;
        dumpsysConnectivity?: string;
        logcatTail?: string;
    };
}

export async function inspectAndroidVpnState(
    adbClient: Adb.Client,
    deviceId: string
): Promise<AndroidVpnInspectionResult> {
    const deviceClient = adbClient.getDevice(deviceId);
    const errors: string[] = [];
    const warnings: string[] = [];
    const readSignal = async (command: string[], timeout = 7000) => {
        try {
            return await run(deviceClient, command, { timeout, skipLogging: true });
        } catch (error) {
            errors.push(`${command.join(' ')} failed: ${isErrorLike(error) ? error.message ?? String(error) : String(error)}`);
            return '';
        }
    };

    const dumpsysVpn = await readSignal(['dumpsys', 'vpn']);
    const dumpsysConnectivity = await readSignal(['dumpsys', 'connectivity']);
    const logcatTail = await readSignal(['logcat', '-d', '-t', '200', '-s', `${ANDROID_STATE_LOG_TAG}:*`]);
    const combined = `${dumpsysVpn}\n${dumpsysConnectivity}`.toLowerCase();
    const appState = parseAndroidStateLogcat(logcatTail);
    const normalizedLogcat = logcatTail.toLowerCase();

    const htkPackageRegex = /\btech\.httptoolkit\.android\.v1\b/i;
    const activeVpnInDumpsysVpn = [
        /active\s+vpn[\s\S]{0,200}\btech\.httptoolkit\.android\.v1\b/i,
        /current\s+vpn[\s\S]{0,200}\btech\.httptoolkit\.android\.v1\b/i,
        /vpn[\s\S]{0,200}\bstate\s*=\s*connected[\s\S]{0,200}\btech\.httptoolkit\.android\.v1\b/i,
        /\btech\.httptoolkit\.android\.v1\b[\s\S]{0,200}(active|current|connected)/i
    ].some((pattern) => pattern.test(dumpsysVpn));
    const activeVpnInConnectivity = [
        /(active|default)[\s\S]{0,200}(vpn|tun)[\s\S]{0,200}\btech\.httptoolkit\.android\.v1\b/i,
        /networkagentinfo[\s\S]{0,200}(vpn|tun)[\s\S]{0,200}\btech\.httptoolkit\.android\.v1\b/i
    ].some((pattern) => pattern.test(dumpsysConnectivity));
    const hasOnlyNetworkRequestVpnSignal = /networkrequest[\s\S]{0,200}transports:\s*vpn/i.test(dumpsysConnectivity) &&
        !activeVpnInConnectivity;
    const dumpsysShowsHtkVpn = (activeVpnInDumpsysVpn || activeVpnInConnectivity) && htkPackageRegex.test(combined);
    const vpnPackage = dumpsysShowsHtkVpn ? 'tech.httptoolkit.android.v1' : null;
    const latestState = appState?.states.length
        ? appState.states[appState.states.length - 1]
        : null;
    const hasConnectedLogSignal = Boolean(
        appState?.connected ||
        /\bconnected\b/.test(normalizedLogcat) ||
        /\bvpn_started\b/.test(normalizedLogcat) ||
        /\bdesktop_handshake_ok\b/.test(normalizedLogcat)
    );
    const hasStoppedLogSignal = Boolean(
        /\b(disconnected|vpn_stopped|stopped|connect_failed|connect-failed)\b/.test(normalizedLogcat) ||
        appState?.connectionFailed
    );
    const dumpsysHadErrors = errors.some((message) =>
        message.startsWith('dumpsys vpn failed') || message.startsWith('dumpsys connectivity failed')
    );
    const vpnActive = dumpsysShowsHtkVpn;
    let vpnStateHint: string | undefined;

    if (!vpnActive && hasConnectedLogSignal) {
        if (dumpsysHadErrors) {
            vpnStateHint = 'diagnostic-incomplete';
            warnings.push('CONNECTED logcat signal ignored because dumpsys VPN diagnostics failed');
        } else {
            vpnStateHint = 'stale-log-connected';
            warnings.push('CONNECTED logcat signal ignored because dumpsys shows no active HTTP Toolkit VPN');
        }
    } else if (!vpnActive && hasStoppedLogSignal) {
        vpnStateHint = 'stopped';
    } else if (!vpnActive && hasOnlyNetworkRequestVpnSignal) {
        vpnStateHint = 'network-request-only';
    }

    return {
        deviceId,
        vpnActive,
        vpnPackage,
        lastHtkState: latestState,
        vpnStateHint,
        warnings,
        errors,
        rawSignals: {
            dumpsysVpn: dumpsysVpn.slice(-2000),
            dumpsysConnectivity: dumpsysConnectivity.slice(-2000),
            logcatTail: logcatTail.slice(-2000)
        }
    };
}

export async function runStatelessAndroidCleanup(
    options: {
        aggressive?: boolean,
        includeDiagnostics?: boolean,
        adbClient?: Adb.Client,
        runHostAdb?: typeof runHostAdbCommand
    } = {}
): Promise<AndroidCleanupResult> {
    const aggressive = options.aggressive ?? false;
    const includeDiagnostics = options.includeDiagnostics ?? true;
    const adbClient = options.adbClient ?? createAdbClient();
    const errors: string[] = [];

    let devices: Adb.Device[] = [];
    try {
        devices = await adbClient.listDevices() as Adb.Device[];
    } catch (error) {
        const message = isErrorLike(error) ? error.message ?? String(error) : String(error);
        return {
            success: false,
            overallSuccess: false,
            vpnCleanupSucceeded: false,
            reverseCleanupSucceeded: false,
            aggressive,
            adbAvailable: false,
            adbPath: process.env['ANDROID_HOME']
                ? path.join(process.env['ANDROID_HOME'], 'platform-tools', 'adb')
                : 'adb',
            adbVersion: 'unknown',
            deviceCount: 0,
            devices: [],
            skippedDevices: [],
            errors: [`Failed to list adb devices: ${message}`],
            timestamp: new Date().toISOString()
        };
    }

    const adbPath = process.env['ANDROID_HOME']
        ? path.join(process.env['ANDROID_HOME'], 'platform-tools', 'adb')
        : 'adb';

    const skippedDevices: Array<{ deviceId: string, reason: string }> = [];
    const results = await Promise.all(devices.map(async (device) => {
        if (device.type !== 'device') {
            skippedDevices.push({
                deviceId: device.id,
                reason: device.type
            });
            const skippedResult: AndroidCleanupDeviceResult = {
                deviceId: device.id,
                adbState: device.type,
                cleanupActions: [],
                vpnActiveBefore: false,
                vpnActiveAfter: false,
                vpnCleanupSucceeded: true,
                reverseCleanupSucceeded: true,
                overallSuccess: true,
                skippedReason: device.type,
                dumpsysVpn: '',
                dumpsysConnectivity: '',
                logcatSample: '',
                errors: []
            };
            return skippedResult;
        }

        const deviceClient = adbClient.getDevice(device.id);
        const deviceErrors: string[] = [];
        const cleanupActions: string[] = [];

        const safeRun = async (command: string[], actionName: string, timeout = 10000) => {
            try {
                const output = await run(deviceClient, command, { timeout, skipLogging: true });
                cleanupActions.push(actionName);
                return output;
            } catch (error) {
                const message = isErrorLike(error) ? error.message ?? String(error) : String(error);
                deviceErrors.push(`${actionName} failed: ${message}`);
                return '';
            }
        };

        const initialInspection = await inspectAndroidVpnState(adbClient, device.id);
        const vpnActiveBefore = initialInspection.vpnActive;
        if (initialInspection.errors.length) {
            deviceErrors.push(...initialInspection.errors.map((error) => `inspect-vpn-before failed: ${error}`));
        }

        await safeRun(
            ['am', 'start', '-a', 'tech.httptoolkit.android.DEACTIVATE', '-p', 'tech.httptoolkit.android.v1'],
            'deactivate-intent'
        );
        await safeRun(
            ['am', 'force-stop', 'tech.httptoolkit.android.v1'],
            'force-stop'
        );
        const vpnCleanupSucceeded =
            cleanupActions.includes('deactivate-intent') &&
            cleanupActions.includes('force-stop');
        if (aggressive) {
            await safeRun(
                ['pm', 'clear', 'tech.httptoolkit.android.v1'],
                'pm-clear'
            );
        }

        const reverseResult = await (options.runHostAdb ?? runHostAdbCommand)(device.id, ['reverse', '--remove-all'], {
            timeout: 10000
        });
        const reverseCleanupSucceeded = reverseResult.success;
        if (reverseCleanupSucceeded) {
            cleanupActions.push('remove-reverse-tunnels');
        } else {
            deviceErrors.push(`remove-reverse-tunnels failed: ${reverseResult.error ?? reverseResult.stderr ?? 'unknown error'}`);
        }

        const dumpsysVpn = includeDiagnostics
            ? await safeRun(['dumpsys', 'vpn'], 'read-dumpsys-vpn', 5000)
            : '';
        const dumpsysConnectivity = includeDiagnostics
            ? await safeRun(['dumpsys', 'connectivity'], 'read-dumpsys-connectivity', 5000)
            : '';
        const logcatSample = includeDiagnostics
            ? await safeRun(
                ['logcat', '-d', '-t', '120', '-s', 'HTTP Toolkit Android:*', 'VpnService:*', 'ActivityManager:*'],
                'read-logcat',
                5000
            )
            : '';

        const finalInspection = await inspectAndroidVpnState(adbClient, device.id);
        const vpnActiveAfter = finalInspection.vpnActive;
        if (finalInspection.errors.length) {
            deviceErrors.push(...finalInspection.errors.map((error) => `inspect-vpn-after failed: ${error}`));
        }
        const overallSuccess = vpnCleanupSucceeded && reverseCleanupSucceeded && !vpnActiveAfter && deviceErrors.length === 0;

        const result: AndroidCleanupDeviceResult = {
            deviceId: device.id,
            adbState: device.type,
            cleanupActions,
            vpnActiveBefore,
            vpnActiveAfter,
            vpnCleanupSucceeded,
            reverseCleanupSucceeded,
            overallSuccess,
            dumpsysVpn: dumpsysVpn.slice(0, 4000),
            dumpsysConnectivity: dumpsysConnectivity.slice(0, 4000),
            logcatSample: logcatSample.slice(0, 4000),
            errors: deviceErrors
        };
        return result;
    }));

    const stillActive = results.filter((r) => r.vpnActiveAfter).map((r) => r.deviceId);
    if (stillActive.length) {
        errors.push(`VPN appears active after cleanup on devices: ${stillActive.join(', ')}`);
    }

    const vpnCleanupSucceeded = results.every((r) => r.vpnCleanupSucceeded);
    const reverseCleanupSucceeded = results.every((r) => r.reverseCleanupSucceeded);
    const overallSuccess = errors.length === 0 && results.every((r) => r.overallSuccess);

    return {
        success: overallSuccess,
        overallSuccess,
        vpnCleanupSucceeded,
        reverseCleanupSucceeded,
        aggressive,
        adbAvailable: true,
        adbPath,
        adbVersion: 'unknown',
        deviceCount: results.length,
        devices: results,
        skippedDevices,
        errors,
        timestamp: new Date().toISOString()
    };
}

export async function runFastAndroidCleanup(
    options: {
        aggressive?: boolean,
        adbClient?: Adb.Client,
        runHostAdb?: typeof runHostAdbCommand
    } = {}
): Promise<AndroidCleanupResult> {
    return runStatelessAndroidCleanup({
        ...options,
        includeDiagnostics: false
    });
}

export async function inspectAllAndroidVpnStates(
    adbClient: Adb.Client = createAdbClient()
): Promise<{
    success: boolean,
    adbAvailable: boolean,
    deviceCount: number,
    inspectedDevices: AndroidVpnInspectionResult[],
    skippedDevices: Array<{ deviceId: string, reason: string }>,
    errors: string[],
    timestamp: string
}> {
    const skippedDevices: Array<{ deviceId: string, reason: string }> = [];
    try {
        const devices = await adbClient.listDevices() as Adb.Device[];
        const inspectableDevices = devices.filter((device) => {
            if (device.type !== 'device') {
                skippedDevices.push({ deviceId: device.id, reason: device.type });
                return false;
            }
            return true;
        });

        const inspectedDevices = await Promise.all(
            inspectableDevices.map((device) => inspectAndroidVpnState(adbClient, device.id))
        );
        const errors = inspectedDevices.flatMap((device) => device.errors);

        return {
            success: errors.length === 0,
            adbAvailable: true,
            deviceCount: inspectableDevices.length,
            inspectedDevices,
            skippedDevices,
            errors,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const message = isErrorLike(error) ? error.message ?? String(error) : String(error);
        return {
            success: false,
            adbAvailable: false,
            deviceCount: 0,
            inspectedDevices: [],
            skippedDevices,
            errors: [`Failed to inspect adb devices: ${message}`],
            timestamp: new Date().toISOString()
        };
    }
}

export async function createPersistentReverseTunnel(
    adbClient: Adb.DeviceClient,
    localPort: number,
    remotePort: number,
    options: {
        maxFailures: number,
        delay: number
    } = { maxFailures: 5, delay: 2000 } // 10 seconds total
) {
    const id = `${adbClient.serial}:${localPort}->${remotePort}`;

    adbTunnelDiagnostics[id] = {
        id,
        deviceId: adbClient.serial,
        localPort,
        remotePort,
        status: 'healthy',
        failures: 0
    };

    await adbClient.reverse('tcp:' + localPort, 'tcp:' + remotePort);

    // This tunnel can break in quite a few days, notably when connecting/disconnecting
    // from the VPN app with a wifi connection, or when ADB is restarted, when using flaky
    // cables, or switching ADB into root mode, etc etc. This is a problem!

    // To handle this, we constantly reinforce the tunnel while HTTP Toolkit is running &
    // the device is connected, until it actually persistently fails.

    // If tunnel is already being maintained elsewhere, no need to repeat (although we
    // do re-create it above, just in case there's any flakiness at this exact moment)
    if (adbTunnelIds[id]) return;

    let tunnelConnectFailures = 0;

    const tunnelCheckInterval = adbTunnelIds[id] = setInterval(async () => {
        if (adbTunnelIds[id] !== tunnelCheckInterval) {
            clearInterval(tunnelCheckInterval);
            return;
        }

        try {
            // Repeated calls to do this do nothing if the tunnel is already in place
            await adbClient.reverse('tcp:' + localPort, 'tcp:' + remotePort);
            tunnelConnectFailures = 0;
            adbTunnelDiagnostics[id] = {
                ...adbTunnelDiagnostics[id],
                status: 'healthy',
                failures: 0
            };
        } catch (e) {
            tunnelConnectFailures += 1;
            const errorMessage = isErrorLike(e) ? (e.message ?? String(e)) : String(e);
            const diagnosis = diagnoseAdbTunnelError(errorMessage);
            console.log(`${id} ADB tunnel failed`, errorMessage);
            console.log(`${id} ADB tunnel diagnosis`, diagnosis);

            adbTunnelDiagnostics[id] = {
                ...adbTunnelDiagnostics[id],
                status: 'failing',
                failures: tunnelConnectFailures,
                lastError: errorMessage,
                lastFailureAt: Date.now(),
                diagnosis
            };

            if (tunnelConnectFailures >= options.maxFailures) {
                // After 10 seconds disconnected, give up
                console.warn(`${id} tunnel disconnected`);

                adbTunnelDiagnostics[id] = {
                    ...adbTunnelDiagnostics[id],
                    status: 'disconnected',
                    failures: tunnelConnectFailures,
                    lastError: errorMessage,
                    lastFailureAt: Date.now(),
                    diagnosis
                };

                delete adbTunnelIds[id];
                clearInterval(tunnelCheckInterval);
            }
        }
    }, options.delay);
    tunnelCheckInterval.unref(); // Don't let this block shutdown
}

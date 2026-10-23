// Android overlay, rule R6 (ANDROID-BUILD-RULES.md). Crash reports are OFF until the person turns them on:
// a build without the native plugin does nothing, the choice defaults to off, and the saved choice is what
// reaches the native side at start.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cap = vi.hoisted(() => ({
  native: true,
  pluginPresent: true,
  setEnabled: vi.fn(async (_opts: { enabled: boolean }) => undefined),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native, isPluginAvailable: () => cap.pluginPresent },
  registerPlugin: () => ({ setEnabled: cap.setEnabled }),
}));

import { applyCrashReportsChoice, crashReportsAvailable, crashReportsOn, setCrashReports } from '../crashReporting';

beforeEach(() => {
  const kept: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v; },
    removeItem: (k: string) => { delete kept[k]; }, clear: () => undefined, key: () => null, length: 0,
  });
  cap.native = true; cap.pluginPresent = true; cap.setEnabled.mockReset(); cap.setEnabled.mockResolvedValue(undefined);
});

describe('crash reports (R6)', () => {
  it('is off until the person turns it on', () => {
    expect(crashReportsOn()).toBe(false);
  });

  it('available only in the Android app and only when the plugin is in the build', () => {
    expect(crashReportsAvailable()).toBe(true);
    cap.pluginPresent = false;
    expect(crashReportsAvailable()).toBe(false);
    cap.pluginPresent = true; cap.native = false;
    expect(crashReportsAvailable()).toBe(false);
  });

  it('turning it on tells the native side, then remembers the choice; turning it off reverses both', async () => {
    expect(await setCrashReports(true)).toBe(true);
    expect(cap.setEnabled).toHaveBeenLastCalledWith({ enabled: true });
    expect(crashReportsOn()).toBe(true);
    expect(await setCrashReports(false)).toBe(true);
    expect(cap.setEnabled).toHaveBeenLastCalledWith({ enabled: false });
    expect(crashReportsOn()).toBe(false);
  });

  it('a build without the plugin: nothing is called and nothing is remembered', async () => {
    cap.pluginPresent = false;
    expect(await setCrashReports(true)).toBe(false);
    expect(cap.setEnabled).not.toHaveBeenCalled();
    expect(crashReportsOn()).toBe(false);
  });

  it('if the native call fails the choice is NOT remembered as on', async () => {
    cap.setEnabled.mockRejectedValueOnce(new Error('boom'));
    expect(await setCrashReports(true)).toBe(false);
    expect(crashReportsOn()).toBe(false);
  });

  it('at start the saved choice reaches the native side, and with none saved it is off', async () => {
    await applyCrashReportsChoice();
    expect(cap.setEnabled).toHaveBeenLastCalledWith({ enabled: false });
    await setCrashReports(true);
    await applyCrashReportsChoice();
    expect(cap.setEnabled).toHaveBeenLastCalledWith({ enabled: true });
  });

  it('at start, in a build without the plugin, nothing is called', async () => {
    cap.pluginPresent = false;
    await applyCrashReportsChoice();
    expect(cap.setEnabled).not.toHaveBeenCalled();
  });
});

/**
 * modules/kalam-widget/app.plugin.js: the parts of the iOS widget setup that build text and settings. The Xcode project
 * edit itself (adding the extension target) was never run and is not covered here.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface Plugin {
  (config: Record<string, unknown>, options?: unknown): Record<string, unknown> & { mods?: { ios?: Record<string, unknown> }; extra?: unknown };
  TARGET: string;
  appGroupFor(bundleId: string | undefined, override?: string): string;
  addAppGroup(entitlements: Record<string, unknown>, group: string): Record<string, unknown>;
  extensionInfoPlist(group: string, version?: string): string;
  extensionEntitlements(group: string): string;
  withEasExtension(extra: unknown, bundleId: string, group: string): { eas: { build: { experimental: { ios: { appExtensions: Array<Record<string, unknown>> } } } } } & Record<string, unknown>;
  extensionBuildSettings(o: { bundleId: string; team?: string; version?: string }): Record<string, string>;
}
const plugin = createRequire(import.meta.url)('../../../modules/kalam-widget/app.plugin.js') as Plugin;
const KEY = 'com.apple.security.application-groups';

describe('kalam-widget config plugin', () => {
  it('does nothing unless the iOS widget is asked for, so an Android or web build is untouched', () => {
    const config = { name: 'Kalam', ios: { bundleIdentifier: 'com.kalam.app' } };
    expect(plugin(config)).toBe(config);
    expect(plugin(config, {})).toBe(config);
    expect(plugin(config, { ios: false })).toBe(config);
  });

  it('names the App Group after the bundle id, unless one is given', () => {
    expect(plugin.appGroupFor('com.kalam.app')).toBe('group.com.kalam.app');
    expect(plugin.appGroupFor('com.kalam.app', 'group.org.example')).toBe('group.org.example');
    expect(() => plugin.appGroupFor(undefined)).toThrow(/bundleIdentifier/);
  });

  it('adds the group to the entitlements once and keeps the groups already there', () => {
    expect(plugin.addAppGroup({}, 'group.a')[KEY]).toEqual(['group.a']);
    expect(plugin.addAppGroup({ [KEY]: ['group.old'] }, 'group.a')[KEY]).toEqual(['group.old', 'group.a']);
    expect(plugin.addAppGroup({ [KEY]: ['group.a'] }, 'group.a')[KEY]).toEqual(['group.a']);
    expect(plugin.addAppGroup({ other: 1 }, 'group.a').other).toBe(1);
  });

  it('writes an extension Info.plist that is a widget extension and carries the group', () => {
    const plist = plugin.extensionInfoPlist('group.com.kalam.app', '0.1.0');
    expect(plist).toContain('com.apple.widgetkit-extension');
    expect(plist).toContain('<key>KalamWidgetAppGroup</key><string>group.com.kalam.app</string>');
    expect(plist).toContain('<string>0.1.0</string>');
    expect(plugin.extensionEntitlements('group.com.kalam.app')).toContain('<array><string>group.com.kalam.app</string></array>');
  });

  it('tells EAS Build about the extension, replacing an older entry and leaving everything else', () => {
    const before = { keep: 1, eas: { projectId: 'x', build: { experimental: { ios: { appExtensions: [{ targetName: 'Other' }, { targetName: plugin.TARGET, bundleIdentifier: 'old' }] } } } } };
    const after = plugin.withEasExtension(before, 'com.kalam.app.widget', 'group.com.kalam.app');
    expect(after.keep).toBe(1);
    expect((after.eas as unknown as { projectId: string }).projectId).toBe('x');
    expect(after.eas.build.experimental.ios.appExtensions).toEqual([
      { targetName: 'Other' },
      { targetName: plugin.TARGET, bundleIdentifier: 'com.kalam.app.widget', entitlements: { [KEY]: ['group.com.kalam.app'] } },
    ]);
    expect(plugin.withEasExtension(undefined, 'a.widget', 'group.a').eas.build.experimental.ios.appExtensions).toHaveLength(1);
  });

  it('gives the extension its own bundle id, iOS 17 and the same team as the app when there is one', () => {
    const s = plugin.extensionBuildSettings({ bundleId: 'com.kalam.app.widget', team: 'ABC123', version: '0.1.0' });
    expect(s).toMatchObject({
      PRODUCT_BUNDLE_IDENTIFIER: '"com.kalam.app.widget"', IPHONEOS_DEPLOYMENT_TARGET: '17.0', DEVELOPMENT_TEAM: 'ABC123', SKIP_INSTALL: 'YES',
      CODE_SIGN_ENTITLEMENTS: '"KalamWidget/KalamWidget.entitlements"',
    });
    expect(plugin.extensionBuildSettings({ bundleId: 'x.widget' }).DEVELOPMENT_TEAM).toBeUndefined();
  });

  it('registers the iOS steps when asked for', () => {
    const out = plugin({ name: 'Kalam', ios: { bundleIdentifier: 'com.kalam.app' } }, { ios: true });
    expect(Object.keys(out.mods?.ios ?? {}).sort()).toEqual(['entitlements', 'infoPlist', 'xcodeproj']);
    expect(JSON.stringify(out.extra)).toContain('com.kalam.app.widget');
  });
});

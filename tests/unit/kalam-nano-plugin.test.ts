/** modules/kalam-nano/app.plugin.js: the Gradle properties a plain local or EAS Android build needs. */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Prop = { type: 'property'; key: string; value: string } | { type: 'comment'; value: string };
const { raiseGradleProperties, addProguardRules } = createRequire(import.meta.url)('../../modules/kalam-nano/app.plugin.js') as {
  raiseGradleProperties(props: Prop[]): Prop[];
  addProguardRules(text: string): string;
};
const value = (props: Prop[], key: string) => props.find((p) => p.type === 'property' && p.key === key)?.value;

describe('kalam-nano config plugin', () => {
  it('adds minSdk 26 and Kotlin 2.4.20 when they are not set', () => {
    const props = raiseGradleProperties([{ type: 'comment', value: 'generated' }]);
    expect(value(props, 'android.minSdkVersion')).toBe('26');
    expect(value(props, 'android.kotlinVersion')).toBe('2.4.20');
  });

  it.each([
    ['2.2.0', '2.4.20'], ['2.4.0', '2.4.20'], ['2.4.20', '2.4.20'], ['2.5.0', '2.5.0'], ['3.0', '3.0'], ['latest', '2.4.20'],
  ])('raises android.kotlinVersion %s to %s, and never lowers it', (from, to) => {
    const props = raiseGradleProperties([{ type: 'property', key: 'android.kotlinVersion', value: from }]);
    expect(value(props, 'android.kotlinVersion')).toBe(to);
  });

  it.each([['24', '26'], ['26', '26'], ['35', '35']])('raises android.minSdkVersion %s to %s', (from, to) => {
    const props = raiseGradleProperties([{ type: 'property', key: 'android.minSdkVersion', value: from }]);
    expect(value(props, 'android.minSdkVersion')).toBe(to);
  });

  // The release APK crashed on the Voice tab: R8 dropped kotlin-reflect's ServiceLoader classes (2026-11-26).
  it('keeps the kotlin-reflect classes R8 dropped, and adds the rules only once', () => {
    const once = addProguardRules('# react-native-reanimated\n-keep class com.swmansion.reanimated.** { *; }\n');
    expect(once).toContain('-keep class com.swmansion.reanimated.** { *; }');
    expect(once).toContain('-keep interface kotlin.reflect.jvm.internal.impl.km.internal.extensions.MetadataExtensions');
    expect(once).toContain('-keep class * implements kotlin.reflect.jvm.internal.impl.km.internal.extensions.MetadataExtensions { public protected *; }');
    expect(addProguardRules(once)).toBe(once);
  });
});

/** modules/kalam-nano/app.plugin.js: the Gradle properties a plain local or EAS Android build needs. */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Prop = { type: 'property'; key: string; value: string } | { type: 'comment'; value: string };
const { raiseGradleProperties } = createRequire(import.meta.url)('../../modules/kalam-nano/app.plugin.js') as {
  raiseGradleProperties(props: Prop[]): Prop[];
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
});

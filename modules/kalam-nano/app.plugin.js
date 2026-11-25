// Prebuild step for the kalam-nano module: firebase-ai-ondevice (ML Kit Prompt API) requires Android API 26
// (https://firebase.google.com/docs/ai-logic/hybrid/android/get-started, read 2026-11-18), while Expo SDK 58
// defaults to 24. Expo's Gradle plugin reads `android.minSdkVersion` from gradle.properties.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'android.minSdkVersion';
const MIN_SDK = 26;

module.exports = function withKalamNano(config) {
  return withGradleProperties(config, (cfg) => {
    const current = cfg.modResults.find((p) => p.type === 'property' && p.key === KEY);
    if (!current) cfg.modResults.push({ type: 'property', key: KEY, value: String(MIN_SDK) });
    else if (!(Number(current.value) >= MIN_SDK)) current.value = String(MIN_SDK);
    return cfg;
  });
};

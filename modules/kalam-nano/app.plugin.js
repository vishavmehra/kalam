// Prebuild step for the kalam-nano module. Expo's Gradle setup reads both values from gradle.properties, and a value
// already set higher is kept.
// - android.minSdkVersion 26: firebase-ai-ondevice (ML Kit Prompt API) requires Android API 26
//   (https://firebase.google.com/docs/ai-logic/hybrid/android/get-started, read 2026-11-18); Expo SDK 58 defaults to 24.
// - android.kotlinVersion 2.4.20: firebase-ai-ondevice 16.0.0-beta08 pulls in com.google.mlkit:genai-schema, built with
//   Kotlin 2.4, which React Native 0.88's default Kotlin 2.2 cannot read ("Module was compiled with an incompatible
//   version of Kotlin"). 2.4.20 is the newest version Expo publishes its Kotlin compiler plugins for (found by the
//   mobile smoke CI build, 2026-11-25).
const { withGradleProperties } = require('expo/config-plugins');

const MINIMUMS = { 'android.minSdkVersion': '26', 'android.kotlinVersion': '2.4.20' };

/** True when dotted version `value` is below `min`, or not a version at all. */
function below(value, min) {
  const have = String(value).split('.').map(Number);
  const want = min.split('.').map(Number);
  for (let i = 0; i < want.length; i++) {
    const v = have[i] ?? 0;
    if (!(v >= want[i])) return true;
    if (v > want[i]) return false;
  }
  return false;
}

/** Sets each property in MINIMUMS, or raises it when it is lower. */
function raiseGradleProperties(props) {
  for (const [key, min] of Object.entries(MINIMUMS)) {
    const current = props.find((p) => p.type === 'property' && p.key === key);
    if (!current) props.push({ type: 'property', key, value: min });
    else if (below(current.value, min)) current.value = min;
  }
  return props;
}

module.exports = function withKalamNano(config) {
  return withGradleProperties(config, (cfg) => {
    raiseGradleProperties(cfg.modResults);
    return cfg;
  });
};
module.exports.raiseGradleProperties = raiseGradleProperties;

// Prebuild step for the kalam-nano module. Expo's Gradle setup reads both values from gradle.properties, and a value
// already set higher is kept.
// - android.minSdkVersion 26: firebase-ai-ondevice (ML Kit Prompt API) requires Android API 26
//   (https://firebase.google.com/docs/ai-logic/hybrid/android/get-started, read 2026-11-18); Expo SDK 58 defaults to 24.
// - android.kotlinVersion 2.4.20: firebase-ai-ondevice 16.0.0-beta08 pulls in com.google.mlkit:genai-schema, built with
//   Kotlin 2.4, which React Native 0.88's default Kotlin 2.2 cannot read ("Module was compiled with an incompatible
//   version of Kotlin"). 2.4.20 is the newest version Expo publishes its Kotlin compiler plugins for (found by the
//   mobile smoke CI build, 2026-11-25).
// - R8 keep rules for kotlin-reflect, which Expo modules use to read native arguments. kotlin-reflect 2.4.20 loads three
//   of its own parts with ServiceLoader, and the R8 rules it ships keep none of them, so the minified release build
//   lost them: opening the Voice tab (expo-audio's AudioRecorder) crashed the release APK with "No MetadataExtensions
//   instances found" (demo recording, 2026-11-26). Mobile smoke's 12-voice-tab flow opens that tab on the release build.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');

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

const PROGUARD_MARKER = '# kalam-nano: kotlin-reflect ServiceLoader classes';
const PROGUARD_RULES = [
  PROGUARD_MARKER,
  ...['builtins.BuiltInsLoader', 'resolve.ExternalOverridabilityCondition', 'km.internal.extensions.MetadataExtensions']
    .map((name) => `kotlin.reflect.jvm.internal.impl.${name}`)
    .flatMap((i) => [`-keep interface ${i}`, `-keep class * implements ${i} { public protected *; }`]),
].join('\n');

/** Appends the kotlin-reflect keep rules to proguard-rules.pro text, once. */
function addProguardRules(text) {
  return text.includes(PROGUARD_MARKER) ? text : `${text.trimEnd()}\n\n${PROGUARD_RULES}\n`;
}

module.exports = function withKalamNano(config) {
  config = withGradleProperties(config, (cfg) => {
    raiseGradleProperties(cfg.modResults);
    return cfg;
  });
  return withDangerousMod(config, ['android', (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
    fs.writeFileSync(file, addProguardRules(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''));
    return cfg;
  }]);
};
module.exports.raiseGradleProperties = raiseGradleProperties;
module.exports.addProguardRules = addProguardRules;

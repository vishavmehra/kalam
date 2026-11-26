/**
 * Expo config plugin: native Google Sign-In for Kalam without committing a client id.
 *
 * iOS needs the reversed iOS OAuth client id as a URL scheme. It is built here at prebuild time from
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, which the Expo CLI loads from .env.local (set it as an EAS environment
 * variable for cloud builds). Without it the build still succeeds and the app offers email sign-in on iOS.
 * Android needs nothing here: the ID token is requested for the web client id at run time, and the app's
 * SHA-1 is registered in Firebase. Values are never printed.
 */
// The package only exports `app.plugin.js` (its build folder is not in `exports`); its default is the run-once plugin.
const withGoogleSignIn = require('@react-native-google-signin/google-signin/app.plugin.js').default;

const SUFFIX = '.apps.googleusercontent.com';

module.exports = function withKalamGoogleSignIn(config) {
  const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();
  if (!iosClientId.endsWith(SUFFIX)) {
    console.warn('[kalam] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is not set: iOS builds will not offer Google sign-in.');
    return config;
  }
  const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.slice(0, -SUFFIX.length)}`;
  return withGoogleSignIn(config, { iosUrlScheme });
};

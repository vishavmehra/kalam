/** Reads the three device facts a problem report may hold: app version, platform and system line. */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { DeviceInfo } from './collect-report';
import { describeOs } from './report';

export function readDeviceInfo(): DeviceInfo {
  const os = Platform.OS;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  return {
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    platform: os === 'web' || os === 'android' || os === 'ios' ? os : 'other',
    osVersion: describeOs(os, Platform.Version, userAgent),
  };
}

import { Platform } from 'react-native';

/**
 * react-native-web `dataSet` passthrough → `data-*` attributes used by global-css.web.ts
 * (press scale, hover tint). Returns `{}` on native. Spread into a component's props.
 */
export function webData(data: Record<string, string>): object {
  return Platform.OS === 'web' ? { dataSet: data } : {};
}

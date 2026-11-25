import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';

/** Native: cards animate themselves with Reanimated `entering` (see AppCard). */
export function useCardEntrance(_container: RefObject<ComponentRef<typeof View> | null>, _ready: boolean, _reduced: boolean): void {}

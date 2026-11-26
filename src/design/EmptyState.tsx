import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from './Text';

export interface EmptyStateProps {
  /** What this section is / why it is empty, in one line. */
  title: string;
  /** What the user can do next (docs/02 §9.3). */
  description: string;
  /** Optional illustration shown above the text. */
  illustration?: ReactNode;
  /** Primary next step (usually a Button). */
  action?: ReactNode;
  children?: ReactNode;
  align?: 'start' | 'center';
}

/** Empty state that always offers a next step. */
export function EmptyState({ title, description, illustration, action, children, align = 'start' }: EmptyStateProps) {
  const items = align === 'center' ? 'center' : 'flex-start';
  return (
    <View style={{ gap: 16, alignItems: items, paddingVertical: 24 }}>
      {illustration}
      <View style={{ gap: 6, maxWidth: 560, alignItems: items }}>
        <Text variant="h3" level={2} align={align === 'center' ? 'center' : 'left'}>{title}</Text>
        <Text tone="secondary" align={align === 'center' ? 'center' : 'left'}>{description}</Text>
      </View>
      {action}
      {children}
    </View>
  );
}

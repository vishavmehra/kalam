import { Send } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { KalamSpec } from '@/core/spec/schema';
import { Button, Sheet, Text, TextField, useKalamTheme, webData } from '@/design';

import { AnswerCard } from './AnswerCard';
import { useAssistantChat } from './use-assistant';

export interface AssistantSheetProps {
  spec: KalamSpec;
  /** Records are read for this app only. */
  appId: string;
  visible: boolean;
  onClose: () => void;
}

function Suggestion({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useKalamTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...webData({ kPress: '', kHover: 'surface' })}
      style={{
        minHeight: theme.touchTarget, justifyContent: 'center', paddingHorizontal: 14, borderRadius: theme.radius.pill,
        borderWidth: 1, borderColor: theme.colors.borderStrong,
      }}
    >
      <Text variant="bodySmall" weight="medium">{label}</Text>
    </Pressable>
  );
}

/**
 * Ask questions about one app's own entries. Answers come from the app's design and from formulas
 * calculated on this device. Only the question and the names of the fields are ever sent to an AI model.
 */
export function AssistantSheet({ spec, appId, visible, onClose }: AssistantSheetProps) {
  const { items, busy, ask, suggestions } = useAssistantChat(spec, appId);
  const [text, setText] = useState('');
  const submit = (q: string) => {
    if (!q.trim() || busy) return;
    setText('');
    void ask(q);
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Ask about ${spec.name}`}
      description="Your entries stay on this device. If AI is needed, only your question and the names of your fields are used."
      maxWidth={560}
    >
      <View style={{ gap: 16, paddingBottom: 24 }}>
        <TextField
          label="Your question"
          value={text}
          onChangeText={setText}
          placeholder="For example: How many orders do I have?"
          returnKeyType="send"
          onSubmitEditing={() => submit(text)}
          maxLength={300}
        />
        <Button label="Ask" icon={Send} onPress={() => submit(text)} loading={busy} disabled={!text.trim()} />

        {suggestions.length ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" tone="muted">Try asking</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map((q) => <Suggestion key={q} label={q} onPress={() => submit(q)} />)}
            </View>
          </View>
        ) : null}

        <View accessibilityLiveRegion="polite" style={{ gap: 12 }}>
          {items.map((item) => <AnswerCard key={item.id} item={item} />)}
        </View>
      </View>
    </Sheet>
  );
}

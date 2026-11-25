/** Draw modality: opens Drawing Studio and shows the attached sketch (docs/03 §11.1, §11.13). */
import { useRouter } from 'expo-router';
import { PenLine, Trash2 } from 'lucide-react-native';
import { Image, ScrollView, View } from 'react-native';
import { Button, Text, useKalamTheme } from '@/design';
import { useCreationStore } from '@/state/creation-store';

export function DrawPanel() {
  const router = useRouter();
  const { colors, space, radius } = useKalamTheme();
  const drawing = useCreationStore((s) => s.drawing);
  const drawingId = useCreationStore((s) => s.drawingId);
  const detach = useCreationStore((s) => s.detachDrawing);
  const stamps = drawing?.summary.elements.filter((e) => e.kind.startsWith('stamp:')).length ?? 0;

  return (
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">
        Draw each screen on its own page. Stamps for buttons, lists and inputs tell Kalam exactly what
        you mean. Your drawing is saved separately from the app.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <Button
          label={drawing || drawingId ? 'Continue drawing' : 'Open Drawing Studio'}
          icon={PenLine}
          onPress={() => router.push(drawingId ? `/create/draw?id=${encodeURIComponent(drawingId)}` : '/create/draw')}
        />
        {drawing ? <Button label="Detach drawing" icon={Trash2} variant="ghost" onPress={detach} /> : null}
      </View>
      {drawing ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" tone="secondary">
            {drawing.title} · {drawing.summary.pageCount} screen{drawing.summary.pageCount === 1 ? '' : 's'} · {stamps} component{stamps === 1 ? '' : 's'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
            {drawing.summary.images.map((img) => (
              <Image
                key={img.id}
                source={{ uri: `data:${img.mimeType};base64,${img.base64}` }}
                accessibilityLabel={img.label ?? 'Drawing page'}
                style={{ width: 96, height: 192, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
                resizeMode="contain"
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

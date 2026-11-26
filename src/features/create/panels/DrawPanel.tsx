/** Draw modality: opens Drawing Studio and shows the attached sketch (docs/03 §11.1, §11.13). */
import { useRouter } from 'expo-router';
import { PenLine, Trash2 } from 'lucide-react-native';
import { Image, ScrollView, View } from 'react-native';
import { Button, Text, useKalamTheme } from '@/design';
import { OBJECT_COLORS } from '@/features/media/objects';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';

export function DrawPanel() {
  const router = useRouter();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const drawing = useCreationStore((s) => s.drawing);
  const drawingId = useCreationStore((s) => s.drawingId);
  const detach = useCreationStore((s) => s.detachDrawing);
  const stamps = drawing?.summary.elements.filter((e) => e.kind.startsWith('stamp:')).length ?? 0;

  return (
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">{t('create.sketch.intro')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <Button
          label={t(drawing || drawingId ? 'create.sketch.continue' : 'create.sketch.open')}
          icon={PenLine}
          onPress={() => router.push(drawingId ? `/create/draw?id=${encodeURIComponent(drawingId)}` : '/create/draw')}
        />
        {drawing ? <Button label={t('create.sketch.detach')} icon={Trash2} variant="ghost" onPress={detach} /> : null}
      </View>
      {drawing ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" tone="secondary">
            {t('create.sketch.summary', { title: drawing.title, screens: t('create.tray.screens', { count: drawing.summary.pageCount }), parts: t('create.sketch.components', { count: stamps }) })}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
            {drawing.summary.images.map((img) => (
              <Image
                key={img.id}
                source={{ uri: `data:${img.mimeType};base64,${img.base64}` }}
                accessibilityLabel={img.label ?? t('create.sketch.page')}
                style={{ width: 96, height: 192, borderRadius: radius.paper, borderWidth: 1, borderColor: colors.border, backgroundColor: OBJECT_COLORS.paper }}
                resizeMode="contain"
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

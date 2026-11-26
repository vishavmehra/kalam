/**
 * Photo / sketch modality (docs/03 §8): choose, take, drop or paste up to four photos, previewed
 * in place.
 */
import { Camera, Crop, ImagePlus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { Button, IconButton, Text, useBreakpoint, useKalamTheme } from '@/design';
import { CropSheet, removePhotoEverywhere, useImageIntake } from '@/features/media';
import { OBJECT_COLORS } from '@/features/media/objects';
import { MAX_PHOTOS } from '@/features/input/normalize';
import { useT } from '@/i18n/react';
import type { MediaSource } from '@/infrastructure/media/source';
import { useCreationStore } from '@/state/creation-store';

import { useHasCamera } from './use-photo-drop';

export function PhotoPanel() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const photos = useCreationStore((s) => s.photos);
  const intake = useImageIntake();
  const [picking, setPicking] = useState<'camera' | 'library' | undefined>();
  /** Web: the chosen picture while the cropper is open. */
  const [toCrop, setToCrop] = useState<MediaSource>();
  const room = MAX_PHOTOS - photos.length;
  const hasCamera = useHasCamera();
  const { isPhone } = useBreakpoint();

  const pick = async (from: 'camera' | 'library', crop = false) => {
    setPicking(from);
    try { await intake.pick(from, crop ? { crop: true } : {}); } finally { setPicking(undefined); }
  };
  /** Android and iOS crop in the system picker; the browser has none, so the cropper sheet does it. */
  const crop = async () => {
    if (Platform.OS !== 'web') { await pick('library', true); return; }
    setPicking('library');
    try { setToCrop(await intake.pickOne()); } finally { setPicking(undefined); }
  };
  const busy = picking ?? (intake.busy ? 'library' : undefined);
  const error = intake.message;

  return (
    // Dropping or pasting a picture works anywhere on the create screen; the screen owns that (app/create/index.tsx).
    <View style={{ gap: space[4] }}>
      <Text tone="secondary">
        {t('create.photos.intro')}
        {Platform.OS === 'web' && !isPhone ? ` ${t('create.photos.dropHint')}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <Button label={t('create.photo.choose')} icon={ImagePlus} onPress={() => pick('library')} loading={busy === 'library'} disabled={room <= 0 || !!busy} />
        {hasCamera ? <Button
          label={t(Platform.OS === 'web' ? 'create.photos.useCamera' : 'create.photos.takePhoto')}
          icon={Camera}
          variant="outline"
          onPress={() => pick('camera')}
          loading={busy === 'camera'}
          disabled={room <= 0 || !!busy}
        /> : null}
        <Button label={t('create.photo.crop')} icon={Crop} variant="outline" onPress={() => void crop()} disabled={room <= 0 || !!busy} />
        {intake.busy ? <Button label={t('create.photo.stop')} variant="ghost" onPress={intake.cancel} /> : null}
      </View>
      {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
      {room <= 0 ? <Text variant="bodySmall" tone="muted">{t('create.photo.limit')}</Text> : null}
      {photos.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
          {photos.map((p, i) => (
            <View key={p.id} style={{ width: 160, gap: space[1] }}>
              {/* A print: paper border, set down slightly crooked (DIRECTION §6, the tray's materials). */}
              <View style={{ padding: 8, paddingBottom: 22, borderRadius: radius.sm, backgroundColor: OBJECT_COLORS.print, ...theme.elevation[1] }}>
                <Image
                  source={{ uri: `data:${p.mimeType};base64,${p.base64}` }}
                  accessibilityLabel={t('create.tray.photo', { n: i + 1 })}
                  style={{ width: 144, height: 144, borderRadius: 2, backgroundColor: colors.surfaceAlt, transform: [{ rotate: i % 2 ? '1.5deg' : '-1.5deg' }] }}
                  resizeMode="cover"
                />
              </View>
              <View style={{ position: 'absolute', top: 4, right: 4 }}>
                <IconButton icon={X} label={t('create.tray.removePhoto', { n: i + 1 })} variant="secondary" onPress={() => removePhotoEverywhere(p.id)} />
              </View>
              <Text variant="caption" tone="muted" numeric>{p.width} × {p.height}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <CropSheet source={toCrop} onDone={(picture) => { setToCrop(undefined); if (picture) void intake.addSources([picture]); }} />
    </View>
  );
}

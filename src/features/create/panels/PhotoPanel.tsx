/**
 * Photo / sketch modality (docs/03 §8): choose, take, drop or paste up to four photos, previewed
 * in place.
 */
import { Camera, ImagePlus, X } from 'lucide-react-native';
import { type ComponentRef, useCallback, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { Button, IconButton, Text, useBreakpoint, useKalamTheme } from '@/design';
import { MAX_PHOTOS } from '@/features/input/normalize';
import { normalizeImageUri, pickImages } from '@/infrastructure/platform/image';
import { useCreationStore } from '@/state/creation-store';

import { useHasCamera, usePhotoDrop } from './use-photo-drop';

export function PhotoPanel() {
  const { colors, space, radius } = useKalamTheme();
  const photos = useCreationStore((s) => s.photos);
  const addPhotos = useCreationStore((s) => s.addPhotos);
  const removePhoto = useCreationStore((s) => s.removePhoto);
  const [busy, setBusy] = useState<'camera' | 'library' | undefined>();
  const [error, setError] = useState<string>();
  const room = MAX_PHOTOS - photos.length;
  const hasCamera = useHasCamera();
  const { isPhone } = useBreakpoint();
  const zone = useRef<ComponentRef<typeof View>>(null);

  // Dropped or pasted files go through the same resize + location strip as picked ones.
  const onFiles = useCallback(async (files: File[], skipped: number) => {
    const free = MAX_PHOTOS - useCreationStore.getState().photos.length;
    const take = files.slice(0, Math.max(0, free));
    setError(skipped ? 'Files over 20 MB were skipped.' : files.length > take.length ? 'Four photos is the limit. Some were not added.' : undefined);
    if (!take.length) return;
    setBusy('library');
    try {
      const images = [];
      for (const f of take) {
        const url = URL.createObjectURL(f);
        try { images.push(await normalizeImageUri(url, 'photo', f.name)); } finally { URL.revokeObjectURL(url); }
      }
      addPhotos(images);
    } catch {
      setError('That image could not be opened. Try a JPEG or PNG.');
    } finally {
      setBusy(undefined);
    }
  }, [addPhotos]);
  const dragging = usePhotoDrop(zone, (f, skipped) => void onFiles(f, skipped), room > 0);

  const pick = async (from: 'camera' | 'library') => {
    setError(undefined);
    setBusy(from);
    try {
      addPhotos(await pickImages(from, room));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be opened. Try a JPEG or PNG.');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <View
      ref={zone}
      style={{
        gap: space[4],
        ...(Platform.OS === 'web' ? { borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: dragging ? colors.primary : 'transparent', backgroundColor: dragging ? colors.primarySoft : 'transparent', margin: -10, padding: 10 } : {}),
      }}
    >
      <Text tone="secondary">
        Photograph a paper sketch, a register page or a form you already use. Photos are resized and
        stripped of location data on this device before anything is sent.
        {Platform.OS === 'web' && !isPhone ? ' You can also drop image files here or paste one.' : ''}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <Button label="Choose photos" icon={ImagePlus} onPress={() => pick('library')} loading={busy === 'library'} disabled={room <= 0 || !!busy} />
        {hasCamera ? <Button
          label={Platform.OS === 'web' ? 'Use camera' : 'Take a photo'}
          icon={Camera}
          variant="outline"
          onPress={() => pick('camera')}
          loading={busy === 'camera'}
          disabled={room <= 0 || !!busy}
        /> : null}
      </View>
      {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
      {room <= 0 ? <Text variant="bodySmall" tone="muted">Four photos is the limit. Remove one to add another.</Text> : null}
      {photos.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
          {photos.map((p, i) => (
            <View key={p.id} style={{ width: 148, gap: space[1] }}>
              <Image
                source={{ uri: `data:${p.mimeType};base64,${p.base64}` }}
                accessibilityLabel={`Photo ${i + 1}`}
                style={{ width: 148, height: 148, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
                resizeMode="cover"
              />
              <View style={{ position: 'absolute', top: 4, right: 4 }}>
                <IconButton icon={X} label={`Remove photo ${i + 1}`} variant="secondary" onPress={() => removePhoto(p.id)} />
              </View>
              <Text variant="caption" tone="muted" numeric>{p.width} × {p.height}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

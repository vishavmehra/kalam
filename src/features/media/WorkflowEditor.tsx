/**
 * Editable review of a video's steps before building (docs/06 §9.7, docs/14 §5.4-5.5): each step shows
 * its time and frame, can be reworded, moved, removed or added, and the person confirms the list.
 */
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react-native';
import { Image, View } from 'react-native';
import { Button, Chip, IconButton, Stamp, Surface, Text, TextField, useKalamTheme } from '@/design';
import { workflowCopy } from '@/core/media/copy';
import { formatClock } from '@/core/media/frames';
import { addStep, confirmWorkflow, editStep, moveStep, removeStep, renameWorkflow } from '@/core/media/workflow';
import type { WorkflowSummary } from '@/core/media/types';
import { framesOf, setWorkflow } from '@/core/session/session';
import { slipNumber } from '@/design';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';
import { updateSession, useMediaStore } from './media-store';

const NONE: never[] = [];

export function WorkflowEditor({ attachmentId }: { attachmentId: string }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const session = useMediaStore((s) => s.session);
  const images = useCreationStore((s) => s.video?.frames ?? NONE);
  const workflow = session?.workflows.find((w) => w.attachmentId === attachmentId);
  if (!session || !workflow) return null;
  const frames = framesOf(session, attachmentId);

  const save = (fn: (w: WorkflowSummary, now: number) => WorkflowSummary) =>
    updateSession((s) => {
      const w = s.workflows.find((x) => x.attachmentId === attachmentId);
      return w ? setWorkflow(s, fn(w, Date.now()), Date.now()) : s;
    });
  const imageFor = (frameId?: string) => {
    const assetId = frames.find((f) => f.id === frameId)?.assetId;
    return images.find((i) => i.id === assetId);
  };

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
        <Text variant="h4" style={{ flex: 1 }}>{workflowCopy.heading}</Text>
        <Stamp kind={workflow.source === 'cloud' ? 'cloud' : 'template'} label={workflowCopy.describedBy[workflow.source]} size="sm" />
      </View>
      <Text tone="secondary">{workflowCopy.intro}</Text>
      <TextField label={workflowCopy.nameLabel} value={workflow.name} onChangeText={(v) => save((w, now) => renameWorkflow(w, v, now))} maxLength={120} />
      <View accessibilityRole="list" style={{ gap: space[2] }}>
        {workflow.steps.map((step, i) => {
          const clock = formatClock(step.timestampMs);
          const img = imageFor(step.frameId);
          return (
            // A numbered paper slip per step, in the order the person does them (DIRECTION §7: real sequences only).
            <Surface key={`${i}-${step.timestampMs}`} bordered radius="paper" padded={space[2]} style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
              <View style={{ width: 54, gap: 4, alignItems: 'flex-start' }}>
                <Text mono variant="caption" tone="mark" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{slipNumber(step.order, 2, t('slip.no'))}</Text>
                {img ? (
                  <Image source={{ uri: `data:${img.mimeType};base64,${img.base64}` }} accessible={false} style={{ width: 54, height: 42, borderRadius: radius.paper, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label={workflowCopy.stepLabel(step.order, clock)}
                  placeholder={workflowCopy.stepPlaceholder}
                  value={step.description}
                  onChangeText={(v) => save((w, now) => editStep(w, i, v, now))}
                  multiline
                  maxLength={300}
                />
              </View>
              <View>
                <IconButton icon={ArrowUp} label={workflowCopy.moveUp(step.order)} disabled={i === 0} onPress={() => save((w, now) => moveStep(w, i, i - 1, now))} />
                <IconButton icon={ArrowDown} label={workflowCopy.moveDown(step.order)} disabled={i === workflow.steps.length - 1} onPress={() => save((w, now) => moveStep(w, i, i + 1, now))} />
                <IconButton icon={Trash2} label={workflowCopy.remove(step.order)} onPress={() => save((w, now) => removeStep(w, i, now))} />
              </View>
            </Surface>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: space[3], flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={workflowCopy.addStep} icon={Plus} variant="outline" onPress={() => save((w, now) => addStep(w, w.steps.length - 1, now))} />
        {workflow.reviewed ? (
          <Chip label={workflowCopy.confirmed} icon={Check} tone="success" />
        ) : (
          <Button label={workflowCopy.confirm} icon={Check} onPress={() => save((w, now) => confirmWorkflow(w, now))} disabled={!workflow.steps.length} />
        )}
      </View>
    </View>
  );
}

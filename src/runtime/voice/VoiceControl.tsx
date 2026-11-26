/**
 * <VoiceControl> — the microphone button of a running app (docs/03 §16, docs/10 §4.5).
 *
 * Listening starts only when the person taps it, is shown clearly while it lasts, and ends on
 * the next tap, on Cancel, after a short silence or after a time limit. Spoken answers are
 * mirrored in a small card so the control also works without sound. A typed command is always
 * available, so nobody is stuck when speech recognition is missing or blocked.
 *
 * Styled only from the resolved app theme, like the rest of the runtime.
 * Mount it inside <KalamRuntime>, once, after the toast.
 */
import { Keyboard, Mic, RotateCcw, Send, Square, VolumeX, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, Animated, Text, TextInput, View } from 'react-native';
import { elevation } from '@/design/tokens';
import type { RuntimeTheme } from '../engine/theme';
import { EASE_OUT, font, NATIVE_DRIVER, Pressy, useReducedMotion } from '../ui/kit';
import { useVoiceAgent, type UseVoiceAgentArgs, type VoiceAgent } from './useVoiceAgent';

export interface VoiceControlProps extends UseVoiceAgentArgs {
  theme: RuntimeTheme;
  /** Distance from the bottom edge. The default clears the runtime toast. */
  bottomOffset?: number;
}

type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export function VoiceControl({ theme: t, bottomOffset = 88, ...args }: VoiceControlProps) {
  const agent = useVoiceAgent(args);
  const { state } = agent;
  const reduced = useReducedMotion();
  const voiceOnly = args.accessModes.voiceOnly === true;
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  // In normal use an answer fades away on its own. Voice-only keeps it until dismissed.
  useEffect(() => {
    if (!state.reply || voiceOnly || state.phase !== 'idle') return undefined;
    const id = setTimeout(agent.dismiss, 9000);
    return () => clearTimeout(id);
  }, [state.reply, state.phase, voiceOnly, agent.dismiss]);

  const pulse = useListeningPulse(state.phase === 'listening' && !reduced);

  const unsupported = state.capability !== undefined && !state.capability.supported;
  // Voice-only with no speech recognition: open the typed command box so nobody is stuck.
  useEffect(() => {
    if (unsupported && voiceOnly) setTyping(true);
  }, [unsupported, voiceOnly]);
  if (Object.keys(args.spec.actions).length === 0) return null;
  if (unsupported && !voiceOnly && !typing) return null;

  const listening = state.phase === 'listening' || state.phase === 'starting';
  const thinking = state.phase === 'thinking';
  const size = Math.max(t.target, 56) + (voiceOnly ? 8 : 0);
  const showCard = typing || state.phase !== 'idle' || !!state.reply || !!state.unavailable || (unsupported && voiceOnly);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void agent.submitText(text);
  };

  const mic = (
    <View key="mic" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pulse ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.danger,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
          }}
        />
      ) : null}
      <Pressy
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop listening' : thinking ? 'Working on your command' : 'Talk to this app'}
        accessibilityHint={listening ? 'Stops listening and uses what you said.' : 'Starts listening. Nothing is heard until you tap.'}
        accessibilityState={{ busy: thinking, selected: listening }}
        disabled={thinking}
        onPress={() => void agent.listen()}
        style={{
          width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
          backgroundColor: listening ? t.colors.danger : t.colors.primary,
          borderWidth: listening ? Math.max(2, t.borderWidth) : t.borderWidth,
          borderColor: listening ? t.colors.onDanger : t.colors.onPrimary,
          ...elevation[2],
        }}
      >
        {thinking ? (
          <ActivityIndicator color={t.colors.onPrimary} />
        ) : listening ? (
          <Square size={22 * t.fontScale} color={t.colors.onDanger} fill={t.colors.onDanger} />
        ) : (
          <Mic size={26 * t.fontScale} color={t.colors.onPrimary} />
        )}
      </Pressy>
    </View>
  );

  const keyboard = (
    <Pressy
      key="kbd"
      accessibilityRole="button"
      accessibilityLabel={typing ? 'Hide the command box' : 'Type a command instead'}
      accessibilityState={{ expanded: typing }}
      onPress={() => {
        // Keep what was heard so a misheard word can be corrected instead of said again (docs/10 §16.1).
        if (!typing && !draft && state.transcript) setDraft(state.transcript);
        setTyping((v) => !v);
      }}
      style={{
        width: t.target, height: t.target, borderRadius: t.target / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.colors.surface, borderWidth: Math.max(1, t.borderWidth), borderColor: t.colors.border,
      }}
    >
      <Keyboard size={22 * t.fontScale} color={t.colors.text} />
    </Pressy>
  );
  const hint = voiceOnly && state.phase === 'idle' ? (
    <View
      key="hint"
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.radius, backgroundColor: t.colors.surface, borderWidth: Math.max(1, t.borderWidth), borderColor: t.colors.border }}
    >
      <Text style={[font(t, 15, '600'), { color: t.colors.text }]}>Tap to talk</Text>
    </View>
  ) : null;
  // While Kalam is talking and no card is open, a lone Stop button is enough.
  const stop = agent.speaking && !showCard ? (
    <Btn key="stop" t={t} icon={VolumeX} label="Stop talking" onPress={agent.stopSpeaking} />
  ) : null;
  const row = [stop, hint, keyboard, mic].filter(Boolean);
  if (t.mirror) row.reverse();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: bottomOffset, gap: 10, alignItems: t.mirror ? 'flex-start' : 'flex-end' }}
    >
      {showCard ? <Card t={t} agent={agent} typing={typing} draft={draft} setDraft={setDraft} send={send} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>{row}</View>
    </View>
  );
}

/** A looping 0→1 value while `on`, for the listening ring. Reduced motion never starts it. */
function useListeningPulse(on: boolean): Animated.Value | undefined {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return undefined;
    value.setValue(0);
    const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration: 1200, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [on, value]);
  return on ? value : undefined;
}

// ─── Card ────────────────────────────────────────────────────────────────────
function Card({ t, agent, typing, draft, setDraft, send }: {
  t: RuntimeTheme; agent: VoiceAgent; typing: boolean; draft: string; setDraft(v: string): void; send(): void;
}) {
  const { state } = agent;
  const where = state.where === 'on_device' ? 'Heard on this device' : state.where ? `Heard by ${agent.serviceName}` : undefined;

  let title = '';
  let body: string | undefined;
  if (state.phase === 'consent') {
    title = 'Allow the speech service?';
    body = `This device cannot turn your voice into text by itself. ${agent.serviceName} will hear what you say. Kalam does not upload or keep the recording.`;
  } else if (state.phase === 'confirming' && state.pending) {
    title = 'Please confirm';
    body = state.pending.prompt;
  } else if (state.phase === 'listening') {
    title = 'Listening';
  } else if (state.phase === 'starting') {
    title = state.status;
  } else if (state.phase === 'thinking') {
    title = 'Working on it';
  } else if (state.unavailable) {
    title = 'Voice is not available';
    body = state.unavailable;
  } else if (state.reply) {
    title = state.reply;
  } else if (state.status) {
    title = state.status;
  } else if (state.capability && !state.capability.supported) {
    title = 'Voice is not available';
    body = 'This device cannot hear you. You can type a command instead.';
  }

  return (
    <View
      style={{
        width: '100%', maxWidth: 360, padding: t.space, gap: 10, borderRadius: Math.min(t.radius + 4, 24),
        backgroundColor: t.colors.surface, borderWidth: Math.max(1, t.borderWidth), borderColor: t.colors.border,
        ...elevation[2],
      }}
    >
      {title ? (
        <Text accessibilityLiveRegion="polite" role="status" style={[font(t, 16, '600'), { color: t.colors.text }]}>{title}</Text>
      ) : null}
      {body ? <Text style={[font(t, 15), { color: t.colors.text }]}>{body}</Text> : null}
      {state.transcript && (state.phase !== 'idle' || state.reply) ? (
        <Text style={[font(t, 14), { color: t.colors.textMuted }]}>You said: {state.transcript}</Text>
      ) : null}
      {where && state.phase === 'listening' ? <Text style={[font(t, 13), { color: t.colors.textMuted }]}>{where}</Text> : null}

      {typing ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
            returnKeyType="send"
            maxLength={300}
            accessibilityLabel="Type a command"
            placeholder="Type a command"
            placeholderTextColor={t.colors.textMuted}
            style={[
              font(t, 16),
              {
                flex: 1, minHeight: t.target, paddingHorizontal: 12, borderRadius: t.radius, color: t.colors.text,
                borderWidth: Math.max(1, t.borderWidth), borderColor: t.colors.border, backgroundColor: t.colors.background,
              },
            ]}
          />
          <Btn t={t} icon={Send} label="Send" onPress={send} tone="primary" disabled={!draft.trim() || state.phase === 'thinking'} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {state.phase === 'confirming' ? (
          <>
            <Btn t={t} label="Yes, do it" onPress={() => void agent.confirm()} tone="primary" />
            {state.pending && Object.keys(state.pending.fields).length > 0 ? (
              <Btn t={t} label="Change details" onPress={() => void agent.changeDetails()} />
            ) : null}
            <Btn t={t} label="Cancel" onPress={agent.decline} />
          </>
        ) : null}
        {state.phase === 'consent' ? (
          <>
            <Btn t={t} label="Allow for now" onPress={() => void agent.allowService()} tone="primary" />
            {state.consent?.canDownload ? <Btn t={t} label="Download speech model" onPress={() => void agent.downloadModel()} /> : null}
            <Btn t={t} label="Not now" onPress={agent.cancel} />
          </>
        ) : null}
        {state.phase === 'listening' || state.phase === 'starting' || state.phase === 'thinking' ? (
          <Btn t={t} icon={X} label="Cancel" onPress={agent.cancel} />
        ) : null}
        {state.phase === 'idle' && state.reply ? (
          <>
            <Btn t={t} icon={RotateCcw} label="Repeat" onPress={agent.repeat} />
            <Btn t={t} label="Close" onPress={agent.dismiss} />
          </>
        ) : null}
        {state.phase === 'idle' && !state.reply && state.unavailable ? <Btn t={t} label="Close" onPress={agent.dismiss} /> : null}
        {agent.speaking ? <Btn t={t} icon={VolumeX} label="Stop talking" onPress={agent.stopSpeaking} /> : null}
      </View>
    </View>
  );
}

function Btn({ t, label, onPress, icon: Icon, tone = 'outline', disabled }: {
  t: RuntimeTheme; label: string; onPress(): void; icon?: IconType; tone?: 'primary' | 'outline'; disabled?: boolean;
}) {
  const primary = tone === 'primary';
  const color = primary ? t.colors.onPrimary : t.colors.text;
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: t.target, minWidth: t.target, paddingHorizontal: 14, borderRadius: t.radius, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: primary ? t.colors.primary : 'transparent',
        borderWidth: primary ? 0 : Math.max(1, t.borderWidth), borderColor: t.colors.border,
      }}
    >
      {Icon ? <Icon size={18 * t.fontScale} color={color} /> : null}
      <Text style={[font(t, 15, '600'), { color }]}>{label}</Text>
    </Pressy>
  );
}

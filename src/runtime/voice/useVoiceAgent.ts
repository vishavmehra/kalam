/**
 * React binding for the voice agent controller (./controller.ts). One controller per app screen
 * session; it always reads the latest spec, screen, Access Modes and speech settings through a ref,
 * so a live edit or a settings change takes effect without restarting anything.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_SPEECH, type AccessModes, type RuntimeServices, type VoiceService } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { getSpeechCapability, installOnDeviceSpeech, startDictation } from '@/infrastructure/platform/speech';
import { speechServiceName } from '@/infrastructure/platform/speech.shared';
import { getSpeaker } from '@/infrastructure/platform/tts';
import { getServices } from '@/services';
import { useSettingsStore } from '@/state/settings-store';
import type { RuntimeState } from '../engine';
import {
  createVoiceController, type VoiceContext, type VoiceController, type VoiceRunner, type VoiceUiState,
} from './controller';

export interface UseVoiceAgentArgs {
  spec: KalamSpec;
  appId: string;
  /** The screen the person is on. Commands and announcements are about this screen. */
  screenId: string;
  /** Used for `online()`: the online speech service cannot work offline. Speech output uses the shared queue. */
  services: RuntimeServices;
  accessModes: AccessModes;
  /** Runs one engine operation on the live runtime (KalamRuntime's `run`). */
  run: VoiceRunner;
  /** The live runtime state (KalamRuntime's `rtRef.current`). */
  getState: () => RuntimeState;
  /** Go back one screen (KalamRuntime's `back`). */
  onBack?: () => void;
  /** Defaults to the app's voice service. Injectable for tests. */
  voice?: VoiceService;
}

export interface VoiceAgent {
  state: VoiceUiState;
  speaking: boolean;
  /** Spoken name of the speech service, for the consent text. */
  serviceName: string;
  listen: VoiceController['listen'];
  cancel: VoiceController['cancel'];
  confirm: VoiceController['confirm'];
  decline: VoiceController['decline'];
  changeDetails: VoiceController['changeDetails'];
  submitText: VoiceController['submitText'];
  allowService: VoiceController['allowService'];
  downloadModel: VoiceController['downloadModel'];
  repeat: VoiceController['repeat'];
  stopSpeaking: VoiceController['stopSpeaking'];
  dismiss: VoiceController['dismiss'];
}

const SERVICE_NAME = speechServiceName(Platform.OS);

export function useVoiceAgent(args: UseVoiceAgentArgs): VoiceAgent {
  const settings = useSettingsStore((s) => s.settings);
  const speech = settings.speech ?? DEFAULT_SPEECH;

  const context: VoiceContext = {
    spec: args.spec, screenId: args.screenId, accessModes: args.accessModes, speech,
    aiMode: settings.aiMode, allowCloud: settings.allowCloud,
  };
  const latest = useRef({ context, args });
  latest.current = { context, args };

  const controller = useMemo(
    () =>
      createVoiceController({
        context: () => latest.current.context,
        interpret: (spec, screenId, transcript) => (latest.current.args.voice ?? getServices().voice).interpret(spec, screenId, transcript),
        run: (op, overrides) => latest.current.args.run(op, overrides),
        getState: () => latest.current.args.getState(),
        goBack: () => latest.current.args.onBack?.(),
        online: () => latest.current.args.services.online(),
        speaker: getSpeaker(),
        dictation: { getCapability: getSpeechCapability, install: installOnDeviceSpeech, start: startDictation },
        serviceName: SERVICE_NAME,
      }),
    [args.appId],
  );

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const speaker = getSpeaker();
  const speaking = useSyncExternalStore(
    useCallback((listener: () => void) => speaker.subscribe(listener), [speaker]),
    () => speaker.isSpeaking(),
    () => false,
  );

  // What this device can recognise, checked again when the speech language changes. No microphone use. The
  // microphone button hides itself from this result (VoiceControl), so it must be known up front. Automated
  // browsers are protected inside the web probe (speech.web.ts), not here.
  useEffect(() => {
    void controller.prepare();
  }, [controller, speech.sttLanguage]);

  // Leaving the app stops listening and talking.
  useEffect(() => () => controller.shutdown(), [controller]);

  // Screen enter: drop a stale question, and in Voice-only Mode say the title and what can be said.
  const voiceOnly = args.accessModes.voiceOnly === true;
  useEffect(() => {
    controller.onScreenChanged();
    if (voiceOnly) controller.announceScreen();
  }, [controller, args.screenId, voiceOnly]);

  return {
    state,
    speaking,
    serviceName: SERVICE_NAME,
    listen: controller.listen,
    cancel: controller.cancel,
    confirm: controller.confirm,
    decline: controller.decline,
    changeDetails: controller.changeDetails,
    submitText: controller.submitText,
    allowService: controller.allowService,
    downloadModel: controller.downloadModel,
    repeat: controller.repeat,
    stopSpeaking: controller.stopSpeaking,
    dismiss: controller.dismiss,
  };
}

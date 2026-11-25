/**
 * Voice agent for generated apps (docs/05 §10, docs/10 §4.4-4.5, docs/03 §16).
 * Mount `<VoiceControl>` inside `<KalamRuntime>`; send runtime speech through `speakAloud`.
 */
export { VoiceControl, type VoiceControlProps } from './VoiceControl';
export { useVoiceAgent, type UseVoiceAgentArgs, type VoiceAgent } from './useVoiceAgent';
export {
  createVoiceController, type VoiceContext, type VoiceController, type VoiceControllerDeps, type VoiceDictation,
  type VoicePending, type VoicePhase, type VoiceRunner, type VoiceUiState,
} from './controller';
export { repeatSpeech, speakAloud, stopSpeakingAloud } from './speak';
export { speechVoiceFor, type SpokenVoice } from './speech-voice';

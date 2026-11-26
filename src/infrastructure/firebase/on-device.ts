// Type/resolution shim: Metro picks on-device.web.ts / on-device.native.ts; tsc and Vitest resolve here.
export {
  getLanguageModel, ON_DEVICE_MODEL_NAME, onDeviceStatus, prepareOnDevice, TEXT_IO, warmUpOnDevice, type LanguageModelStatic,
} from './on-device.web';

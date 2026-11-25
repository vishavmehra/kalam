/** Android ships its JS bundle inside the APK, so there is no service worker. */
export interface ServiceWorkerOptions {
  onUpdateAvailable?: (apply: () => void) => void;
}

export function registerServiceWorker(_options: ServiceWorkerOptions = {}): void {}

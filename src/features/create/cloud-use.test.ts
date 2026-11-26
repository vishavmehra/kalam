import { describe, expect, it } from 'vitest';

import type { CreationDraft } from '@/features/input/normalize';

import { buildForecast, cloudAllowed, draftMayUseCloud, needsCloudNotice } from './cloud-use';

const draft = (text: string, extra: Partial<CreationDraft> = {}): CreationDraft => ({ text, photos: [], preferences: { language: 'en' }, ...extra });
const on = { allowCloud: true, aiMode: 'hybrid' as const, cloudNoticeSeen: false };

describe('cloud use for the first-send notice', () => {
  it('keeps a simple template request on this device', () => {
    expect(draftMayUseCloud(draft('A simple calculator with big buttons for quick sums.'))).toBe(false);
    expect(needsCloudNotice(on, draft('A simple calculator with big buttons for quick sums.'))).toBe(false);
  });

  it('flags a detailed or multimodal request as possibly going online', () => {
    const photo = { id: 'p', width: 10, height: 10, source: 'photo' as const, mimeType: 'image/jpeg' as const, base64: '' };
    expect(draftMayUseCloud(draft('A calculator', { photos: [photo] }))).toBe(true);
    expect(draftMayUseCloud(draft('A clinic app with patients, appointments, prescriptions, bills and a doctor schedule on separate screens linked together.'))).toBe(true);
  });

  it('never asks when nothing was added, cloud is off, or the notice was seen', () => {
    const complex = draft('A clinic app with patients, appointments, prescriptions, bills and a doctor schedule on separate screens linked together.');
    expect(draftMayUseCloud(draft('  '))).toBe(false);
    expect(needsCloudNotice({ ...on, allowCloud: false }, complex)).toBe(false);
    expect(needsCloudNotice({ ...on, aiMode: 'offline_only' }, complex)).toBe(false);
    expect(needsCloudNotice({ ...on, cloudNoticeSeen: true }, complex)).toBe(false);
    expect(needsCloudNotice(on, complex)).toBe(true);
    expect(cloudAllowed({ allowCloud: true, aiMode: 'hybrid' })).toBe(true);
  });
});

describe('route forecast before a build', () => {
  const simple = draft('A simple calculator with big buttons for quick sums.');
  const complex = draft('A clinic app with patients, appointments, prescriptions, bills and a doctor schedule on separate screens linked together.');
  const photo = { id: 'p', width: 10, height: 10, source: 'photo' as const, mimeType: 'image/jpeg' as const, base64: '' };
  it.each([
    ['nothing added', draft(' '), true, true, undefined],
    ['a template match, even offline with cloud off', simple, false, false, 'create.forecast.templateBody'],
    ['cloud turned off', complex, false, true, 'create.forecast.cloudOffBody'],
    ['offline', complex, true, false, 'create.forecast.offlineBody'],
    ['words only', complex, true, true, 'create.forecast.cloudBody'],
    ['a photo', draft('A calculator', { photos: [photo] }), true, true, 'create.forecast.photoBody'],
  ] as const)('%s', (_name, d, cloudOk, online, body) => {
    expect(buildForecast(d, cloudOk, online)?.body).toBe(body);
  });
});

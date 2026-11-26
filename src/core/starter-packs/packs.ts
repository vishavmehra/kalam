/**
 * Vertical starter packs (docs/14 §20): a few gallery templates chosen for one trade, with a short walk through them.
 * A pack holds no data of its own. It points at gallery templates, so every app in it is the same tested template
 * anyone can install on its own, and it works with no network.
 */
import type { IconGlyph, SuggestedMode, ThemePreset } from '../spec/schema';
import { getCatalogEntry } from '../templates/catalog';
import { PACK_COPY, type PackCopy, type PackId } from './copy';

export type { PackId } from './copy';
export const PACK_IDS = ['retail_kirana', 'tailoring', 'education', 'clinics', 'home'] as const satisfies readonly PackId[];

export interface StarterPack extends PackCopy {
  id: PackId;
  glyph: IconGlyph;
  theme: ThemePreset;
  /** Gallery template ids, in the order they are added to the shelf. */
  apps: readonly string[];
  /** Search words, English, Hinglish and Hindi. */
  keywords: readonly string[];
}

interface PackShape {
  glyph: IconGlyph;
  theme: ThemePreset;
  apps: readonly string[];
  keywords: readonly string[];
}

const SHAPE: Record<PackId, PackShape> = {
  retail_kirana: {
    glyph: 'shopping_cart', theme: 'warm_paper',
    apps: ['kirana_credit_book', 'daily_sales', 'inventory_manager', 'supplier_list', 'gst_calculator'],
    keywords: ['kirana', 'shop', 'retail', 'store', 'dukaan', 'grocery', 'दुकान', 'किराना'],
  },
  tailoring: {
    glyph: 'scissors', theme: 'calm_green',
    apps: ['tailor_book', 'tailor_order_book', 'delivery_tracker', 'payment_ledger'],
    keywords: ['tailor', 'tailoring', 'boutique', 'darzi', 'stitching', 'दर्जी'],
  },
  education: {
    glyph: 'graduation_cap', theme: 'ocean_blue',
    apps: ['student_register', 'attendance_register', 'fee_tracker', 'homework_tracker', 'student_progress'],
    keywords: ['tutor', 'tuition', 'teacher', 'school', 'coaching', 'class', 'education', 'पढ़ाई', 'शिक्षक'],
  },
  clinics: {
    glyph: 'heart', theme: 'soft_lavender',
    apps: ['appointment_tracker', 'visit_register', 'followup_list'],
    keywords: ['clinic', 'doctor', 'patients', 'appointments', 'health', 'क्लिनिक'],
  },
  home: {
    glyph: 'home', theme: 'calm_green',
    apps: ['household_budget', 'grocery_list', 'medicine_tracker', 'bill_reminders', 'daily_task_list'],
    keywords: ['home', 'household', 'family', 'budget', 'ghar', 'घर'],
  },
};

export const STARTER_PACKS: readonly StarterPack[] = PACK_IDS.map((id) => ({ id, ...PACK_COPY[id], ...SHAPE[id] }));

export const listStarterPacks = (): readonly StarterPack[] => STARTER_PACKS;
export const getStarterPack = (id: string): StarterPack | undefined => STARTER_PACKS.find((p) => p.id === id);

/** Modes any app of the pack suggests, so the pack can offer them once instead of once per app. */
export function packSuggestedModes(pack: StarterPack): SuggestedMode[] {
  const modes = new Set<SuggestedMode>();
  for (const id of pack.apps) for (const m of getCatalogEntry(id)?.accessibility.suggestedModes ?? []) modes.add(m);
  return [...modes];
}

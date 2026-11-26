/**
 * Names of Studio things in the chosen language. The tools, paper colours, fonts and the like are model data with
 * English labels; the screens look their words up here by id. Uses the active-language translator, like the history
 * copy: the Studio is opened after the language is chosen, and a language switch shows the next time it opens.
 */
import { t as gt } from '@/i18n/active';
import type { TranslationKey } from '@/i18n/keys';

import type { DrawingHint, FontChoice, PageBackground } from './model';
import type { Tool } from './studio-store';

export const TOOL_NAME_KEYS: Record<Tool, TranslationKey> = {
  select: 'studio.tool.select', pen: 'studio.tool.pen', marker: 'studio.tool.marker', highlighter: 'studio.tool.highlighter',
  eraser: 'studio.tool.eraser', rect: 'studio.tool.rect', ellipse: 'studio.tool.ellipse', line: 'studio.tool.line',
  arrow: 'studio.tool.arrow', text: 'studio.tool.text', stamp: 'studio.tool.stamp',
};
export const toolLabel = (tool: Tool): string => gt(TOOL_NAME_KEYS[tool]);

export const formatLabel = (id: 'png' | 'svg' | 'pdf'): string => gt(`studio.export.format.${id}` as const);
export const scaleLabel = (scale: 1 | 2 | 4): string => gt(`studio.export.scale.${scale}` as const);

export const hintLabel = (h: DrawingHint): string => gt(`studio.hint.${h}` as const);
export const backgroundLabel = (b: PageBackground): string => gt(`studio.bg.${b}` as const);
export const fontLabel = (f: FontChoice): string => gt(`studio.font.${f}` as const);

/** Paper colours are listed by their English name in the model; this finds the words for it. */
const PAPER_KEYS: Record<string, TranslationKey> = {
  White: 'studio.paper.white', Paper: 'studio.paper.paper', Haldi: 'studio.paper.haldi', Ink: 'studio.paper.ink',
  Green: 'studio.paper.green', Sky: 'studio.paper.sky', Rose: 'studio.paper.rose',
};
export const paperName = (name: string): string => (PAPER_KEYS[name] ? gt(PAPER_KEYS[name]) : name);

/** Corner and arrow-head options, by their ids in the model. */
const RADIUS_KEYS: Record<string, TranslationKey> = {
  square: 'studio.radius.square', small: 'studio.radius.small', medium: 'studio.radius.medium', large: 'studio.radius.large', pill: 'studio.radius.pill',
};
const HEAD_KEYS: Record<string, TranslationKey> = {
  auto: 'studio.head.auto', small: 'studio.head.small', medium: 'studio.head.medium', large: 'studio.head.large',
};
export const radiusLabel = (id: string, fallback: string): string => (RADIUS_KEYS[id] ? gt(RADIUS_KEYS[id]) : fallback);
export const headLabel = (id: string, fallback: string): string => (HEAD_KEYS[id] ? gt(HEAD_KEYS[id]) : fallback);

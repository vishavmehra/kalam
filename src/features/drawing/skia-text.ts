/**
 * Shaped text for Skia on Android (docs/08 §6.6). Skia's plain `drawText` puts one glyph per character, so
 * Hindi conjuncts, Tamil vowel signs and the other Indic scripts come out wrong. Skia's paragraph builder
 * runs a real shaper, but it needs the Noto fonts handed to it as typefaces. This file loads the same Noto
 * files N9's loader uses (`i18n/font-assets`), registers them with a Skia font provider, and draws
 * non-Latin lines as paragraphs. Latin text keeps the faster `drawText` path in `render-skia.ts`.
 *
 * Only `render-skia.ts` imports this, so the web bundle never sees it.
 */
import { Skia, TextAlign, type SkCanvas, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { Image } from 'react-native';
import { scriptFontAssets } from '@/i18n/font-assets';
import { scriptFontFamily, type NonLatinScript } from '@/i18n/scripts';
import { nonLatinScripts, textFontFamilies } from './model';
import { ensureTextFonts, registerFontTarget } from './text-fonts';

let provider: SkTypefaceFontProvider | undefined;
const registered = new Set<NonLatinScript>();
/** Only the two weights Drawing Studio text uses (regular, and semibold for bold), to keep memory down. */
const WEIGHTS = ['regular', 'semibold'] as const;

async function loadScript(script: NonLatinScript): Promise<void> {
  const fonts = (provider ??= Skia.TypefaceFontProvider.Make());
  for (const weight of WEIGHTS) {
    const family = scriptFontFamily(script, weight);
    const asset = family ? scriptFontAssets[script][family] : undefined;
    const uri = typeof asset === 'number' ? Image.resolveAssetSource(asset)?.uri : asset;
    if (!family || !uri) throw new Error(`No font file for ${family ?? script}.`);
    const face = Skia.Typeface.MakeFreeTypeFaceFromData(await Skia.Data.fromURI(uri));
    if (!face) throw new Error(`Skia could not read ${family}.`);
    fonts.registerFont(face, family);
  }
  registered.add(script);
}

registerFontTarget({
  has: (script) => registered.has(script),
  load: async (scripts) => { for (const s of scripts) if (!registered.has(s)) await loadScript(s); },
});

export interface ShapedText { x: number; y: number; text: string; size: number; color: string; bold?: boolean; align?: 'left' | 'center' }

/**
 * Draws one line of non-Latin text as a shaped paragraph. Returns false when the fonts are not ready yet
 * (loading starts, and the canvas draws again when it ends), so the caller can draw it the plain way meanwhile.
 * `p.y` is the top of the line, like the display list; the paragraph is moved so its baseline lands where the
 * plain path puts it, which keeps Latin and Indic lines level.
 */
export function drawShapedText(canvas: SkCanvas, p: ShapedText): boolean {
  const scripts = nonLatinScripts(p.text);
  if (scripts.length === 0) return false;
  if (!provider || !scripts.every((s) => registered.has(s))) {
    void ensureTextFonts(p.text);
    return false;
  }
  const families = [...textFontFamilies(p.text, p.bold ? 'semibold' : 'regular'), 'sans-serif'];
  const builder = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Left }, provider);
  builder.pushStyle({ color: Skia.Color(p.color), fontFamilies: families, fontSize: p.size }).addText(p.text).pop();
  const paragraph = builder.build();
  paragraph.layout(10_000);
  const width = p.align === 'center' ? paragraph.getMaxIntrinsicWidth() : 0;
  const baseline = paragraph.getLineMetrics()[0]?.baseline ?? p.size * 0.82;
  paragraph.paint(canvas, p.x - width / 2, p.y + p.size * 0.82 - baseline);
  return true;
}

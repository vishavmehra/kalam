/**
 * Kalam design system — import everything shell-related from `@/design`.
 *
 * Theme: `ThemeProvider`, `useKalamTheme()` (colours/spacing/radius/touchTarget/fontScale),
 * `useReducedMotion()` (user setting overrides OS), `useBreakpoint()`.
 * Never hardcode colours; generated apps use their own KalamSpec theme, not this one.
 */
export * from './tokens';
export { fontAssets, fontFamily, type FontWeightName } from './typography';
export { ThemeProvider, useKalamTheme, useReducedMotion, useBreakpoint, type KalamTheme, type ThemeSettings, type Breakpoint } from './theme';
export { contrastRatio, luminance, readableOn, safeColor, withAlpha } from './color';
export { webData } from './web';
export { usePresence } from './presence';
/** `announce('Shelf')`: screen-reader message without moving focus (web live region / Android). */
export { announce } from './announce';

/** `<Text variant="h1" tone="secondary" weight="semibold" numeric />` */
export { Text, type TextProps, type TextTone } from './Text';
/** `<Button label="Save changes" variant="primary|secondary|outline|ghost|destructive|link" icon={Save} loading />`
 *  `<IconButton icon={X} label="Close" onPress={…} />` (label is required — it is the accessible name) */
export { Button, IconButton, type ButtonProps, type ButtonVariant, type ButtonSize, type IconButtonProps } from './Button';
/** `<Surface tone="surface|alt|paper|primarySoft|accentSoft" bordered elevation={1} padded />` */
export { Surface, type SurfaceProps } from './Surface';
/** `<Chip label="Saved" tone="success" icon={Check} />`, or selectable: `<Chip label="Hindi" selected onPress />`.
 *  `<SourceBadge source="on_device|cloud|deterministic|offline" size="sm|md" />` — icon + text, never colour only. */
export { Chip, SourceBadge, explainSource, type ChipProps, type ChipTone, type SourceBadgeProps, type ExecutionSource } from './Chip';
/** `<TextField label="App name" value onChangeText error helper icon={Search} labelHidden />` */
export { TextField, type TextFieldProps } from './TextField';
/** `<Sheet visible title onClose footer>…</Sheet>` — bottom sheet on phones, centred dialog ≥1024px.
 *  `<ConfirmSheet visible title message confirmLabel destructive onConfirm onCancel />` */
export { Sheet, ConfirmSheet, type SheetProps, type ConfirmSheetProps } from './Sheet';
/** `<Menu visible title items={[{key,label,icon,onSelect,destructive}]} anchor={rect} onClose />` */
export { Menu, type MenuItem, type MenuAnchor, type MenuProps } from './Menu';
/** Mount `<ToastProvider>` once (root layout); then `useToast().show({ message, tone, action })`. */
export { ToastProvider, useToast, type ToastOptions, type ToastTone } from './Toast';
/** `<Screen maxWidth={900} scroll safeTop>…</Screen>` page scaffold with responsive gutters. */
export { Screen, type ScreenProps } from './Screen';
/** `<EmptyState title description action={<Button …/>} illustration={…} />` */
export { EmptyState, type EmptyStateProps } from './EmptyState';
/** `<Logo size={32} wordmark variant="mark|tile" />` — broad-nib K mark + Fraunces wordmark. */
export { Logo, LOGO_PATHS, type LogoProps } from './Logo';
/** `<SegmentedControl label options={[{value,label,icon}]} value onChange />` (radio group). */
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './SegmentedControl';
/** `<SwitchRow label description value onValueChange icon />` (role switch, whole row toggles). */
export { SwitchRow, type SwitchRowProps } from './SwitchRow';
/** `<InkUnderline width={40} />` — hand-drawn underline marking a current selection. */
export { InkUnderline } from './InkUnderline';
/** `<PageIllustration width={132} />`: blank notebook page with a pen loop, for not-found / empty states. */
export { PageIllustration } from './PageIllustration';
/** `<AppIconTile icon={spec.icon} appColor={spec.theme.primary} size={48} />`, `GLYPH_ICONS[glyph]`. */
export { AppIconTile, GLYPH_ICONS, type AppIconTileProps } from './AppGlyph';

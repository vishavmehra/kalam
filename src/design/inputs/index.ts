/**
 * Shell form controls and the Tooltip (docs/02 §10.2, §10.7). Mounted from src/design/index.ts with
 * `export * from './inputs';`.
 */
/** `<Select label options={[{value,label}]} value onChange placeholder error />` (browser select on web, option sheet on phones). */
export { Select, type SelectOption, type SelectProps } from './Select';
/** `<Checkbox label description checked={true|false|'mixed'} onChange error />` */
export { Checkbox, type CheckboxProps } from './Checkbox';
/** `<RadioGroup label options={[{value,label,description}]} value onChange direction="column|row" error />` (arrow keys on web). */
export { RadioGroup, type RadioGroupProps, type RadioOption } from './RadioGroup';
/** `<NumberInput label value onChange min max step decimals error />` (value is null until valid and in range). */
export { NumberInput, type NumberInputProps } from './NumberInput';
/** `<DateInput label value="2026-11-25" onChange min max error />` (browser date input on web, typed date plus Today on phones). */
export { DateInput, type DateInputProps } from './DateInput';
/** `<Tooltip label="Add screen"><IconButton … /></Tooltip>` (web hover and focus hint; renders the child unchanged on phones). */
export { Tooltip, type TooltipProps } from '../Tooltip';
/** Arrow-key navigation for tablists: `const r = useRovingFocus({ count, current, onMove })`, then `<Pressable role="tab" {...r.itemProps(i)} />`. */
export { useRovingFocus, type RovingOptions } from './roving';
/** `{...spaceToggles(fn)}`: Space activates role checkbox, radio, switch and tab on the web (react-native-web only maps Enter). */
export { spaceToggles } from './shared';

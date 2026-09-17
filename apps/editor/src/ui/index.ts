/** Sonobe widget kit. Import styles once via the theme (tokens.css, base.css); widgets import their own CSS. */

export { Badge, type BadgeProps, type BadgeTone } from "./Badge.tsx";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button.tsx";
export { Checkbox, Toggle, type CheckboxProps, type ToggleProps } from "./Toggle.tsx";
export { ColorField, type ColorFieldProps } from "./ColorField.tsx";
export { ColorPicker, DEFAULT_SWATCHES, type ColorPickerProps } from "./ColorPicker.tsx";
export { CommandPalette, type CommandPaletteProps } from "./CommandPalette.tsx";
export { ContextMenu, Menu, MenuList, useContextMenu, type ContextMenuProps, type MenuCloseReason, type MenuEntry, type MenuItemEntry, type MenuListProps, type MenuProps } from "./Menu.tsx";
export { Dialog, type DialogProps } from "./Dialog.tsx";
export { EmptyState, type EmptyStateProps } from "./EmptyState.tsx";
export { IconButton, type IconButtonProps } from "./IconButton.tsx";
export { Kbd, type KbdProps } from "./Kbd.tsx";
export { Popover, type PopoverProps } from "./Popover.tsx";
export { Portal, type PortalProps } from "./Portal.tsx";
export { PortGlyph, VALUE_TYPE_LABELS, type PortGlyphProps } from "./PortGlyph.tsx";
export { ScrubNumberField, type NumberChangeMeta, type ScrubNumberFieldProps } from "./ScrubNumberField.tsx";
export { HighlightedText, SearchList, type SearchListProps, type SearchListRenderContext } from "./SearchList.tsx";
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from "./SegmentedControl.tsx";
export { Select, type SelectOption, type SelectProps } from "./Select.tsx";
export { Splitter, type SplitterProps } from "./Splitter.tsx";
export { TabPanel, Tabs, tabId, tabPanelId, type TabItem, type TabPanelProps, type TabsProps } from "./Tabs.tsx";
export { TextArea, TextField, type TextAreaProps, type TextFieldProps } from "./TextField.tsx";
export { Toaster, dismissToast, readingDuration, toast, type ToastOptions, type ToastTone, type ToasterProps } from "./Toast.tsx";
export { Tooltip, type TooltipProps } from "./Tooltip.tsx";
export { TreeView, type TreeRowState, type TreeViewProps } from "./TreeView.tsx";
export { VectorField, type VectorFieldProps } from "./VectorField.tsx";

export {
  CommandProvider,
  useCommandList,
  useCommands,
  useOptionalCommands,
  usePlatform,
  useRegisterCommands,
  useShortcut,
  type CommandProviderProps,
  type CommandsContextValue,
} from "./commands/CommandProvider.tsx";
export { CommandRegistry, type Command, type CommandContext, type CommandRegistryOptions } from "./commands/commandRegistry.ts";
export {
  KeyboardShortcutManager,
  SCOPE_ATTRIBUTE,
  detectPlatform,
  formatShortcut,
  formatShortcutLabel,
  isEditableTarget,
  matchesChord,
  parseShortcut,
  type KeyChord,
  type Platform,
  type ShortcutBinding,
  type ShortcutScope,
} from "./commands/shortcutManager.ts";

export * from "./lib/colorMath.ts";
export { fuzzyMatch, fuzzySearch, highlightSegments, type FieldMatch, type FuzzyKey, type FuzzyMatch, type FuzzyResult } from "./lib/fuzzy.ts";
export { computePosition, type Placement, type Rect, type Side } from "./lib/position.ts";
export {
  createScrubSession,
  formatNumber,
  nudgeValue,
  parseNumberInput,
  stepMultiplier,
  type ModifierState,
  type ScrubSession,
} from "./lib/scrubMath.ts";
export { readJSON, readString, writeJSON, writeString } from "./lib/storage.ts";
export { flattenTree, moveTreeNodes, placementFromOffset, resolveDropTarget, type DropPlacement, type FlatTreeRow, type TreeDropTarget } from "./lib/treeModel.ts";
export { cx } from "./lib/cx.ts";

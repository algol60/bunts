/**
 * Colours shared by the Marks list and the Edit Mark pane.
 *
 * Every value here is an RGBA hex on PANE_BACKGROUND, chosen to stay legible
 * against it: white text is 14.6:1, HIGHLIGHT_BACKGROUND text 12:1.
 */

/** Resting surface for both panes, their fields, and their rows. */
export const PANE_BACKGROUND = '#1e293b'

/**
 * The 'active' surface: a text field while it holds focus, and the selected
 * mark's row in the list.
 *
 * A pane cannot use this directly. Only Textarea/Input renderables accept a
 * focused background - BoxRenderable has no such option, just a
 * focusedBorderColor - so the focus highlight has to live on the fields. The
 * list rows are boxes and set it imperatively instead.
 */
export const HIGHLIGHT_BACKGROUND = '#2d3748'

/**
 * Placeholder hint text, 5.7:1 on PANE_BACKGROUND. The library default of
 * #666666 is only 2.55:1 there and reads as almost invisible.
 */
export const PLACEHOLDER_COLOR = '#94a3b8'

/** Text of the selected mark's row. */
export const MARK_SELECTED_FG = '#00ff00'

/** Text of every other mark. */
export const MARK_FG = '#ffffff'

/** Text of a field that failed validation. */
export const ERROR_FG = '#ff8080'

/** Text of a field that passed validation. */
export const FIELD_FG = '#ffffff'

/** Warnings and transient status messages, e.g. entries skipped while loading. */
export const WARNING_FG = '#fbbf24'

/**
 * No surface of its own, so whatever was painted earlier stays visible.
 *
 * The Marks pane draws its backdrop image first, then the list on top of it,
 * which only works while the scroll box and its rows are transparent - an
 * opaque PANE_BACKGROUND anywhere in that chain would paint over the image.
 */
export const TRANSPARENT_BACKGROUND = 'transparent'

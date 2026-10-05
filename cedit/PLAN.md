# Plan: cedit - Terminal JSON Editor for marks

## Overview
Create a terminal-based editor for JSON files containing a "marks" array, where each mark is either type "this" (single 4-char uppercase alphanumeric string) or type "that" (list of "WORDA:WORDB" pairs with uppercase letters, dots, underscores). Built with Bun + TypeScript + @opentui/core.

## Requirements
- Edit entries in `marks` list; preserve all other JSON keys/values unchanged
- Operations: add (this/that), delete, rename label
- For type "this": edit data string (must be exactly 4 chars, uppercase ASCII letters/digits)
- For type "that": edit list - add/delete/edit individual elements (each element format: `WORDA:WORDB`, words contain uppercase ASCII letters, `.`, `_`)
- Highlight errors if data is incorrect
- UI actions: Esc finishes; unsaved changes raise a "Save Y/N" dialog (Y saves and exits, N discards and exits)
- File path from args; default `$HOME/cedit.json`; if file doesn't exist, start with empty `marks` list

## Design

### Architecture
- Use @opentui/core (imperative renderables) - aligns with quickstart style
- Entry point: `src/index.ts` (or `index.ts`) - parse CLI args, load file, start renderer
- Data model: TypeScript types for Mark, validation functions
- UI: Split view - list of marks (left/sidebar) + edit form (right/main) + status bar with actions
- State management: In-memory representation of the full JSON + dirty flag + validation errors

### Data structures
```typescript
type MarkThis = {
  type: "this";
  label: string;
  data: string; // 4 chars, A-Z0-9
};

type MarkThat = {
  type: "that";
  label: string;
  data: string[]; // each "WORDA:WORDB", chars A-Z . _
};

type Mark = MarkThis | MarkThat;

type MarksFile = {
  [key: string]: any;
  marks: Mark[];
};
```

### Validation
- Type "this" data: regex `/^[A-Z0-9]{4}$/`
- Type "that" element: regex `/^[A-Z._]+:[A-Z._]+$/` (non-empty both sides as per spec)
- Highlight errors in the data input fields when invalid

### UI Components (OpenTUI)
- Renderer root with Box layout (vertical: main content + footer/actions)
- Header/status line showing filename, modified state
- Main area: horizontal split
  - Left: ScrollBox listing marks (show label + type). Selectable, supports up/down navigation
  - Right: Form area (Box + Input/Textarea equivalents) for editing selected mark
    - Label input (Input)
    - Type selector/display (maybe Select or toggle)
    - For "this": data Input (4 chars)
    - For "that": list editor - ScrollBox of Inputs for each element + Add/Delete buttons
- Footer: action keys - Esc Finish, plus the editing keys below

### File operations
- Read: if path not provided, use `process.env.HOME + '/cedit.json'`. If file doesn't exist, initialize `{ marks: [] }`
- Write: serialize with JSON.stringify (preserve existing structure, only modify marks array)
- Atomic-ish: write to temp then rename? Or just write - for this scope, direct write is fine

### Navigation & UX
- Tab to move between the list and editor panes; Up/Down to move within a pane
- Enter to confirm edits in inputs
- Delete key to delete selected mark
- 'a' to add new mark (maybe prompt type choice? or show add menu)
- Visual error indicators (red text/background on invalid fields)

### Implementation details
- CLI: `bun src/index.ts [path]` 
- Use @opentui/core renderables: Box, Text, Input, ScrollBox, Select (if available) as per docs
- Keyboard handling via `renderer.keyInput.on('keypress', ...)` and component key bindings
- Dirty tracking: compare current marks array to original

## Implementation Steps

1. **Setup project** (if not exists) - already in /home/frogger/cedit, but need proper structure
   - Create `src/` directory
   - Create `package.json` with type=module, scripts (start, build if needed)
   - Install deps: bun add @opentui/core (already present globally? check)

2. **Data layer**
   - `src/types.ts` - type definitions
   - `src/validation.ts` - validation functions + error messages
   - `src/file.ts` - load/save JSON with preservation logic

3. **Core app state**
   - `src/state.ts` - AppState class or object to track: originalData, currentMarks, selectedIndex, dirty, errors, filePath

4. **UI components**
   - `src/ui/app.ts` - main App class that sets up renderer, layout, components
   - `src/ui/marks-list.ts` - list view
   - `src/ui/mark-editor.ts` - editor form for selected mark

5. **Main entry**
   - `src/index.ts` - CLI parsing, initialization, error handling

6. **Testing/validation**
   - Test with sample.json
   - Verify preservation of other fields if added
   - Test all operations

## File structure
```
cedit/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── validation.ts
│   ├── file.ts
│   ├── state.ts
│   └── ui/
│       ├── app.ts
│       └── ... 
├── package.json
├── prompt.md
├── sample.json
├── PLAN.md
└── tsconfig.json
```

## Key bindings
Bindings are per-pane, and each pane only reacts in its own focus mode. Bare keys
(a/o/d) are ignored when Ctrl/Meta/Super is held, so Ctrl+A and Ctrl+D cannot
reach them.

In the marks list:
- Up/Down: navigate marks list
- Ctrl+Up/Down: reorder the selected mark
- a: add a "this" mark, o: add a "that" mark (shift+a / shift+o also work)
- d: delete the selected mark

In the editor pane (Up/Down: move between label, data and elements):
- Tab: return to the marks list
- Ctrl+Up/Down: reorder the selected "that" element
- Ctrl+A: append an element to the selected "that" mark
- Ctrl+D: delete the focused element, or the last element if focus is elsewhere.
  A "that" mark always keeps at least one element; deleting the last one is refused
- The add/delete element commands are advertised in the footer only while a "that"
  mark is selected, which is the only place they apply

From either pane and from inside a field:
- Esc: finish editing
  - clean document: exits immediately
  - modified document: opens the Save Y/N dialog, and only Y writes the file
  - in the dialog: Y saves and exits, N (or Esc again) exits without saving; nothing else is accepted

## Notes
- Use Core API (not React) per "bun, TypeScript, and @opentui/core" - imperative renderables as shown in quickstart
- Ensure we handle terminal cleanup on exit (renderer.destroy())
- Validation errors should be visually distinct (red color) on the specific field

## Validation rules (explicit)
- "this".data: length === 4, every char in [A-Z0-9] only
- "that".data elements: non-empty strings matching /[A-Z._]+:[A-Z._]+/ - both sides non-empty

## Input casing
- Data fields are upper case only, so letters are folded to upper case as they are entered (keystrokes and paste). Labels are free-form and keep their case.
- Folding happens at insertion time, never by reassigning `value`: the `value` setter re-runs `setText`, which moves the caret to the end of the field and re-emits `input`.
- Only newly entered characters are folded. Lower case already present in the file is shown and validated as-is.

## UI Layout sketch
```
┌─ cedit: sample.json [modified] ─────────────────────┐
│ [Marks]           │ [Edit Mark]                    │
│ > First example   │ Label: [First example____]    │
│   Second example  │ Type:  this                   │
│   That example 1  │ Data:  [ABC6___]              │
│   Example that 2  │                               │
│                   │                               │
├─────────────────────────────────────────────────────┤
│ Esc Finish | Tab Pane | Up/Dn Select | a/o Add | ...│
└─────────────────────────────────────────────────────┘
```
For "that" type, the Data section becomes a scrollable list of element inputs and
nothing else - the add/delete commands are keys (Ctrl+A / Ctrl+D), advertised in
the footer while a "that" mark is selected rather than drawn as a button that
cannot be clicked. The footer is a single row and its hints change with focus and
with the selected mark's type.

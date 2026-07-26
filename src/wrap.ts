import { CliRenderer, BoxRenderable, SelectRenderable, TextRenderable, createCliRenderer, type KeyEvent, type SelectOption } from '@opentui/core'
import { element } from 'effect/Schema';
import fs from 'node:fs';

const renderer = await createCliRenderer({
  exitOnCtrlC: false
})
const focusableElements: SelectRenderable[] = []
let currentFocusIndex = 0

function updateFocus(): void {
  focusableElements.forEach((element, i) => {
    if (i === currentFocusIndex) {
      element.focus()
    } else {
      element.blur()
    }})
  }
  // focusableBoxes.forEach((box) => {
  //   if (box) box.blur()
  // })

  // if (focusableElements[currentFocusIndex] && focusableElements.length>currentFocusIndex) {
  //   focusableElements[currentFocusIndex].focus()
  // }
  // if (focusableBoxes[currentFocusIndex]) {
  //   focusableBoxes[currentFocusIndex]!.focus()
  // }


function handleKeyPress(key: KeyEvent) {
  if (key.name === 'tab') {
    if (key.shift) {
      currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) % focusableElements.length
    } else {
      currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length
    }
    updateFocus()
    return
  } else if (key.name === 'return') {
    renderer.destroy()
  } else if (key.name === 'escape') {
    renderer.destroy()
  } else if (key.name === '`') {
      renderer.console.toggle()
  } else if (key.name === ".") {
    renderer.toggleDebugOverlay()
  } else {
    console.log(`Ignored key "${key.name}"`)
  }
}

function createLayout(renderer: CliRenderer, selectOptions: SelectOption[], sizeOptions: SelectOption[]) {
  renderer.setBackgroundColor('#001122')

  const headerBox = new BoxRenderable(renderer, {
    id: "header-box",
    zIndex: 0,
    width: "auto",
    height: 3,
    backgroundColor: "#3b82f6",
    borderStyle: "single",
    borderColor: "#2563eb",
    flexGrow: 0,
    flexShrink: 0,
    border: true,
  })

  const header = new TextRenderable(renderer, {
    id: "header",
    content: "WRAPPER " + import.meta.url,
    fg: "#ffffff",
    bg: "transparent",
    zIndex: 1,
    flexGrow: 1,
    flexShrink: 1,
  })

  headerBox.add(header)

  const selectContainerBox = new BoxRenderable(renderer, {
    id: "select-container-box",
    zIndex: 0,
    width: "auto",
    height: "auto",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 10,
    backgroundColor: "#1e293b",
    borderStyle: "single",
    borderColor: "#475569",
    border: true,
  })

  const selectContainer = new BoxRenderable(renderer, {
    id: "select-container",
    zIndex: 1,
    width: "auto",
    height: "auto",
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
  })

  selectContainerBox.add(selectContainer)

  const leftSelectBox = new BoxRenderable(renderer, {
    id: "color-select-box",
    zIndex: 0,
    width: "auto",
    height: "auto",
    minHeight: 8,
    borderStyle: "single",
    borderColor: "#475569",
    focusedBorderColor: "#3b82f6",
    title: "Color Selection",
    titleAlignment: "center",
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: "transparent",
    border: true,
  })

  const leftSelect = new SelectRenderable(renderer, {
    id: "color-select",
    zIndex: 1,
    width: "auto",
    height: "auto",
    minHeight: 6,
    options: selectOptions,
    backgroundColor: "#1e293b",
    focusedBackgroundColor: "#2d3748",
    textColor: "#e2e8f0",
    focusedTextColor: "#f7fafc",
    selectedBackgroundColor: "#3b82f6",
    selectedTextColor: "#ffffff",
    descriptionColor: "#94a3b8",
    selectedDescriptionColor: "#cbd5e1",
    showScrollIndicator: true,
    wrapSelection: true,
    showDescription: true,
    flexGrow: 1,
    flexShrink: 1,
  })

  leftSelectBox.add(leftSelect)

  const rightSelectBox = new BoxRenderable(renderer, {
    id: "size-select-box",
    zIndex: 0,
    width: "auto",
    height: "auto",
    minHeight: 8,
    borderStyle: "single",
    borderColor: "#475569",
    focusedBorderColor: "#059669",
    title: "Size Selection",
    titleAlignment: "center",
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: "transparent",
    border: true,
  })

  const rightSelect = new SelectRenderable(renderer, {
    id: "size-select",
    zIndex: 1,
    width: "auto",
    height: "auto",
    minHeight: 6,
    options: sizeOptions,
    backgroundColor: "#1e293b",
    focusedBackgroundColor: "#2d3748",
    textColor: "#e2e8f0",
    focusedTextColor: "#f7fafc",
    selectedBackgroundColor: "#059669",
    selectedTextColor: "#ffffff",
    descriptionColor: "#94a3b8",
    selectedDescriptionColor: "#cbd5e1",
    showScrollIndicator: true,
    wrapSelection: true,
    showDescription: true,
    flexGrow: 1,
    flexShrink: 1,
  })

  rightSelectBox.add(rightSelect)

  const footerBox = new BoxRenderable(renderer, {
    id: "footer-box",
    zIndex: 0,
    width: "auto",
    height: 3,
    backgroundColor: "#1e40af",
    borderStyle: "single",
    borderColor: "#1d4ed8",
    flexGrow: 0,
    flexShrink: 0,
    border: true,
  })

  const footer = new TextRenderable(renderer, {
    id: "footer",
    content: "TAB: focus next | SHIFT+TAB: focus prev | ARROWS/JK: navigate | ESC: quit",
    fg: "#dbeafe",
    bg: "transparent",
    zIndex: 1,
    flexGrow: 1,
    flexShrink: 1,
  })

  footerBox.add(footer)

  selectContainer.add(leftSelectBox)
  selectContainer.add(rightSelectBox)

  renderer.root.add(headerBox)
  renderer.root.add(selectContainerBox)
  // renderer.root.add(inputContainerBox)
  renderer.root.add(footerBox)

  focusableElements.push(leftSelect, rightSelect)
  updateFocus();
}

interface Thing {
  label: string
  descr: string
  url: string
}

interface Things {
  things: Thing[];
}
function readConfig(configPath: string): Thing[] {
  const data: Thing[] = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return data
}

async function main() {
  const configPath = `${import.meta.dirname}/wrap.json`
  const config: Thing[] = readConfig(configPath)
  console.log(config)
  const selectOptions: SelectOption[] = config.map((value: Thing) => ({
    name: value.label,
    description: value.descr,
    value: value.url
  }))

  const sizeOptions: SelectOption[] = [
    {name: 'One', description: '111', value: 'value1'},
    {name: 'Two', description: '222', value: 'value2'}
  ]

  // const renderer = await createCliRenderer({
  //   exitOnCtrlC: true,
  //   targetFps: 30,
  // })
  renderer.keyInput.on('keypress', handleKeyPress)

  createLayout(renderer, selectOptions, sizeOptions)

  renderer.on('destroy', () => {
    console.log(import.meta.dir)
    console.log(import.meta.url)
  })
}

console.log(import.meta.dirname)
try {
  await main()
} catch (error) {
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ENOENT') {
      console.log(`Error: ${error.message}`)
    } else {
      console.log(`Unexpected error: ${error}`)
    }
  } else {
    console.log(`Unexpected problem: ${error}`)
  }
}

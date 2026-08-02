import { BoxRenderable, KeyEvent, Select, SelectRenderable, SelectRenderableEvents, Text, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

// const panels = {
//   home: Box({ flexGrow: 1, padding: 1, backgroundColor: '#ff0000' }, Text({ content: "Home content here" })),
//   files: Box({ flexGrow: 1, padding: 1, backgroundColor: '#00ff00' }, Text({ content: "File browser here" })),
//   settings: Box({ flexGrow: 1, padding: 1, backgroundColor: '#0000ff' }, Text({ content: "Settings form here" })),
// }

const panels = {
  home: new BoxRenderable(renderer, { flexGrow: 1, padding: 1, backgroundColor: '#ff0000' }),
  files: new BoxRenderable(renderer, { flexGrow: 1, padding: 1, backgroundColor: '#00ff00' }),
  settings: new BoxRenderable(renderer, { flexGrow: 1, padding: 1, backgroundColor: '#0000ff' }),
}

// const container = Box({
//   // width: 60,
//   flexGrow: 1,
//   height: 20,
//   borderColor: '#ffffff',
//   borderStyle: "rounded",
// })

class KSelectRenderable extends SelectRenderable {
  override handleKeyPress(key: KeyEvent): boolean {
    const handled = super.handleKeyPress(key)

    console.log(`keyname ${key.name}`)
    if (key.name === 'tab') {
      submenu.focus()
      return true
    }

    return handled
  }
}

const menu = new KSelectRenderable(renderer, {
  width: 30,
  height: 8,
  showDescription: false,
  options: [
    { name: "Home", description: "First option" },
    { name: "Files", description: "Second option" },
    { name: "Settings", description: "Third option" },
  ],
})

const submenu = new SelectRenderable(renderer, {
  width: 30,
  height: 8,
  showDescription: false,
  options: [
    { name: "Homex", description: "First option" },
    { name: "Filesx", description: "Second option" },
    { name: "Settingsx", description: "Third option" },
  ],
})

panels.home.add(submenu)
// panels.files.add(submenu)
// panels.settings.add(submenu)

let currentPanel = panels.home
const contentArea = new BoxRenderable(renderer, {
  flexGrow: 1,
  // padding: 1,
  borderColor: '#ffffff',
  borderStyle: "rounded",
})
contentArea.add(currentPanel)

menu.on(SelectRenderableEvents.SELECTION_CHANGED, (index, option) => {
  // Remove current panel
  if (currentPanel) {
    contentArea.remove(currentPanel)
  }

  console.log(`name=${option.name}`)
  // Add new panel based on selection
  switch (option.name) {
    case "Home":
      console.log('home')
      currentPanel = panels.home
      break
    case "Files":
      console.log('files')
      currentPanel = panels.files
      break
    case "Settings":
      console.log('settings')
      currentPanel = panels.settings
      break
    default:
      currentPanel = panels.files
  }
  contentArea.add(currentPanel)
  // submenu.focus()
})

// menu.handleKeyPress((key: KeyEvent) => {})

menu.focus()
renderer.root.add(menu)
renderer.root.add(contentArea)

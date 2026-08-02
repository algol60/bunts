import { Box, Text, TabSelect, createCliRenderer, TabSelectRenderableEvents, BaseRenderable, BoxRenderable } from "@opentui/core"

const renderer = await createCliRenderer({
  useMouse: true,
  enableMouseMovement: true,
})
// renderer.start()

// renderer.toggleDebugOverlay()
// console.log('started')

// Create content panels
// const panels = {
//   home: Box({ id: 'home', padding: 1 }, Text({ content: "Home content here" })),
//   files: Box({ id: 'files', padding: 1 }, Text({ content: "File browser here" })),
//   settings: Box({ id: 'settings', padding: 1 }, Text({ content: "Settings form here" })),
// }

const panels = {
  home: new BoxRenderable(renderer, { flexGrow: 1, padding: 1, backgroundColor: '#ff0000' }),
  files: new BoxRenderable(renderer, { flexGrow: 1, padding: 1, backgroundColor: '#00ff00' }),
  settings: new BoxRenderable(renderer, { flexGrow: 1, padding: 1, backgroundColor: '#0000ff' }),
}

// Create the tabbed container
const container = Box({
  flexGrow: 1,
//   width: 60,
  height: 20,
  borderStyle: "rounded",
})

const tabs = TabSelect({
//   width: 60,
  tabWidth: 20,
  options: [
    { name: "Home", description: "Dashboard" },
    { name: "Files", description: "Browse files" },
    { name: "Settings", description: "Preferences" },
    // { name: "Settings2", description: "Preferences2" },
    // { name: "Settings3", description: "Preferences3" },
    // { name: "Settings4", description: "Preferences4" },
  ]
})

// Content area
let currentPanel = panels.home
const contentArea = Box({
  flexGrow: 1,
  padding: 1,
})
contentArea.add(currentPanel)

// Handle tab changes
tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (index, option) => {
  // Remove current panel
  if (currentPanel) {
    console.log(currentPanel)
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
  currentPanel.focus()
})

container.add(tabs)
container.add(contentArea)

tabs.focus()
renderer.root.add(container)
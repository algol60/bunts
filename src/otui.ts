import { Box, Input, ScrollBox, Select, Text, TextareaRenderable, RGBA, createCliRenderer } from '@opentui/core'

const inp = Input({width: 25, placeholder: 'Something here'})

async function spawn() {
  const cmd = inp.value
  const proc = Bun.spawn([cmd], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
})
  const exitCode = await proc.exited;
  process.exit(exitCode || 0)
}

const renderer = await createCliRenderer({
  useMouse: true,
  clearOnShutdown: true,
  onDestroy: () => {
    console.log("Renderer destroyed, performing additional cleanup...")
    spawn()
  },
})

const menu = Select({
  width: 30,
  height: 8,
  options: [
    { name: "Option 1", description: "First option" },
    { name: "Option 2", description: "Second option" },
    { name: "Option 3", description: "Third option" },
    { name: "Option 4", description: "First option" },
    { name: "Option 5", description: "" },
    { name: "Option 6", description: "Third option" },
  ],
})

const scrollbox = ScrollBox({
  id: "scrollbox",
  width: 40,
  // height: 20,
}, menu)

const container = Box({
  id: "container",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  height: 10,
})

// const leftPanel = Box({
//   id: "left",
//   flexGrow: 1,
//   height: 10,
//   backgroundColor: "#444",
// }, scrollbox)

const rightPanel = new TextareaRenderable(renderer, {
  id: "right",
  flexGrow: 1,
  // width: 20,
  height: 10,
  backgroundColor: "#666",
})

const text = Text({content: ' Submit ', fg: '#000000', bg: '#ffff00', onMouseUp: () => {
  text.bg = RGBA.fromHex('#FF0000')
  renderer.triggerNotification('text')
}})
const button = Box({
  padding: 0,
  backgroundColor: "#333300",
  borderColor: "#555555",
  borderStyle: "single",
  onMouseDown(event) {
    button.borderColor = RGBA.fromHex('#0000ff')
  },
  onMouseUp: (event) => {
    button.borderColor = RGBA.fromHex('#00ff00')
  }
}, text)

button.on('focus', () => {
  button.backgroundColor = RGBA.fromHex('#0000ff')
  // buttonText.setStyle({ fg: "#000000" });
  // text.content = 'Gone'
  renderer.triggerNotification('button')
})

text.on('click', () => {
  text.bg = RGBA.fromHex('#FF0000')
})
  // renderer.destroy()

scrollbox.focus()
container.add(scrollbox)
container.add(rightPanel)
// container.add(button)
renderer.root.add(container)
renderer.root.add(inp)
renderer.root.add(button)
renderer.triggerNotification('plugh')
inp.focus()

// renderer.on("destroy", () => {
//   renderer.destroy()
//   console.log("Renderer destroyed")
// })

  // renderer.destroy()
console.log('Goodbye.')

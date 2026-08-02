import { Box, Input, ScrollBox, Select, TextRenderable, TextareaRenderable, RGBA, createCliRenderer, BoxRenderable, InputRenderable, StyledText, KeyEvent } from '@opentui/core'

const renderer = await createCliRenderer({
  useMouse: true,
  enableMouseMovement: true,
  autoFocus: true,
  exitOnCtrlC: true,
  clearOnShutdown: true,
  onDestroy: () => {
    console.log("Renderer destroyed, performing additional cleanup...")
    // spawn()
  },
})

const label = new TextRenderable(renderer, {
    content: 'xyzzy'
})

renderer.keyInput.on("keypress", (key: KeyEvent) => {
  label.content = `${key.shift} ${key.name} ${key.sequence}`
  console.log("Key name:", key.name)
  console.log("Input sequence:", key.sequence)
  console.log("Raw input:", key.raw)
  console.log("Ctrl pressed:", key.ctrl)
  console.log("Shift pressed:", key.shift)
  console.log("Alt pressed:", key.meta)
  console.log("Option pressed:", key.option)
})

const inp1 = new InputRenderable(renderer, {
  width: 25,
  placeholder: 'Something here'
})
inp1.focus()
const inp2 = new InputRenderable(renderer, {
  width: 25,
  placeholder: 'Something else here'
})

const text = new TextRenderable(renderer, {
  content: ' Submit ',
  fg: '#000000',
  bg: '#ffff00',
  onMouseUp: () => {
    text.bg = RGBA.fromHex('#FF0000')
    renderer.triggerNotification('text', 'Title')
  }
})
const button = new BoxRenderable(renderer, {
  padding: 0,
  backgroundColor: "#333300",
  borderColor: "#555555",
  borderStyle: "single",
  onMouseMove: (event) => {
      label.content = 'zxzx' + JSON.stringify(event)
  },
  onMouseDown: (event) => {
    button.borderColor = RGBA.fromHex('#0000ff')
  },
  onMouseUp: (event) => {
    button.borderColor = RGBA.fromHex('#00ff00')
  }
})

button.on('click', (event) => {
    renderer.triggerNotification('button')
})

button.add(text)

renderer.root.add(label)
renderer.root.add(inp1)
renderer.root.add(inp2)
renderer.root.add(button)

import { ImageRenderable, createCliRenderer } from "@opentui/core"
// @ts-ignore
import icon from './Opus-small.jpg' with { type: 'file' }

console.log(`${import.meta.path} ${import.meta.dir} ${import.meta.file}`)
console.log(icon)
console.log(Bun.file(icon))

const renderer = await createCliRenderer()
const image = new ImageRenderable(renderer, {
  id: "cover",
  source: Bun.file(icon),
  width: 8,
  height: 8,
  fit: "fit",
  protocol: "auto",
  onError: console.error,
})

renderer.root.add(image)
// await image.loadPromise
# core

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

This project was created using `bun create tui`. [create-tui](https://git.new/create-tui) is the easiest way to get started with OpenTUI.


## Adding type definitions

bun add -d @types/bun
bun add effect
bun add -d @effect/language-service

## tsconfig.json

    "plugins": [
      {
        "name": "@effect/language-service"
      }
    ],
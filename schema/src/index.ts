import { error } from 'console'
import { argon2Sync } from 'crypto'
import { readFileSync } from 'fs'
import { homedir } from 'os'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { z } from 'zod'

function readConfig() {
  const ZThing = z.object({
    label: z.string(),
    data: z.array(z.string())
  })
  const ZConfig = z.object({
    section1: z.array(ZThing)
  })

  const configFile = `${homedir()}/.config/config/config.jsonx`
  const j = readFileSync(configFile).toString()
  const c1 = JSON.parse(j)

  const parsed = ZConfig.safeParse(c1)
  if (parsed.success) {
    const config = parsed.data
    console.log(config)
    for (const thing of config.section1) {
      console.log(`* thing ${thing} ${thing.label}/${thing.data}`)
    }

    config.section1.forEach((thing) => {
      console.log(`& thing ${thing} ${thing.label}/${thing.data}`)
    })
  } else {
    console.log(`Error: ${parsed.error.issues}: ${typeof parsed.error}`)
    const pretty = z.prettifyError(parsed.error);
    console.log(pretty)
  }
}

function printArgs(argv: unknown) {
  console.log(`Args: ${JSON.stringify(argv)}`)
}

const VERSION = '0.0.1'
const args = yargs(hideBin(process.argv))
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", VERSION)
  .alias("version", "v")
  .command('serve', 'Serve a server')
  .command({
    command: 'scan',
    builder: (yargs: any) => yargs
    .option('file', {
      describe: 'A file to scan',
      type: 'string'
    }),
    handler: (argv: unknown) => {printArgs(argv)}
  })
  .command('*')
  .strict()
  .parseSync(hideBin(process.argv))

  console.log(JSON.stringify(args, null, 2))

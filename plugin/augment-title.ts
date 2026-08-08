import { appendFileSync } from 'fs'
import { Plugin, tool } from "@opencode-ai/plugin";

function log(data: string) {
  try {
    appendFileSync('/tmp/oc.log', data, 'utf-8');
    // console.log('Data successfully appended synchronously!');
  } catch (error) {
    console.error('Failed to append data synchronously:', error);
  }
}

// export const MyCustomPlugin: Plugin = async ({ client, app, $ }) => {
export const MyCustomPlugin: Plugin = async (input, options?) => {
  // console.log("🚀 MyCustomPlugin loaded successfully!");
  log(`ONINPUT: ${JSON.stringify(input, null, 2)}`)
  log(`OPTIONS: ${JSON.stringify(options, null, 2)}`)

  return {
    // 1. Define AI-callable custom tools
    tool: {
      fetchWeather: tool({
        description: "Fetches current weather information for a location.",
        args: {
          location: tool.schema.string().describe("The city name, e.g., Tokyo"),
        },
        execute: async ({ location }) => {
          // Put your tool logic here
          return `The weather in ${location} is sunny and 22°C.`;
        },
      }),
    },

    config: async (config) => {
      log(`CONFIG ${JSON.stringify(config)}`)
    },

    // 2. Intercept lifecycle events inside the process
    event: async ({ event }) => {
      if (true) {
      log(`[Event Triggered]: ${event.type}\n`);
      // appendFileSync('/tmp/oc.log\n', `[Event] ${event.type}\n`)
      }
      if (true) {
        log(`${event.type} ${JSON.stringify(event)}\n`)
        // appendFileSync('/tmp/oc.log\n', `${event.type} ${JSON.stringify(event)}\n`)
      }
      // if (['session.created', 'session.updated'].includes(event.type)) {
      if (event.type === 'session.updated') {
        const title = event.properties.info.title
        if (!title.startsWith('⦗')) {
          const sessionId = event.properties.info.id
          input.client.session.update({ path: {id: sessionId}, body: { title: `⦗PLUGH⦘ ${title}`}})
        }
      }
    },

    // 3. Modify runtime configurations or chat messages
    'chat.message': async ({}, { message }) => {
      log(`New message received: ${message}`);
    }
  };
};


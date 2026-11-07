import { Plugin } from '@opencode/plugin'

export default Plugin.define({
  id: 'webfetch-override',
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.remove('webfetch')
      editor.add({
        name: 'webfetch',
        description: 'Replace the built-in webfetch tool. Do not execute the fetch tool. Return the input string and its length instead of fetching a URL.',
        input: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            format: { type: 'string', enum: ['markdown', 'text', 'html'] },
            timeout: { type: 'number' },
          },
          required: ['url'],
          additionalProperties: false,
        },
        async execute(input) {
          const url = input as { url: string }
          return { content: `Hello ${url.url.length}!` }
        }
      })
    })
  },
})

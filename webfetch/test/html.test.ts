import { describe, expect, test } from "bun:test"
import { convertHTMLToMarkdown, extractTextFromHTML, MAX_MARKDOWN_BYTES } from "../src/lib/html.ts"

describe("convertHTMLToMarkdown", () => {
  test("renders headings and drops active content", () => {
    const html =
      "<h1>Hello</h1><script>bad()</script><p>world <strong>wide</strong> <product-name>today</product-name></p><style>.bad {}</style>"
    expect(convertHTMLToMarkdown(html)).toBe("# Hello\n\nworld **wide** today")
    expect(extractTextFromHTML(html)).toBe("Helloworld wide today")
  })

  test("renders inline semantics, links, images, breaks, and thematic breaks", () => {
    const html = `<h2>Read <em>this</em></h2><p><a href="https://example.com/a (b)" title="Example">docs</a><br><img src="diagram.png" alt="a ] b"></p><hr><p><del>old</del></p>`
    expect(convertHTMLToMarkdown(html)).toBe(
      `## Read *this*\n\n[docs](https://example.com/a%20\\(b\\) "Example")  \n![a \\] b](diagram.png)\n\n---\n\n~~old~~`,
    )
  })

  test("preserves code verbatim with safe fences", () => {
    const html = `<p>Use <code>say(\`hello\`)</code> now.</p><pre><code class="language-ts">const fence = \`\`\`\n&amp; stays decoded</code></pre>`
    expect(convertHTMLToMarkdown(html)).toBe(
      `Use \`\`say(\`hello\`)\`\` now.\n\n~~~ts\nconst fence = \`\`\`\n& stays decoded\n~~~`,
    )
  })

  test("keeps nested lists structurally readable", () => {
    const html = `<ol start="3"><li>alpha<ul><li>nested <strong>item</strong></li></ul></li><li><p>beta first</p><p>beta second</p></li></ol>`
    expect(convertHTMLToMarkdown(html)).toBe(
      `3. alpha\n\n   - nested **item**\n\n4. beta first\n\n   beta second`,
    )
  })

  test("renders blockquotes and tables", () => {
    const html = `<blockquote><p>quoted <em>text</em></p><ul><li>point</li></ul></blockquote><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>one</td><td><code>1</code></td></tr></tbody></table>`
    expect(convertHTMLToMarkdown(html)).toBe(
      `> quoted *text*\n\n> - point\n\n| Name | Value |\n| --- | --- |\n| one | \`1\` |`,
    )
  })

  test("decodes entities and normalizes whitespace", () => {
    const html = `<p>alpha\n  <span>&amp; beta</span> <unknown>caf&eacute;</unknown>&nbsp;gamma 😀</p><p>delta</p>`
    expect(convertHTMLToMarkdown(html)).toBe(`alpha & beta café gamma 😀\n\ndelta`)
  })

  test("omits fallback content", () => {
    const html = `<p>before <script><b>bad</b></script><style>bad</style><noscript>bad</noscript><iframe>bad</iframe><object>bad</object><embed src="bad"><meta content="bad"><link href="bad"><template>bad</template> after</p>`
    expect(convertHTMLToMarkdown(html)).toBe("before after")
  })

  test("escapes prose that would become Markdown structure", () => {
    expect(convertHTMLToMarkdown(`<p># heading</p><p>1. item</p><p>---</p><p>a | b</p>`)).toBe(
      `\\# heading\n\n1\\. item\n\n\\---\n\na \\| b`,
    )
  })

  test("handles deeply nested markup without overflowing", () => {
    const html = "<div>".repeat(10_000) + "content" + "</div>".repeat(10_000)
    expect(convertHTMLToMarkdown(html)).toBe("content")
  })

  test("stays within the byte budget", () => {
    const output = convertHTMLToMarkdown("x".repeat(MAX_MARKDOWN_BYTES + 10))
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(MAX_MARKDOWN_BYTES)
    expect(output.length).toBeGreaterThan(0)
  })

  test("supports definition lists, captions, and details", () => {
    const html = `<table><caption>Cache modes</caption><tr><th>Name</th></tr><tr><td>A</td></tr></table><dl><dt>Cache</dt><dd>A local store</dd></dl><details><summary>Closed</summary><p>secret</p></details><details open><summary>Open</summary><p>visible</p></details>`
    expect(convertHTMLToMarkdown(html)).toBe(
      `Cache modes\n\n| Name |\n| --- |\n| A |\n\n**Cache**\n: A local store\n\nClosed\n\nOpen\n\nvisible`,
    )
  })
})

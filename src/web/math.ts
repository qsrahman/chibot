// Fenced blocks (closed or still streaming) and inline code spans.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/

/**
 * Rewrites LaTeX's `\(…\)` and `\[…\]` as `$…$` and `$$…$$`, the only math
 * delimiters remark-math knows (in Markdown, `\[` is just an escaped `[`).
 * Code is left as is.
 */
export function dollarMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) =>
      // split() puts the captured code at odd indexes.
      i % 2 === 1
        ? part
        : part
            .replace(
              /\\\[([\s\S]+?)\\\]/g,
              (_, math: string) => `\n$$\n${math.trim()}\n$$\n`,
            )
            .replace(/\\\((.+?)\\\)/g, '$$$1$$'),
    )
    .join('')
}

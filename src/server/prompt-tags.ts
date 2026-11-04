/**
 * `body` in `<tag>` tags. A closing tag inside it is written `&lt;/tag`, so
 * text a user, a model or a page wrote can't end the section and pass for
 * instructions.
 */
export function section(tag: string, body: string, attributes = ''): string {
  const safe = body.replace(new RegExp(`</${tag}`, 'gi'), `&lt;/${tag}`)
  return `<${tag}${attributes}>\n${safe}\n</${tag}>`
}

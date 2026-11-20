/** The heading of a new chat: a greeting for the time of day when it knows the name, else the usual question. */
export function greetingText(name: string, hour: number): string {
  const who = name.trim()
  if (!who) return 'What’s on your mind?'
  const salutation =
    hour >= 5 && hour < 12
      ? 'Good morning'
      : hour >= 12 && hour < 17
        ? 'Good afternoon'
        : hour >= 17 && hour < 22
          ? 'Good evening'
          : 'Hello'
  return `${salutation}, ${who}`
}

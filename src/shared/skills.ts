/** Skills the model is told about; the rest, switched on or not, are left out of its list. */
export const MAX_LISTED_SKILLS = 50

/**
 * A skill's switch is an entry in the `disabledTools` setting, beside the
 * tools' (a tool's name has no colon, so they can't clash).
 */
export const skillSwitch = (name: string): string => `skill:${name}`

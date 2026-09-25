/**
 * An agent CLI's status line without its leading symbol. `claude mcp list`
 * starts each status with ✓, ! or ✗; the jewel drawn beside it already says
 * that, and a typed character is not an icon.
 */
export function plainStatus(text: string): string {
  return text.replace(/^(?:[✓✔✗✘!]|x(?=\s))\s*/u, '');
}

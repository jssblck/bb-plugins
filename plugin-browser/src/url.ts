/** Turn what someone types in a URL bar into something Chrome can navigate to. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "about:blank";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (/^localhost(?::\d+)?(?:[/?#]|$)/i.test(trimmed))
    return `http://${trimmed}`;
  if (/^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(trimmed))
    return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

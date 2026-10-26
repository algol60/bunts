/**
 * Normalize a `Host` header, `Origin` host, or configured hostname by removing
 * its port and IPv6 brackets. Bare IPv6 addresses are returned unchanged.
 */
export const hostnameOf = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]")
    return end > 0 ? trimmed.slice(1, end) : trimmed.slice(1)
  }
  if (trimmed.split(":").length > 2) return trimmed
  const colon = trimmed.indexOf(":")
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Format a hostname for use inside a URL, adding brackets around IPv6. */
export const formatHost = (host: string) => (host.includes(":") && !host.startsWith("[") ? `[${host}]` : host)

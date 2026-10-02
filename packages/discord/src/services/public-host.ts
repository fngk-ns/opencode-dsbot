const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6 = /^[0-9a-f:]+$/i

/** The address the outside world reaches this machine at. Asked once from a plain-text echo service; PUBLIC_HOST overrides it. */
export async function detectPublicHost(
  endpoints = ["https://api.ipify.org", "https://ifconfig.me/ip"],
  fetchText: (url: string) => Promise<string> = async (url) => (await fetch(url, { signal: AbortSignal.timeout(3000) })).text(),
) {
  for (const endpoint of endpoints) {
    const text = (await fetchText(endpoint).catch(() => "")).trim()
    if (IPV4.test(text) || (text.includes(":") && IPV6.test(text))) return text
  }
}

import net from "node:net"

export type PortRange = { min: number; max: number }

export function parsePortRange(value: string | undefined): PortRange {
  const match = value?.match(/^(\d+)-(\d+)$/)
  const min = Number(match?.[1])
  const max = Number(match?.[2])
  if (!match || !(min >= 1024 && max <= 65535 && min <= max)) return { min: 20000, max: 29999 }
  return { min, max }
}

/** True when nothing is listening on the port on any interface (the same check a server would fail on). */
export function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen({ port, host: "0.0.0.0", exclusive: true })
  })
}

/** True when something accepts TCP connections on the port: the cheapest "is the service up" signal. */
export function isListening(port: number, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host })
    const done = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

/** Picks the lowest free port in the range that no service has claimed, starting after the last claimed one. */
export async function findFreePort(range: PortRange, taken: Set<number>, probe: (port: number) => Promise<boolean> = isPortFree) {
  for (let port = range.min; port <= range.max; port++) {
    if (taken.has(port)) continue
    if (await probe(port)) return port
  }
  return undefined
}

import type { Db } from "../store/db"

export type ServiceStatus = "starting" | "running" | "stopped" | "crashed"

export type ServiceRecord = {
  name: string
  description: string | null
  directory: string
  command: string
  port: number | null
  env: Record<string, string>
  desired: "running" | "stopped"
  autorestart: boolean
  pid: number | null
  pid_start: string | null
  status: ServiceStatus
  restarts: number
  last_exit: string | null
  started_at: number | null
  log_file: string
  owner_thread: string | null
  created_by: string | null
  created_at: number
  updated_at: number
}

type Row = Omit<ServiceRecord, "env" | "autorestart"> & { env: string; autorestart: number }

/** The port ledger: which service owns which port, kept in SQLite so it survives restarts of the bot and the host. */
export class ServiceStore {
  constructor(private readonly db: Db) {}

  get(name: string) {
    const row = this.db.query("SELECT * FROM services WHERE name = $name").get({ $name: name }) as Row | null
    return row ? decode(row) : undefined
  }

  byPort(port: number) {
    const row = this.db.query("SELECT * FROM services WHERE port = $port").get({ $port: port }) as Row | null
    return row ? decode(row) : undefined
  }

  list() {
    return (this.db.query("SELECT * FROM services ORDER BY port IS NULL, port, name").all() as Row[]).map(decode)
  }

  ports() {
    return new Set(this.list().flatMap((service) => (service.port === null ? [] : [service.port])))
  }

  create(record: Omit<ServiceRecord, "created_at" | "updated_at">) {
    const now = Date.now()
    this.db
      .query(
        `INSERT INTO services (name, description, directory, command, port, env, desired, autorestart, pid, pid_start, status, restarts, last_exit, started_at, log_file, owner_thread, created_by, created_at, updated_at)
         VALUES ($name, $description, $directory, $command, $port, $env, $desired, $autorestart, $pid, $pid_start, $status, $restarts, $last_exit, $started_at, $log_file, $owner_thread, $created_by, $now, $now)`,
      )
      .run(bind(record, now))
    return this.get(record.name)!
  }

  update(name: string, patch: Partial<Omit<ServiceRecord, "name" | "created_at" | "updated_at">>) {
    const current = this.get(name)
    if (!current) return
    const next = { ...current, ...patch }
    this.db
      .query(
        `UPDATE services SET description = $description, directory = $directory, command = $command, port = $port, env = $env,
           desired = $desired, autorestart = $autorestart, pid = $pid, pid_start = $pid_start, status = $status,
           restarts = $restarts, last_exit = $last_exit, started_at = $started_at, log_file = $log_file,
           owner_thread = $owner_thread, created_by = $created_by, updated_at = $now
         WHERE name = $name`,
      )
      .run(bind(next, Date.now()))
    return this.get(name)
  }

  remove(name: string) {
    this.db.query("DELETE FROM services WHERE name = $name").run({ $name: name })
  }
}

function bind(record: Omit<ServiceRecord, "created_at" | "updated_at">, now: number) {
  return {
    $name: record.name,
    $description: record.description,
    $directory: record.directory,
    $command: record.command,
    $port: record.port,
    $env: JSON.stringify(record.env),
    $desired: record.desired,
    $autorestart: record.autorestart ? 1 : 0,
    $pid: record.pid,
    $pid_start: record.pid_start,
    $status: record.status,
    $restarts: record.restarts,
    $last_exit: record.last_exit,
    $started_at: record.started_at,
    $log_file: record.log_file,
    $owner_thread: record.owner_thread,
    $created_by: record.created_by,
    $now: now,
  }
}

function decode(row: Row): ServiceRecord {
  return { ...row, env: JSON.parse(row.env) as Record<string, string>, autorestart: row.autorestart === 1 }
}

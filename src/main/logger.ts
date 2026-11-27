import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 2 * 1024 * 1024

export class Logger {
  private filePath: string | null = null

  constructor(filePath?: string) {
    if (filePath) {
      try {
        mkdirSync(dirname(filePath), { recursive: true })
        this.filePath = filePath
      } catch {
        this.filePath = null
      }
    }
  }

  private rotateIfNeeded(): void {
    if (!this.filePath) return
    try {
      const stats = statSync(this.filePath)
      if (stats.size > MAX_LOG_BYTES) {
        renameSync(this.filePath, `${this.filePath}.1`)
      }
    } catch {
      // fichier absent : rien à faire
    }
  }

  private write(level: Level, message: string, meta?: unknown): void {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${
      meta === undefined ? '' : ` ${safeStringify(meta)}`
    }`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
    if (!this.filePath) return
    try {
      this.rotateIfNeeded()
      appendFileSync(this.filePath, `${line}\n`, 'utf8')
    } catch {
      // l'écriture du journal ne doit jamais interrompre l'application
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta)
  }

  info(message: string, meta?: unknown): void {
    this.write('info', message, meta)
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta)
  }

  error(message: string, meta?: unknown): void {
    this.write('error', message, meta)
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return JSON.stringify({ name: value.name, message: value.message })
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

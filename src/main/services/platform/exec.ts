import { execFile } from 'node:child_process'
import type { CommandOptions, CommandResult, CommandRunner } from './types'

/**
 * Exécution de commandes système avec des arguments séparés (jamais de shell).
 * Le logiciel n'exécute que des commandes définies dans le code : aucune
 * chaîne provenant de l'interface n'est concaténée dans une ligne de commande.
 */
export const runCommand: CommandRunner = (file, args, options: CommandOptions = {}) => {
  const startedAt = Date.now()
  return new Promise<CommandResult>((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeoutMs ?? 10000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: options.encoding ?? 'utf8',
        env: options.env ?? process.env
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
          const timedOut = err.killed === true || err.code === 'ETIMEDOUT'
          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
            code: typeof err.code === 'number' ? err.code : -1,
            timedOut,
            error: err.code === 'ENOENT' ? `Commande introuvable : ${file}` : err.message,
            durationMs
          })
          return
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          code: 0,
          timedOut: false,
          error: null,
          durationMs
        })
      }
    )
  })
}

/** Vrai si la sortie contient des caractères de remplacement (décodage douteux). */
export function hasBrokenEncoding(text: string): boolean {
  return text.includes('\uFFFD')
}

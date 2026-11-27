import { runCommand } from './exec'
import { createWindowsAdapter } from './windows'
import { createLinuxAdapter } from './linux'
import { createDarwinAdapter } from './darwin'
import type { CommandRunner, PlatformAdapter } from './types'

export type { PlatformAdapter, CommandRunner } from './types'

export function createPlatformAdapter(
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = runCommand
): PlatformAdapter {
  switch (platform) {
    case 'win32':
      return createWindowsAdapter(run)
    case 'darwin':
      return createDarwinAdapter(run)
    default:
      return createLinuxAdapter(run)
  }
}

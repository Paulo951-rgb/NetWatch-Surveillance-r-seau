import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  session,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { LIVE_CHANNELS } from '@shared/ipc'
import { buildPaths, createAppContext, type AppContext } from './context'
import { registerIpcHandlers } from './ipc'
import { Scheduler } from './scheduler'
import { hardenSession } from './security'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let context: AppContext | null = null
let scheduler: Scheduler | null = null
let quitting = false
let startHidden = process.argv.includes('--hidden')

const APP_ID = 'com.netwatch.app'

app.setName('NetWatch')

/** Cherche le dossier des ressources embarquées (base OUI, icônes). */
function resolveResourceDir(): string {
  const candidates = app.isPackaged
    ? [process.resourcesPath, join(app.getAppPath(), 'resources'), join(process.cwd(), 'resources')]
    : [
        join(app.getAppPath(), 'resources'),
        join(process.cwd(), 'resources'),
        join(__dirname, '..', '..', 'resources')
      ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'oui.json'))) return dir
  }
  return candidates[0]
}

function resourcePath(file: string): string {
  const candidate = join(resolveResourceDir(), file)
  if (existsSync(candidate)) return candidate
  return join(app.getAppPath(), 'resources', file)
}

function emit(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({
      title,
      body,
      icon: resourcePath('icon.png'),
      silent: false
    }).show()
  } catch {
    // les notifications système sont optionnelles
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#060a11',
    icon: resourcePath('icon.png'),
    title: 'NetWatch',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })

  window.on('ready-to-show', () => {
    const settings = context?.settings.get()
    if (startHidden && settings?.startup.startMinimized) return
    window.show()
    if (settings?.startup.startMinimized && !startHidden) window.minimize()
  })

  window.on('maximize', () => window.webContents.send(LIVE_CHANNELS.windowMaximized, true))
  window.on('unmaximize', () => window.webContents.send(LIVE_CHANNELS.windowMaximized, false))

  window.on('close', (event) => {
    const settings = context?.settings.get()
    if (!quitting && settings?.startup.minimizeToTray) {
      event.preventDefault()
      window.hide()
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    context?.logger.error('Le processus de rendu s’est arrêté', details)
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  return window
}

/**
 * Capture automatisée de l'interface (documentation et tests visuels) :
 * NETWATCH_CAPTURE=/chemin.png NETWATCH_CAPTURE_ROUTE=/traffic npm start
 */
function setupCapture(window: BrowserWindow): void {
  const target = process.env.NETWATCH_CAPTURE
  const multi = process.env.NETWATCH_CAPTURE_ROUTES
  if (!target) return
  const routes = multi
    ? multi.split(',').map((entry) => entry.trim()).filter(Boolean)
    : [process.env.NETWATCH_CAPTURE_ROUTE ?? '']
  const delay = Number(process.env.NETWATCH_CAPTURE_DELAY ?? 4500)
  const width = Number(process.env.NETWATCH_CAPTURE_WIDTH ?? 0)
  const height = Number(process.env.NETWATCH_CAPTURE_HEIGHT ?? 0)
  const scroll = Number(process.env.NETWATCH_CAPTURE_SCROLL ?? 0)
  if (width > 0 && height > 0) window.setContentSize(width, height)
  setTimeout(() => {
    void (async () => {
      try {
        for (const route of routes) {
          if (route) window.webContents.send(LIVE_CHANNELS.navigate, route)
          await new Promise((resolve) => setTimeout(resolve, route ? 1400 : 0))
          if (scroll > 0) {
            await window.webContents.executeJavaScript(
              `document.querySelector('.content')?.scrollTo({ top: ${scroll}, behavior: 'instant' })`
            )
            await new Promise((resolve) => setTimeout(resolve, 400))
          }
          const image = await window.webContents.capturePage()
          const suffix = route ? `-${route.replace(/\//g, '')}` : ''
          const file = routes.length > 1 ? target.replace(/\.png$/, `${suffix}.png`) : target
          writeFileSync(file, image.toPNG())
          context?.logger.info(`Capture d’interface enregistrée : ${file}`)
        }
      } catch (error) {
        context?.logger.warn('Capture d’interface impossible', error)
      } finally {
        quitting = true
        app.quit()
      }
    })()
  }, delay)
}

function showWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function buildTray(): void {
  // Une session sans affichage (service, conteneur, rendu hors écran) n'a pas de zone de notification.
  if (process.platform === 'linux' && !process.env.DISPLAY) return
  try {
    const iconPath = resourcePath('tray.png')
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) return
    tray = new Tray(image.resize({ width: 20, height: 20 }))
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir NetWatch', click: () => showWindow() },
    {
      label: 'Scanner le réseau maintenant',
      click: () => {
        showWindow()
        mainWindow?.webContents.send(LIVE_CHANNELS.navigate, '/scanner')
        void context?.scanner.scan({ trigger: 'manual' })
      }
    },
    {
      label: 'Diagnostic réseau',
      click: () => {
        showWindow()
        mainWindow?.webContents.send(LIVE_CHANNELS.navigate, '/diagnostic')
      }
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
    tray.setToolTip('NetWatch — surveillance du réseau')
    tray.setContextMenu(menu)
    tray.on('click', () => showWindow())
    tray.on('double-click', () => showWindow())
  } catch (error) {
    context?.logger.warn('Zone de notification indisponible', error)
    tray = null
  }
}

function applyStartupSettings(): void {
  if (!context) return
  const settings = context.settings.get()
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: settings.startup.launchAtLogin,
        args: settings.startup.startMinimized ? ['--hidden'] : []
      })
    } catch (error) {
      context.logger.warn('Configuration du démarrage automatique impossible', error)
    }
  }
}

function bootstrap(): void {
  app.setAppUserModelId(APP_ID)

  const dataDir = app.getPath('userData')
  const paths = buildPaths(dataDir, resolveResourceDir())

  context = createAppContext({ paths, emit, notify })
  registerIpcHandlers(context, () => mainWindow)

  scheduler = new Scheduler({ ctx: context, emit })

  mainWindow = createWindow()
  setupCapture(mainWindow)
  buildTray()
  applyStartupSettings()

  if (context.settings.get().monitoring.enabled) scheduler.start()

  context.settings.onChange((settings) => {
    applyStartupSettings()
    if (settings.monitoring.enabled) {
      if (scheduler?.isPaused()) scheduler.setPaused(false)
      scheduler?.restart()
    } else {
      scheduler?.stop()
    }
    if (!settings.startup.minimizeToTray && tray) {
      tray.destroy()
      tray = null
    } else if (settings.startup.minimizeToTray && !tray) {
      buildTray()
    }
  })

  powerMonitor.on('resume', () => {
    context?.logger.info('Reprise après veille : relance des mesures')
    context?.networkInfo.invalidate()
    void scheduler?.checkConnectivity()
    void scheduler?.refreshNetworkInfo()
  })

  powerMonitor.on('suspend', () => {
    context?.logger.info('Mise en veille du système')
    context?.trafficMonitor.flush()
  })

  app.on('second-instance', () => showWindow())
  app.on('activate', () => showWindow())

  app.on('before-quit', () => {
    quitting = true
    scheduler?.stop()
    context?.close()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  process.on('uncaughtException', (error) => {
    context?.logger.error('Exception non gérée', error)
  })
  process.on('unhandledRejection', (reason) => {
    context?.logger.error('Promesse rejetée non gérée', reason)
  })

  app.whenReady().then(() => {
    try {
      hardenSession(session.defaultSession, process.env['ELECTRON_RENDERER_URL'])
      bootstrap()
    } catch (error) {
      context?.logger.error('Démarrage impossible', error)
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      const minimizeToTray = context?.settings.get().startup.minimizeToTray
      if (!minimizeToTray) {
        quitting = true
        app.quit()
      }
    }
  })
}

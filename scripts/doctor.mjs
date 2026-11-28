#!/usr/bin/env node
/**
 * Diagnostic d'installation : vérifie que tout ce qui est nécessaire au fonctionnement
 * (SQLite natif, ressources OUI, fichiers compilés) est présent, sans lancer Electron.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

const ok = (label, value) => console.log(`  ✓ ${label}${value ? ` : ${value}` : ''}`)
const ko = (label, detail) => {
  console.log(`  ✗ ${label}${detail ? ` : ${detail}` : ''}`)
  problems.push(label)
}

console.log('NetWatch — diagnostic d’installation')
console.log(`  Node ${process.version} · ${process.platform} ${process.arch}`)

// 1. SQLite natif (N-API : un seul binaire pour Node et Electron)
try {
  const Database = require('better-sqlite3')
  const pkg = require('better-sqlite3/package.json')
  const db = new Database(':memory:')
  const value = db.prepare('SELECT sqlite_version() AS v').get()
  db.close()
  ok('better-sqlite3', `${pkg.version} · SQLite ${value.v}`)
} catch (error) {
  ko('better-sqlite3', error instanceof Error ? error.message : String(error))
  console.log(
    '    → Réinstallez les dépendances : npm ci --omit=dev=false (ou supprimez node_modules puis npm ci).'
  )
}

// 2. Base OUI embarquée
const ouiPath = join(root, 'resources', 'oui.json')
try {
  const entries = Object.keys(JSON.parse(readFileSync(ouiPath, 'utf8'))).length
  ok('base OUI', `${entries.toLocaleString('fr-FR')} préfixes`)
} catch (error) {
  ko('base OUI', error instanceof Error ? error.message : String(error))
  console.log('    → Régénérez-la : npm run oui')
}

// 3. Binaire Electron (téléchargé au premier lancement depuis Electron 45)
const electronPath = join(root, 'node_modules', 'electron', 'dist')
if (existsSync(electronPath)) ok('binaire Electron', 'présent')
else
  console.log(
    '  · binaire Electron absent : il sera téléchargé automatiquement au premier « npm run dev » (une seule fois).'
  )

// 4. Icônes et ressources d'empaquetage
for (const file of ['build/icon.ico', 'build/icon.png', 'resources/icon.png', 'resources/tray.png']) {
  const path = join(root, file)
  if (existsSync(path)) ok(file, `${Math.round(statSync(path).size / 1024)} Ko`)
  else ko(file, 'fichier absent')
}

// 5. Build de l'application
const mainBundle = join(root, 'out', 'main', 'index.js')
if (existsSync(mainBundle)) ok('build', 'out/main/index.js présent')
else console.log('  · build absent (normal avant « npm run build »)')

console.log('')
if (problems.length > 0) {
  console.error(`Diagnostic en échec : ${problems.join(', ')}`)
  process.exit(1)
}
console.log('Tout est prêt : npm run dev, puis npm run dist:win pour l’installateur.')

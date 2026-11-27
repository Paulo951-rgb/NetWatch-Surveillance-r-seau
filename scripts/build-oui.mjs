#!/usr/bin/env node
/**
 * Construit la base OUI locale (fabricant à partir des 3 premiers octets de la MAC)
 * à partir du fichier CSV public de l'IEEE. Le fichier produit est embarqué dans
 * l'application : aucune requête réseau n'est faite à l'exécution.
 */
import { createWriteStream, existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get } from 'node:https'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceCsv = resolve(root, 'resources', 'oui.csv')
const target = resolve(root, 'resources', 'oui.json')
const SOURCE_URL = 'https://standards-oui.ieee.org/oui/oui.csv'

function download(url, destination) {
  return new Promise((resolvePromise, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        download(response.headers.location, destination).then(resolvePromise, reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      const stream = createWriteStream(destination)
      response.pipe(stream)
      stream.on('finish', () => stream.close(() => resolvePromise()))
      stream.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(120000, () => request.destroy(new Error('Délai dépassé')))
  })
}

/** Analyse CSV RFC4180 minimal (guillemets, virgules échappées). */
function parseCsvLine(line) {
  const fields = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

function cleanupVendor(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\s*[,;]\s*$/, '')
    .trim()
}

async function main() {
  await mkdir(dirname(target), { recursive: true })
  if (!existsSync(sourceCsv)) {
    console.log(`Téléchargement de ${SOURCE_URL} ...`)
    await download(SOURCE_URL, sourceCsv)
  }
  const content = await readFile(sourceCsv, 'utf8')
  const lines = content.split(/\r?\n/)
  const registry = {}
  let skipped = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const fields = parseCsvLine(line)
    if (fields.length < 3) {
      skipped++
      continue
    }
    const assignment = fields[1].trim().toUpperCase()
    const vendor = cleanupVendor(fields[2])
    if (!/^[0-9A-F]{6}$/.test(assignment) || !vendor) {
      skipped++
      continue
    }
    registry[assignment] = vendor
  }
  const json = JSON.stringify(registry)
  await writeFile(target, json, 'utf8')
  console.log(`Base OUI : ${Object.keys(registry).length} préfixes (${(json.length / 1024 / 1024).toFixed(2)} Mo), ${skipped} lignes ignorées`)
  console.log(`Écrit dans ${target}`)
}

main().catch((error) => {
  console.error('Échec de la construction de la base OUI :', error.message)
  process.exit(1)
})

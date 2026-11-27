#!/usr/bin/env node
/**
 * Génère les icônes de l'application (PNG + ICO) sans dépendance externe.
 * Dessin : carré arrondi sombre, anneau radar cyan et réseau de nœuds.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function mix(a, b, t) {
  return a + (b - a) * t
}

function roundedRectDistance(x, y, size, radius) {
  const half = size / 2
  const dx = Math.abs(x - half) - (half - radius)
  const dy = Math.abs(y - half) - (half - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/** Couleur (r,g,b,a 0-255) d'un point échantillonné, en coordonnées normalisées. */
function sample(x, y, size, transparentBackground) {
  const nx = x / size
  const ny = y / size
  const half = 0.5
  const radius = 0.225 * size
  const edge = roundedRectDistance(x, y, size, radius)
  if (edge > 0) return [0, 0, 0, 0]

  let r = 0
  let g = 0
  let b = 0
  let a = 0

  // Fond dégradé
  const gradient = Math.min(1, Math.max(0, (nx + ny) / 2))
  r = mix(11, 4, gradient)
  g = mix(20, 10, gradient)
  b = mix(36, 18, gradient)
  a = transparentBackground ? 0 : 255

  // Halo central
  const distanceToCenter = Math.hypot(nx - half, ny - half)
  const glow = Math.max(0, 1 - distanceToCenter / 0.5) ** 2
  r = mix(r, 12, glow * 0.4)
  g = mix(g, 60, glow * 0.4)
  b = mix(b, 110, glow * 0.4)

  // Anneau radar (avec balayage)
  const ringRadius = 0.335
  const ringWidth = 0.032
  const ringDistance = Math.abs(distanceToCenter - ringRadius)
  if (ringDistance < ringWidth) {
    const angle = (Math.atan2(ny - half, nx - half) + Math.PI * 2) % (Math.PI * 2)
    const sweep = 0.28 + 0.72 * (angle / (Math.PI * 2))
    const alpha = Math.min(1, (1 - ringDistance / ringWidth) * sweep)
    r = mix(r, 34, alpha)
    g = mix(g, 211, alpha)
    b = mix(b, 238, alpha)
    a = Math.max(a, Math.round(255 * alpha))
  }

  // Liens entre le centre et les nœuds
  const nodes = [
    [0.5 + Math.cos((210 * Math.PI) / 180) * 0.235, 0.5 + Math.sin((210 * Math.PI) / 180) * 0.235],
    [0.5 + Math.cos((330 * Math.PI) / 180) * 0.235, 0.5 + Math.sin((330 * Math.PI) / 180) * 0.235],
    [0.5 + Math.cos((90 * Math.PI) / 180) * 0.235, 0.5 + Math.sin((90 * Math.PI) / 180) * 0.235]
  ]
  for (const [nodeX, nodeY] of nodes) {
    const vx = nodeX - half
    const vy = nodeY - half
    const lengthSquared = vx * vx + vy * vy
    const t = Math.min(1, Math.max(0, ((nx - half) * vx + (ny - half) * vy) / lengthSquared))
    const closestX = half + vx * t
    const closestY = half + vy * t
    const lineDistance = Math.hypot(nx - closestX, ny - closestY)
    if (lineDistance < 0.013) {
      const alpha = Math.min(1, (1 - lineDistance / 0.013) * 0.9)
      r = mix(r, 59, alpha)
      g = mix(g, 130, alpha)
      b = mix(b, 246, alpha)
      a = Math.max(a, Math.round(255 * alpha))
    }
  }

  // Nœuds périphériques
  for (const [nodeX, nodeY] of nodes) {
    const distance = Math.hypot(nx - nodeX, ny - nodeY)
    if (distance < 0.052) {
      const alpha = Math.min(1, (1 - distance / 0.052) * 3)
      r = mix(r, 103, alpha)
      g = mix(g, 232, alpha)
      b = mix(b, 249, alpha)
      a = Math.max(a, Math.round(255 * alpha))
    }
  }

  // Nœud central
  if (distanceToCenter < 0.088) {
    const alpha = Math.min(1, (1 - distanceToCenter / 0.088) * 4)
    r = mix(r, 230, alpha)
    g = mix(g, 248, alpha)
    b = mix(b, 255, alpha)
    a = Math.max(a, Math.round(255 * alpha))
  }

  return [Math.round(r), Math.round(g), Math.round(b), a]
}

function renderIcon(size, transparentBackground = false) {
  const buffer = Buffer.alloc(size * size * 4)
  const samples = size <= 48 ? 4 : 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          const [sr, sg, sb, sa] = sample(px, py, size, transparentBackground)
          r += sr * sa
          g += sg * sa
          b += sb * sa
          a += sa
        }
      }
      const count = samples * samples
      const index = (y * size + x) * 4
      if (a === 0) {
        buffer[index] = 0
        buffer[index + 1] = 0
        buffer[index + 2] = 0
        buffer[index + 3] = 0
      } else {
        buffer[index] = Math.round(r / a)
        buffer[index + 1] = Math.round(g / a)
        buffer[index + 2] = Math.round(b / a)
        buffer[index + 3] = Math.round(a / count)
      }
    }
  }
  return buffer
}

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry[0] = image.size >= 256 ? 0 : image.size
    entry[1] = image.size >= 256 ? 0 : image.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += image.png.length
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

function main() {
  mkdirSync(resolve(root, 'build'), { recursive: true })
  mkdirSync(resolve(root, 'resources'), { recursive: true })

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = sizes.map((size) => ({ size, png: encodePng(size, size, renderIcon(size)) }))
  writeFileSync(resolve(root, 'build', 'icon.ico'), encodeIco(images))
  writeFileSync(resolve(root, 'build', 'icon.png'), encodePng(512, 512, renderIcon(512)))
  writeFileSync(resolve(root, 'resources', 'icon.png'), encodePng(512, 512, renderIcon(512)))
  writeFileSync(resolve(root, 'resources', 'tray.png'), encodePng(32, 32, renderIcon(32, true)))
  writeFileSync(resolve(root, 'src/renderer/public/logo.png'), encodePng(256, 256, renderIcon(256)))
  console.log('Icônes générées : build/icon.ico, build/icon.png, resources/icon.png, resources/tray.png')
}

main()

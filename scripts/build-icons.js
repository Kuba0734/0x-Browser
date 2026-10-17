const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = join(__dirname, '..', 'assets', 'icons')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

app.whenReady().then(async () => {
  const svg = readFileSync(join(dir, 'app.svg')).toString('base64')
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<body></body>')
  const sizes = [...ICO_SIZES, 512]
  const encoded = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${svg}'
    await img.decode()
    return ${JSON.stringify(sizes)}.map((size) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(img, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    })
  })()`)
  const images = sizes.map((size, index) => ({ size, png: Buffer.from(encoded[index], 'base64') }))
  writeFileSync(join(dir, 'app.png'), images.at(-1).png)
  writeFileSync(join(dir, 'app.ico'), ico(images.slice(0, ICO_SIZES.length)))
  app.quit()
})

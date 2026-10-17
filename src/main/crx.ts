import { createHash } from 'node:crypto'

export function crxToZip(crx: Buffer): Buffer {
  if (crx.length < 16 || crx.toString('latin1', 0, 4) !== 'Cr24')
    throw new Error('Not a valid extension package')
  const version = crx.readUInt32LE(4)
  const start =
    version === 3
      ? 12 + crx.readUInt32LE(8)
      : version === 2
        ? 16 + crx.readUInt32LE(8) + crx.readUInt32LE(12)
        : -1
  if (start < 0) throw new Error('Unsupported extension package version')
  if (start >= crx.length) throw new Error('Not a valid extension package')
  return crx.subarray(start)
}

function varint(buffer: Buffer, start: number): [number, number] {
  let value = 0
  let shift = 0
  let position = start
  while (position < buffer.length) {
    const byte = buffer[position++]
    value += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) return [value, position]
    shift += 7
  }
  throw new Error('Not a valid extension package')
}

function* fields(buffer: Buffer): Generator<[number, Buffer]> {
  let position = 0
  while (position < buffer.length) {
    const [tag, next] = varint(buffer, position)
    position = next
    const type = tag & 7
    if (type === 2) {
      const [length, start] = varint(buffer, position)
      yield [Math.floor(tag / 8), buffer.subarray(start, start + length)]
      position = start + length
    } else if (type === 0) position = varint(buffer, position)[1]
    else if (type === 1) position += 8
    else if (type === 5) position += 4
    else throw new Error('Not a valid extension package')
  }
}

export function crxPublicKeys(crx: Buffer): Buffer[] {
  if (crx.readUInt32LE(4) !== 3) return []
  const header = crx.subarray(12, 12 + crx.readUInt32LE(8))
  const keys: Buffer[] = []
  for (const [field, proof] of fields(header)) {
    if (field !== 2) continue
    for (const [inner, key] of fields(proof)) if (inner === 1) keys.push(key)
  }
  return keys
}

export function extensionId(publicKey: Buffer): string {
  return createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 32)
    .replace(/./g, (char) => String.fromCharCode(97 + parseInt(char, 16)))
}

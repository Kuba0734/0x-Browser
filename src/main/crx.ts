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

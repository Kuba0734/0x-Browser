import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crxPublicKeys, crxToZip, extensionId } from './crx.ts'

const header = (...values: number[]) => {
  const buffer = Buffer.alloc(4 + values.length * 4)
  buffer.write('Cr24', 0, 'latin1')
  values.forEach((value, index) => buffer.writeUInt32LE(value, 4 + index * 4))
  return buffer
}
const zip = Buffer.from('PK\u0003\u0004rest')

test('crxToZip v3', () => {
  const crx = Buffer.concat([header(3, 5), Buffer.alloc(5), zip])
  assert.deepEqual(crxToZip(crx), zip)
})

test('crxToZip v2', () => {
  const crx = Buffer.concat([header(2, 3, 4), Buffer.alloc(7), zip])
  assert.deepEqual(crxToZip(crx), zip)
})

test('crxToZip rejects bad input', () => {
  assert.throws(() => crxToZip(Buffer.from('not a crx file')))
  assert.throws(() => crxToZip(Buffer.concat([header(4, 0), zip])))
  assert.throws(() => crxToZip(Buffer.concat([header(3, 999), zip])))
})

test('crxPublicKeys reads keys from a CRX3 header', () => {
  const key = Buffer.from('public-key-bytes')
  const proof = Buffer.concat([Buffer.from([0x0a, key.length]), key, Buffer.from([0x12, 1, 0])])
  const signedData = Buffer.from([0x82, 0xf1, 0x04, 2, 9, 9])
  const headerBody = Buffer.concat([Buffer.from([0x12, proof.length]), proof, signedData])
  const crx = Buffer.concat([header(3, headerBody.length), headerBody, zip])
  assert.deepEqual(crxPublicKeys(crx), [key])
  assert.deepEqual(crxToZip(crx), zip)
})

test('extensionId maps the key hash to letters a-p', () => {
  const id = extensionId(Buffer.from('key'))
  assert.match(id, /^[a-p]{32}$/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { storePackageUrl, storeTarget } from './stores.ts'

const CHROME_ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh'
const EDGE_ID = 'odfafepnkmbhccpbejgmiehpchacaeak'

test('storeTarget recognizes store pages', () => {
  assert.deepEqual(
    storeTarget(`https://chromewebstore.google.com/detail/ublock-origin-lite/${CHROME_ID}?hl=de`),
    { store: 'chrome', key: CHROME_ID }
  )
  assert.deepEqual(storeTarget(`https://chrome.google.com/webstore/detail/x/${CHROME_ID}`), {
    store: 'chrome',
    key: CHROME_ID
  })
  assert.deepEqual(
    storeTarget(`https://microsoftedge.microsoft.com/addons/detail/ublock-origin/${EDGE_ID}`),
    { store: 'edge', key: EDGE_ID }
  )
  assert.deepEqual(storeTarget('https://addons.opera.com/en/extensions/details/ublock/'), {
    store: 'opera',
    key: 'ublock'
  })
  assert.deepEqual(storeTarget(CHROME_ID), { store: 'chrome', key: CHROME_ID })
})

test('storeTarget rejects other pages', () => {
  assert.equal(storeTarget('https://example.com/'), null)
  assert.equal(storeTarget('https://addons.opera.com/en/extensions/'), null)
  assert.equal(storeTarget('https://addons.opera.com/en/extensions/details/a/b/'), null)
  assert.equal(
    storeTarget(`https://evil.com/?u=https://chromewebstore.google.com/detail/${CHROME_ID}`),
    null
  )
})

test('storePackageUrl builds download links', () => {
  assert.equal(
    storePackageUrl({ store: 'opera', key: 'ublock' }, '1'),
    'https://addons.opera.com/extensions/download/ublock/'
  )
  assert.match(
    storePackageUrl({ store: 'edge', key: EDGE_ID }, '1'),
    /edge\.microsoft\.com.*odfafep/
  )
  assert.match(storePackageUrl({ store: 'chrome', key: CHROME_ID }, '152'), /prodversion=152/)
})

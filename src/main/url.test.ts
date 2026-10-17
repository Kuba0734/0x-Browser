import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWebUrl, resolveInput } from './url.ts'

const SEARCH = 'https://www.google.com/search?q='
const resolve = (input: string) => resolveInput(input, SEARCH)
const search = (q: string) => SEARCH + encodeURIComponent(q)

test('resolveInput', () => {
  assert.equal(resolve('   '), null)
  assert.equal(resolve('https://example.com/a'), 'https://example.com/a')
  assert.equal(resolve('example.com'), 'https://example.com')
  assert.equal(resolve('sub.example.co.uk/path?q=1'), 'https://sub.example.co.uk/path?q=1')
  assert.equal(resolve('localhost:5173'), 'http://localhost:5173')
  assert.equal(resolve('192.168.0.1'), 'https://192.168.0.1')
  assert.equal(resolve('hello world'), search('hello world'))
  assert.equal(resolve('e.g.'), search('e.g.'))
  assert.equal(resolve('1.5'), search('1.5'))
  assert.equal(resolve('javascript:alert(1)'), search('javascript:alert(1)'))
  assert.equal(resolve('file:///C:/Windows'), search('file:///C:/Windows'))
})

test('resolveInput internal pages', () => {
  assert.equal(resolve('0x://settings'), 'ox://settings/')
  assert.equal(resolve('ox://downloads/'), 'ox://downloads/')
  assert.equal(resolve('0x://SETTINGS'), 'ox://settings/')
  assert.equal(resolve('0x://unknown'), search('0x://unknown'))
})

test('isWebUrl', () => {
  assert.equal(isWebUrl('https://a.com'), true)
  assert.equal(isWebUrl('data:image/png;base64,AA'), false)
  assert.equal(isWebUrl('ox://settings/'), false)
  assert.equal(isWebUrl('not a url'), false)
})

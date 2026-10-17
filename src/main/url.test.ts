import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWebUrl, resolveInput } from './url.ts'

const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`

test('resolveInput', () => {
  assert.equal(resolveInput('   '), null)
  assert.equal(resolveInput('https://example.com/a'), 'https://example.com/a')
  assert.equal(resolveInput('example.com'), 'https://example.com')
  assert.equal(resolveInput('sub.example.co.uk/path?q=1'), 'https://sub.example.co.uk/path?q=1')
  assert.equal(resolveInput('localhost:5173'), 'http://localhost:5173')
  assert.equal(resolveInput('192.168.0.1'), 'https://192.168.0.1')
  assert.equal(resolveInput('hello world'), search('hello world'))
  assert.equal(resolveInput('e.g.'), search('e.g.'))
  assert.equal(resolveInput('1.5'), search('1.5'))
  assert.equal(resolveInput('javascript:alert(1)'), search('javascript:alert(1)'))
  assert.equal(resolveInput('file:///C:/Windows'), search('file:///C:/Windows'))
})

test('isWebUrl', () => {
  assert.equal(isWebUrl('https://a.com'), true)
  assert.equal(isWebUrl('data:image/png;base64,AA'), false)
  assert.equal(isWebUrl('not a url'), false)
})

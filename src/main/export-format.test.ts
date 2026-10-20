import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bookmarksHtml,
  cookieDetails,
  historyCsv,
  parseBookmarksHtml,
  parseHistoryCsv
} from './export-format.ts'

test('bookmarksHtml nests folders and escapes text', () => {
  const html = bookmarksHtml({
    id: 'root',
    title: '',
    children: [
      {
        id: 'bar',
        title: 'Bookmarks bar',
        children: [{ id: '1', title: 'A & <B>', url: 'https://a.test/?x="1"&y=2' }]
      },
      { id: 'other', title: 'Other bookmarks', children: [] }
    ]
  })
  assert.match(html, /<H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar<\/H3>/)
  assert.match(html, /<A HREF="https:\/\/a.test\/\?x=&quot;1&quot;&amp;y=2">A &amp; &lt;B&gt;<\/A>/)
  assert.match(html, /<H3>Other bookmarks<\/H3>/)
})

test('historyCsv quotes fields', () => {
  const csv = historyCsv([
    { url: 'https://a.test/', title: 'Say "hi", ok', visit_count: 3, last_visit: 0 }
  ])
  assert.equal(
    csv,
    'url,title,visit_count,last_visit\r\n"https://a.test/","Say ""hi"", ok","3","1970-01-01T00:00:00.000Z"\r\n'
  )
})

test('cookieDetails maps exported cookies and rejects bad or expired ones', () => {
  const base = { name: 'sid', value: 'x', domain: '.example.com', path: '/', secure: true }
  assert.deepEqual(
    cookieDetails({ ...base, httpOnly: true, sameSite: 'lax', expirationDate: 2e9 }, 1),
    {
      url: 'https://example.com/',
      name: 'sid',
      value: 'x',
      domain: '.example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 2e9
    }
  )
  assert.equal(cookieDetails({ ...base, hostOnly: true }, 1)?.domain, undefined)
  assert.equal(cookieDetails({ ...base, expirationDate: 5 }, 10), null)
  assert.equal(cookieDetails({ ...base, domain: 'evil/../x' }, 1), null)
  assert.equal(cookieDetails('nope', 1), null)
})

test('parseBookmarksHtml reads an exported bookmark file back', () => {
  const html = bookmarksHtml({
    id: 'root',
    title: '',
    children: [
      {
        id: 'bar',
        title: 'Bookmarks bar',
        children: [
          { id: '1', title: 'A & <B>', url: 'https://a.test/?x="1"&y=2' },
          { id: '2', title: 'Dev', children: [{ id: '3', title: 'C', url: 'https://c.test/' }] }
        ]
      },
      {
        id: 'other',
        title: 'Other bookmarks',
        children: [
          { id: '4', title: 'D', url: 'https://d.test/' },
          { id: '5', title: 'Bad', url: 'javascript:alert(1)' }
        ]
      }
    ]
  })
  assert.deepEqual(parseBookmarksHtml(html), [
    [
      { id: '', title: 'A & <B>', url: 'https://a.test/?x="1"&y=2' },
      { id: '', title: 'Dev', children: [{ id: '', title: 'C', url: 'https://c.test/' }] }
    ],
    [{ id: '', title: 'D', url: 'https://d.test/' }]
  ])
})

test('parseHistoryCsv reads an exported history file back', () => {
  const csv = historyCsv([
    { url: 'https://a.test/', title: 'Say "hi", ok\nnext', visit_count: 3, last_visit: 1000 },
    { url: 'file:///c:/x', title: 'x', visit_count: 1, last_visit: 0 }
  ])
  assert.deepEqual(parseHistoryCsv(csv), [
    { url: 'https://a.test/', title: 'Say "hi", ok\nnext', visitCount: 3, lastVisit: 1000 }
  ])
  assert.throws(() => parseHistoryCsv('a,b\r\n'))
})

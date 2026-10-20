import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookmarksHtml, historyCsv } from './export-format.ts'

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

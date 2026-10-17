import { app, type WebContents } from 'electron'

// Google refuses sign-in from embedded Chromium (detected via user agent and client hints) but
// accepts Firefox, so only its sign-in host sees a Firefox identity. This avoids session.webRequest
// on purpose: any listener there turns off chrome.webRequest for extensions, which breaks content
// blockers like uBlock Origin. A DevTools user agent override without metadata drops the client hints.
const FIREFOX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0'
const GOOGLE_SIGN_IN = 'https://accounts.google.com/'
const overridden = new WeakSet<WebContents>()

export function userAgentFor(url: string): string {
  return url.startsWith(GOOGLE_SIGN_IN) ? FIREFOX_USER_AGENT : app.userAgentFallback
}

export function applyUserAgent(contents: WebContents, url: string): void {
  const userAgent = userAgentFor(url)
  contents.setUserAgent(userAgent)
  const { debugger: devtools } = contents
  if (userAgent === FIREFOX_USER_AGENT && !overridden.has(contents)) {
    try {
      devtools.attach('1.3')
    } catch {
      return
    }
    overridden.add(contents)
    devtools.sendCommand('Emulation.setUserAgentOverride', { userAgent }).catch(() => undefined)
  } else if (userAgent !== FIREFOX_USER_AGENT && overridden.delete(contents)) {
    if (devtools.isAttached()) devtools.detach()
  }
}

import {
  app,
  type OnBeforeSendHeadersListenerDetails,
  type Session,
  type WebContents
} from 'electron'

// Google refuses sign-in from embedded Chromium (detected via user agent and client hints) but
// accepts Firefox, so only its sign-in host sees a Firefox identity without Chromium client hints.
// Any session.webRequest listener turns off chrome.webRequest for extensions (content blockers stop
// working), so the header rewrite is only registered while a tab is on the sign-in host.
const FIREFOX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0'
const GOOGLE_SIGN_IN = 'https://accounts.google.com/'
const signInTabs = new Set<WebContents>()

export function userAgentFor(url: string): string {
  return url.startsWith(GOOGLE_SIGN_IN) ? FIREFOX_USER_AGENT : app.userAgentFallback
}

// Google rejects sign-in when another Google page (running as Chromium) navigates the tab there, but
// accepts the same URL loaded by the browser itself, so such navigations are restarted from here.
export function entersGoogleSignIn(currentUrl: string, targetUrl: string): boolean {
  return targetUrl.startsWith(GOOGLE_SIGN_IN) && !currentUrl.startsWith(GOOGLE_SIGN_IN)
}

function rewriteHeaders(
  details: OnBeforeSendHeadersListenerDetails,
  callback: (response: { requestHeaders: Record<string, string> }) => void
): void {
  const requestHeaders = Object.fromEntries(
    Object.entries(details.requestHeaders).filter(
      ([name]) => !name.toLowerCase().startsWith('sec-ch-ua')
    )
  )
  requestHeaders['User-Agent'] = FIREFOX_USER_AGENT
  callback({ requestHeaders })
}

function leaveSignIn(contents: WebContents, session: Session): void {
  if (signInTabs.delete(contents) && !signInTabs.size) session.webRequest.onBeforeSendHeaders(null)
}

export function applyUserAgent(contents: WebContents, url: string): void {
  const { session } = contents
  contents.setUserAgent(userAgentFor(url))
  if (!url.startsWith(GOOGLE_SIGN_IN)) return leaveSignIn(contents, session)
  if (signInTabs.has(contents)) return
  if (!signInTabs.size)
    session.webRequest.onBeforeSendHeaders({ urls: [`${GOOGLE_SIGN_IN}*`] }, rewriteHeaders)
  signInTabs.add(contents)
  contents.once('destroyed', () => leaveSignIn(contents, session))
}

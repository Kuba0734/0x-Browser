import { app, type Session } from 'electron'

// Google refuses sign-in from embedded Chromium (detected via user agent and client hints) but
// accepts Firefox, so only its sign-in host sees a Firefox identity without Chromium client hints.
const FIREFOX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0'
const GOOGLE_SIGN_IN = 'https://accounts.google.com/'

export function userAgentFor(url: string): string {
  return url.startsWith(GOOGLE_SIGN_IN) ? FIREFOX_USER_AGENT : app.userAgentFallback
}

export function initCompat(session: Session): void {
  session.webRequest.onBeforeSendHeaders({ urls: [`${GOOGLE_SIGN_IN}*`] }, (details, callback) => {
    const requestHeaders = Object.fromEntries(
      Object.entries(details.requestHeaders).filter(
        ([name]) => !name.toLowerCase().startsWith('sec-ch-ua')
      )
    )
    requestHeaders['User-Agent'] = FIREFOX_USER_AGENT
    callback({ requestHeaders })
  })
}

import { ipcMain, type OnBeforeRequestListenerDetails, type Session } from 'electron'
import { getSettings, onSettingsChange } from './settings'

// Only services whose sole job is tracking, analytics or ad measurement. Login SDKs, embeds, captchas,
// tag managers and A/B testing tools stay reachable because blocking them breaks pages.
const TRACKER_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'googletagservices.com',
  'adservice.google.com',
  'clarity.ms',
  'bat.bing.com',
  'hotjar.com',
  'hotjar.io',
  'mouseflow.com',
  'fullstory.com',
  'heapanalytics.com',
  'api.amplitude.com',
  'api2.amplitude.com',
  'api-js.mixpanel.com',
  'api.segment.io',
  'nr-data.net',
  'scorecardresearch.com',
  'quantserve.com',
  'quantcount.com',
  'chartbeat.net',
  'criteo.com',
  'criteo.net',
  'adnxs.com',
  'adsrvr.org',
  'rubiconproject.com',
  'pubmatic.com',
  'casalemedia.com',
  'amazon-adsystem.com',
  'demdex.net',
  'omtrdc.net',
  'everesttech.net',
  'krxd.net',
  'bluekai.com',
  'moatads.com',
  'adsafeprotected.com',
  'doubleverify.com',
  'hs-analytics.net',
  'hsadspixel.net',
  'analytics.tiktok.com',
  'analytics.twitter.com',
  'static.ads-twitter.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',
  'ct.pinterest.com',
  'tr.snapchat.com',
  'mc.yandex.ru',
  'mc.yandex.com'
]

// Hosts that also serve features (Facebook login, Reddit) only lose their tracking endpoints.
const TRACKER_PATHS = [
  '*://www.facebook.com/tr/*',
  '*://www.facebook.com/tr?*',
  '*://connect.facebook.net/*/fbevents.js*',
  '*://connect.facebook.net/signals/*',
  '*://www.redditstatic.com/ads/*',
  '*://alb.reddit.com/*'
]

const FILTER = {
  urls: [...TRACKER_HOSTS.map((host) => `*://*.${host}/*`), ...TRACKER_PATHS]
}

const hostOf = (url = '') => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const sameService = (a: string, b: string) => {
  const base = (host: string) => host.split('.').slice(-2).join('.')
  return !!a && base(a) === base(b)
}

// Page loads are never blocked, and a tracker's own site (e.g. the Google Analytics dashboard) keeps
// working because requests within the same service are first party.
function listener(
  details: OnBeforeRequestListenerDetails,
  callback: (response: { cancel: boolean }) => void
): void {
  if (details.resourceType === 'mainFrame') return callback({ cancel: false })
  const page = hostOf(details.webContents?.getURL()) || hostOf(details.referrer)
  callback({ cancel: !sameService(page, hostOf(details.url)) })
}

// Any session.webRequest listener turns off chrome.webRequest for extensions (see compat.ts), so an
// enabled extension that uses it (a content blocker) takes over instead of being silently disabled.
export function initTrackerBlocking(
  session: Session,
  extensionUsesWebRequest: boolean
): (extensionUsesWebRequest: boolean) => void {
  let active = false
  let extensionBlocks = extensionUsesWebRequest
  const apply = () => {
    const next = getSettings().blockTrackers && !extensionBlocks
    if (next === active) return
    active = next
    if (next) session.webRequest.onBeforeRequest(FILTER, listener)
    else session.webRequest.onBeforeRequest(null)
  }
  apply()
  onSettingsChange(apply)
  ipcMain.on('privacy:gpc', (event) => {
    event.returnValue = getSettings().blockTrackers
  })
  return (value) => {
    extensionBlocks = value
    apply()
  }
}

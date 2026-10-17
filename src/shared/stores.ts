export type StoreTarget = { store: 'chrome' | 'edge' | 'opera'; key: string }

const PATTERNS: [StoreTarget['store'], RegExp][] = [
  [
    'chrome',
    /^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/?#]+\/)?([a-p]{32})(?=[/?#]|$)/
  ],
  [
    'chrome',
    /^https:\/\/chrome\.google\.com\/webstore\/detail\/(?:[^/?#]+\/)?([a-p]{32})(?=[/?#]|$)/
  ],
  [
    'edge',
    /^https:\/\/microsoftedge\.microsoft\.com\/addons\/detail\/(?:[^/?#]+\/)?([a-p]{32})(?=[/?#]|$)/
  ],
  [
    'opera',
    /^https:\/\/addons\.opera\.com\/(?:[a-z-]+\/)?extensions\/details\/([a-z0-9-]+)\/?(?=[?#]|$)/
  ]
]

export function storeTarget(input: string): StoreTarget | null {
  const text = input.trim()
  for (const [store, pattern] of PATTERNS) {
    const key = pattern.exec(text)?.[1]
    if (key) return { store, key }
  }
  return /^[a-p]{32}$/.test(text) ? { store: 'chrome', key: text } : null
}

export function storePackageUrl({ store, key }: StoreTarget, chromeVersion: string): string {
  if (store === 'edge')
    return (
      'https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect' +
      `&prod=chromiumcrx&prodchannel=&x=id%3D${key}%26installsource%3Dondemand%26uc`
    )
  if (store === 'opera') return `https://addons.opera.com/extensions/download/${key}/`
  return (
    'https://clients2.google.com/service/update2/crx?response=redirect' +
    `&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${key}%26uc`
  )
}

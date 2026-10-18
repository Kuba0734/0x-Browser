import { execFile } from 'node:child_process'
import { shell } from 'electron'

const PROG_ID = '0xBrowserURL'
const HTTPS = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https'

function readProgId(key: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile('reg', ['query', key, '/v', 'ProgId'], { windowsHide: true }, (error, stdout) =>
      resolve(error ? null : (/ProgId\s+REG_SZ\s+(.+?)\s*$/m.exec(stdout)?.[1] ?? null))
    )
  )
}

// Newer Windows 11 builds keep the user's pick in UserChoiceLatest and only fall back to UserChoice.
export async function isDefaultBrowser(): Promise<boolean> {
  const progId =
    (await readProgId(`${HTTPS}\\UserChoiceLatest\\ProgId`)) ??
    (await readProgId(`${HTTPS}\\UserChoice`))
  return progId === PROG_ID
}

export function openDefaultAppsSettings(): void {
  shell
    .openExternal('ms-settings:defaultapps?registeredAppUser=0x%20Browser')
    .catch(() => undefined)
}

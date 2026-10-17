export const PERMISSIONS = {
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  geolocation: 'Know your location',
  notifications: 'Show notifications',
  midi: 'Use your MIDI devices',
  'clipboard-read': 'See text and images you copied',
  'idle-detection': 'Know when you are using this device',
  'window-management': 'Manage windows on all your displays'
}

export const PERMISSION_NAMES: Record<keyof typeof PERMISSIONS, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
  notifications: 'Notifications',
  midi: 'MIDI devices',
  'clipboard-read': 'Clipboard',
  'idle-detection': 'Idle detection',
  'window-management': 'Window management'
}

export type PermissionKey = keyof typeof PERMISSIONS
export type Decision = 'allow' | 'block'
export type SitePermissions = {
  origin: string
  permissions: Partial<Record<PermissionKey, Decision>>
}
export type PermissionPrompt = { id: string; origin: string; permissions: PermissionKey[] }

export const isPermissionKey = (value: string): value is PermissionKey => value in PERMISSIONS

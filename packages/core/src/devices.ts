/** Device presets for the viewer and the player. Sizes are in points. */

export interface DevicePreset {
  id: string;
  name: string;
  platform: "ios" | "android" | "desktop" | "web" | "custom";
  kind: "phone" | "tablet" | "computer" | "watch" | "custom";
  size: [number, number]; // portrait points
  scale: number;
  safeArea: [number, number, number, number]; // top, right, bottom, left (portrait)
  cornerRadius: number;
  /** Island/notch/punch-hole drawn by the CSS device frame. */
  cutout?: "island" | "notch" | "punchHole" | "none";
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: "iphone-17-pro", name: "iPhone 17 Pro", platform: "ios", kind: "phone", size: [402, 874], scale: 3, safeArea: [62, 0, 34, 0], cornerRadius: 62, cutout: "island" },
  { id: "iphone-17-pro-max", name: "iPhone 17 Pro Max", platform: "ios", kind: "phone", size: [440, 956], scale: 3, safeArea: [62, 0, 34, 0], cornerRadius: 62, cutout: "island" },
  { id: "iphone-air", name: "iPhone Air", platform: "ios", kind: "phone", size: [420, 912], scale: 3, safeArea: [68, 0, 34, 0], cornerRadius: 62, cutout: "island" },
  { id: "iphone-se", name: "iPhone SE", platform: "ios", kind: "phone", size: [375, 667], scale: 2, safeArea: [20, 0, 0, 0], cornerRadius: 0, cutout: "none" },
  { id: "android-large", name: "Android (Large)", platform: "android", kind: "phone", size: [412, 915], scale: 2.625, safeArea: [40, 0, 24, 0], cornerRadius: 36, cutout: "punchHole" },
  { id: "android-compact", name: "Android (Compact)", platform: "android", kind: "phone", size: [360, 800], scale: 3, safeArea: [32, 0, 24, 0], cornerRadius: 28, cutout: "punchHole" },
  { id: "ipad-pro-11", name: "iPad Pro 11\"", platform: "ios", kind: "tablet", size: [834, 1210], scale: 2, safeArea: [24, 0, 20, 0], cornerRadius: 18, cutout: "none" },
  { id: "ipad-pro-13", name: "iPad Pro 13\"", platform: "ios", kind: "tablet", size: [1032, 1376], scale: 2, safeArea: [24, 0, 20, 0], cornerRadius: 18, cutout: "none" },
  { id: "desktop", name: "Desktop 1440×900", platform: "desktop", kind: "computer", size: [1440, 900], scale: 2, safeArea: [0, 0, 0, 0], cornerRadius: 10, cutout: "none" },
  { id: "desktop-hd", name: "Desktop 1920×1080", platform: "desktop", kind: "computer", size: [1920, 1080], scale: 1, safeArea: [0, 0, 0, 0], cornerRadius: 10, cutout: "none" },
  { id: "watch-46", name: "Watch 46mm", platform: "ios", kind: "watch", size: [208, 248], scale: 2, safeArea: [0, 0, 0, 0], cornerRadius: 50, cutout: "none" },
  { id: "custom", name: "Custom", platform: "custom", kind: "custom", size: [390, 844], scale: 2, safeArea: [0, 0, 0, 0], cornerRadius: 0, cutout: "none" },
];

export const DEFAULT_DEVICE = "iphone-17-pro";

export function getDevicePreset(id: string): DevicePreset {
  return DEVICE_PRESETS.find((d) => d.id === id) ?? DEVICE_PRESETS[0]!;
}

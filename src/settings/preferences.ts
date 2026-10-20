export interface Preferences {
  schemaVersion: 1;
  theme: "dark" | "light" | "system";
  fontSize: number;
  fontFamily: string;
  shortcuts: Record<string, string>;
  lineHeight: number;
  ligatures: boolean;
  compact: boolean;
  wrap: boolean;
  markdownDefault: "preview" | "source";
  uiScale: number;
  interpreter: string;
}
export const defaults: Preferences = {
  schemaVersion: 1,
  theme: "dark",
  fontSize: 13,
  fontFamily: "JetBrains Mono",
  shortcuts: {},
  lineHeight: 1.55,
  ligatures: false,
  compact: false,
  wrap: false,
  markdownDefault: "preview",
  uiScale: 1,
  interpreter: "",
};
export function validatePreferences(value: Partial<Preferences>): Preferences {
  return {
    ...defaults,
    ...value,
    fontSize: Math.max(9, Math.min(32, Number(value.fontSize) || 13)),
    lineHeight: Math.max(1.1, Math.min(2.5, Number(value.lineHeight) || 1.55)),
    uiScale: Math.max(0.75, Math.min(1.5, Number(value.uiScale) || 1)),
  };
}

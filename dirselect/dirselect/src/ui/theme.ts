export interface Theme {
  bg: string
  text: string
  dim: string
  guide: string
  check: string
  selected: string
  partial: string
  error: string
  accent: string
  border: string
  panel: string
  headerBg: string
  footerBg: string
  selectionBg: string
  selectionFg: string
}

export const darkTheme: Theme = {
  bg: "#181818",
  text: "#d4d4d4",
  dim: "#858585",
  guide: "#4b4b4b",
  check: "#6a9955",
  selected: "#4fc1ff",
  partial: "#dcdcaa",
  error: "#f14c4c",
  accent: "#569cd6",
  border: "#3c3c3c",
  panel: "#252526",
  headerBg: "#1e1e1e",
  footerBg: "#1e1e1e",
  selectionBg: "#264f78",
  selectionFg: "#ffffff",
}

export const theme: Theme = darkTheme

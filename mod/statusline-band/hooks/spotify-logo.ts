// Beatbot, Spotify's little headphone-wearing companion under Clawd. Raster draws two pixels per
// terminal cell, including in Warp. Each string is one pixel row, top first; letters name colors below.
//
// The box under Clawd is LOGO_COLUMNS cells wide and LOGO_ROWS cells tall, so the grid is LOGO_COLUMNS
// pixels wide and LOGO_ROWS * 2 tall. A cell is about twice as tall as wide, so one pixel is about square.
import { CLEAR } from './logic'

export const LOGO_COLUMNS = 8
export const LOGO_ROWS = 3

// Each letter's color, as 0xRRGGBB; "." is clear, the terminal's own background
export const PALETTE: Record<string, number> = {
  '.': CLEAR,
  G: 0x1ed760, // Spotify green
  K: 0x121212, // eyes
  A: 0x18833b, // smile and closed eyes
  H: 0x167c3b, // headphone band
  C: 0xb5ffce, // mint ear cushions
}

export const LOGO: string[] = [
  '..HHHH..',
  '.HGGGGH.',
  'CGKGGKGC',
  'CGGAAGGC',
  '.GGGGGG.',
  '..G..G..',
]

// A relaxed stance between steps keeps the dance gentle at this small size.
export const DANCE_FRAMES: string[][] = [
  LOGO,
  [
    '..HHHH..',
    '.HGGGGH.',
    'CGKGGKGC',
    'CGGAAGGC',
    'GGGGGGG.',
    '.GG..G..',
  ],
  LOGO,
  [
    '..HHHH..',
    '.HGGGGH.',
    'CGKGGKGC',
    'CGGAAGGC',
    '.GGGGGGG',
    '..G..GG.',
  ],
]

export const BLINK_FRAME = LOGO.map(row => row.replaceAll('K', 'A'))

// Beatbot, Spotify's little headphone-wearing companion under Clawd. Raster draws two pixels per
// terminal cell, including in Warp. Each string is one pixel row, top first; letters name colors below.
//
// The box under Clawd is LOGO_COLUMNS cells wide and LOGO_ROWS cells tall, so the grid is LOGO_COLUMNS
// pixels wide and LOGO_ROWS * 2 tall. A cell is about twice as tall as wide, so one pixel is about square.
import { CLEAR } from './logic'

// Two columns wider than Beatbot, so the dance can sway him a pixel each way
export const LOGO_COLUMNS = 10
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

// Beatbot in the middle of his box, or swayed a pixel left or right
const place = (rows: string[], at: 'left' | 'middle' | 'right') =>
  rows.map(row => (at === 'left' ? `${row}..` : at === 'right' ? `..${row}` : `.${row}.`))

// One step at a time, so each frame differs from the last by little and the dance reads smooth: sway
// right with a glance and an arm and leg out, back to the middle with a happy squint, the same to the
// left, then a little hop with the legs tucked. One frame each DANCE_EVERY_MS while a track plays
const pose = (eyes: string, body: string, legs: string) => [LOGO[0] ?? '', LOGO[1] ?? '', eyes, LOGO[3] ?? '', body, legs]
const EYES = { ahead: 'CGKGGKGC', right: 'CGGKGGKC', left: 'CKGGKGGC', happy: 'CGAGGAGC' }
const BODY = { still: '.GGGGGG.', right: '.GGGGGGG', left: 'GGGGGGG.' }
const LEGS = { still: '..G..G..', right: '..G...G.', left: '.G...G..', hop: '........' }

export const STANDING = place(LOGO, 'middle')

export const DANCE_FRAMES: string[][] = [
  place(pose(EYES.ahead, BODY.still, LEGS.still), 'middle'),
  place(pose(EYES.right, BODY.still, LEGS.still), 'right'),
  place(pose(EYES.right, BODY.right, LEGS.right), 'right'),
  place(pose(EYES.happy, BODY.still, LEGS.still), 'middle'),
  place(pose(EYES.left, BODY.still, LEGS.still), 'left'),
  place(pose(EYES.left, BODY.left, LEGS.left), 'left'),
  place(pose(EYES.happy, BODY.still, LEGS.still), 'middle'),
  place(pose(EYES.happy, BODY.still, LEGS.hop), 'middle'),
]

export const BLINK_FRAME = STANDING.map(row => row.replaceAll('K', 'A'))

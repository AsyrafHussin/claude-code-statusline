// The Spotify logo under Clawd, drawn as pixels: Warp shows no pictures, so it is a Raster, two pixels a
// cell. Each string is one row of pixels, top first, all of one length; each letter is a color below. An
// empty LOGO falls back to the official PNG as an Image, which only kitty and Ghostty draw.
//
// The box under Clawd is LOGO_COLUMNS cells wide and LOGO_ROWS cells tall, so the grid is LOGO_COLUMNS
// pixels wide and LOGO_ROWS * 2 tall. A cell is about twice as tall as wide, so one pixel is about square.
import { CLEAR } from './logic'

export const LOGO_COLUMNS = 7
export const LOGO_ROWS = 3

// Each letter's color, as 0xRRGGBB; "." is clear, the terminal's own background
export const PALETTE: Record<string, number> = {
  '.': CLEAR,
  G: 0x1ed760, // Spotify green
  K: 0x121212, // the arcs
}

export const LOGO: string[] = []

/**
 * The colours the estate map is painted in.
 *
 * The upstream plugin packs these cells for a terminal `Raster` element it
 * owns; OpenTUI's text elements have no cell buffer, so the map keeps the cells as plain colours
 * and the panel paints them with the terminal's own ANSI sequences.
 */

export type Cell = { glyph: string; fg: number; bg: number }

/** The terminal's own default colour. */
export const DEFAULT_COLOR = 0x01000000

/** `0x00RRGGBB` from three 0-255 channels. */
export const rgb = (r: number, g: number, b: number): number =>
  ((Math.max(0, Math.min(255, Math.round(r))) << 16) |
    (Math.max(0, Math.min(255, Math.round(g))) << 8) |
    Math.max(0, Math.min(255, Math.round(b)))) >>>
  0

/** `a` moved `t` of the way (0 to 1) toward `b`, channel by channel. */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ch = (c: number, shift: number) => (c >> shift) & 0xff

  return rgb(
    ch(a, 16) + (ch(b, 16) - ch(a, 16)) * k,
    ch(a, 8) + (ch(b, 8) - ch(a, 8)) * k,
    ch(a, 0) + (ch(b, 0) - ch(a, 0)) * k,
  )
}

/** Perceived brightness, 0 to 255. */
export const luma = (color: number): number =>
  0.299 * ((color >> 16) & 0xff) + 0.587 * ((color >> 8) & 0xff) + 0.114 * (color & 0xff)


import type { Vec } from '../game/types'

// 2.5D view: the board stage is tilted with CSS `perspective` + `rotateX`. Konva knows nothing about it, so pointer
// positions are mapped back from the screen to the flat stage with the closed-form inverse of that projection.
// Both maps are relative to the centre of a `w`×`h` root box (CSS default transform-origin and perspective-origin).

export const TILT_DEG = 42
/** The board is fitted this much smaller when tilted: the near edge is magnified by the perspective. */
export const TILT_FIT = 0.8
/** Height of a token's base in inches; drawn as a cylinder side. */
const BASE_HEIGHT = 0.22

const rad = TILT_DEG * Math.PI / 180
const sin = Math.sin(rad), cos = Math.cos(rad)

/** Lift in stage inches for an object `inches` tall: the stage is squashed by cos(tilt) on screen, so a vertical screen height needs 1/cos. */
export const liftOf = (inches: number) => inches / cos
export const TOKEN_LIFT = liftOf(BASE_HEIGHT)

/** CSS `perspective` distance for a root box of this height. */
export const tiltPerspective = (h: number) => 1.5 * h

/** Flat stage point -> where it lands on the screen (both relative to the root's top-left). */
export function tiltPoint(p: Vec, w: number, h: number): Vec {
  const P = tiltPerspective(h)
  const x = p.x - w / 2, y = p.y - h / 2
  const k = P / (P - y * sin)
  return { x: x * k + w / 2, y: y * cos * k + h / 2 }
}

/** Screen point -> the flat stage point under it (inverse of `tiltPoint`). */
export function untiltPoint(p: Vec, w: number, h: number): Vec {
  const P = tiltPerspective(h)
  const sx = p.x - w / 2, sy = p.y - h / 2
  const y = (sy * P) / (P * cos + sy * sin)
  const x = (sx * (P - y * sin)) / P
  return { x: x + w / 2, y: y + h / 2 }
}

/** The Konva canvas as a box in root coordinates: its top-left is (-ox, -oy). Tilted, it is the bounding box of what the
 * four screen corners show: the far edge of a root-sized plane would be a trapezoid cutting the map off, but the box is
 * kept as small as it can be, because canvas pixels are the main cost of this view. */
export function stageBox(w: number, h: number, tilt: boolean) {
  if (!tilt) return { sw: w, sh: h, ox: 0, oy: 0 }
  const c = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => untiltPoint({ x, y }, w, h))
  const minX = Math.floor(Math.min(...c.map((p) => p.x))) - 2, maxX = Math.ceil(Math.max(...c.map((p) => p.x))) + 2
  const minY = Math.floor(Math.min(...c.map((p) => p.y))) - 2, maxY = Math.ceil(Math.max(...c.map((p) => p.y))) + 2
  return { sw: maxX - minX, sh: maxY - minY, ox: -minX, oy: -minY }
}

/** Device pixels per CSS pixel for the canvas: capped when tilted (perspective blurs the detail anyway). */
export const canvasRatio = (tilt: boolean) => Math.min(window.devicePixelRatio || 1, tilt ? 1.25 : Infinity)

export const tiltCss = (h: number) => ({
  wrap: { perspective: `${tiltPerspective(h)}px` },
  stage: { transform: `rotateX(${TILT_DEG}deg)` },
})

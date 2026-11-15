import { describe, expect, it } from 'vitest'
import { stageBox, tiltPoint, untiltPoint } from './tilt'

describe('2.5D tilt', () => {
  it('round-trips stage and screen points', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 123, y: 456 }, { x: 400, y: 300 }]) {
      const back = untiltPoint(tiltPoint(p, 800, 600), 800, 600)
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.y).toBeCloseTo(p.y, 6)
    }
  })
  it('keeps the centre fixed and magnifies the near (bottom) edge over the far one', () => {
    expect(tiltPoint({ x: 400, y: 300 }, 800, 600)).toEqual({ x: 400, y: 300 })
    const near = tiltPoint({ x: 0, y: 600 }, 800, 600), far = tiltPoint({ x: 0, y: 0 }, 800, 600)
    expect(400 - near.x).toBeGreaterThan(400 - far.x)
  })
  it('the tilted canvas covers every corner of the root', () => {
    const w = 800, h = 600
    const { sw, sh, ox, oy } = stageBox(w, h, true)
    // canvas corners (root coords) projected on screen: the far edge must be above the screen top, sides outside it
    const topLeft = tiltPoint({ x: -ox, y: -oy }, w, h), topRight = tiltPoint({ x: sw - ox, y: -oy }, w, h)
    const bottomLeft = tiltPoint({ x: -ox, y: sh - oy }, w, h)
    expect(topLeft.y).toBeLessThanOrEqual(0)
    expect(topLeft.x).toBeLessThanOrEqual(0)
    expect(topRight.x).toBeGreaterThanOrEqual(w)
    expect(bottomLeft.y).toBeGreaterThanOrEqual(h)
    // the screen's top corners map back inside the canvas
    const c = untiltPoint({ x: 0, y: 0 }, w, h)
    expect(c.x).toBeGreaterThanOrEqual(-ox)
    expect(c.y).toBeGreaterThanOrEqual(-oy)
  })
})

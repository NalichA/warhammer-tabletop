import type { CSSProperties, ReactNode, Ref } from 'react'
import { boxOf } from '../game/terrainLayout'
import type { Terrain } from '../game/types'
import type { Viewport } from '../view/transform'

// 2.5D: terrain as real CSS 3D boxes. They live in the same tilted, `preserve-3d` container as the Konva canvas, so the
// browser does the perspective and the hiding (a wall covers what stands behind it). Pointer events pass through to
// the canvas, which still draws and handles the flat footprint.

/** Height in inches. */
const HEIGHT: Record<Terrain['kind'], number> = { ruin: 3, container: 2, barricade: 1, woods: 0, crater: 0 }
const WALL = 0.3

interface Look { top: string; front: string; side: string; edge: string }

/** One face of a box; `rot` stands it up on its ground edge. */
function Face({ style, bg, edge, children }: { style: CSSProperties; bg: string; edge: string; children?: ReactNode }) {
  return <div style={{ position: 'absolute', background: bg, boxShadow: `inset 0 0 0 1.5px ${edge}`, ...style }}>{children}</div>
}

/** A box on the table: x, y, w, d on the ground, h tall (all CSS px). The south face is the one the camera sees. */
function Block({ x, y, w, d, h, look, frontDecor, topBg }: { x: number; y: number; w: number; d: number; h: number; look: Look; frontDecor?: ReactNode; topBg?: string }) {
  const { edge } = look
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: d, transformStyle: 'preserve-3d' }}>
      <div style={{ position: 'absolute', inset: 0, transform: `translate3d(${h * 0.3}px, ${h * 0.2}px, 0.5px)`, background: 'rgba(0,0,0,0.35)' }} />
      <Face edge={edge} bg={look.front} style={{ left: 0, top: d, width: w, height: h, transformOrigin: '50% 0', transform: 'rotateX(90deg)' }}>{frontDecor}</Face>
      <Face edge={edge} bg={look.front} style={{ left: 0, top: -h, width: w, height: h, transformOrigin: '50% 100%', transform: 'rotateX(-90deg)' }} />
      <Face edge={edge} bg={look.side} style={{ left: -h, top: 0, width: h, height: d, transformOrigin: '100% 50%', transform: 'rotateY(90deg)' }} />
      <Face edge={edge} bg={look.side} style={{ left: w, top: 0, width: h, height: d, transformOrigin: '0 50%', transform: 'rotateY(-90deg)' }} />
      <Face edge={edge} bg={topBg ?? look.top} style={{ left: 0, top: 0, width: w, height: d, transform: `translateZ(${h}px)` }} />
    </div>
  )
}

const ribs = (angle: number, a: string, b: string, step: number) => `repeating-linear-gradient(${angle}deg, ${a} 0 ${step / 2}px, ${b} ${step / 2}px ${step}px)`

function Piece({ t, s }: { t: Terrain; s: number }) {
  const b = boxOf(t)
  const h = HEIGHT[t.kind] * s
  if (h <= 0) return null
  const long = b.w >= b.h
  const x = b.x * s, y = b.y * s, w = b.w * s, d = b.h * s
  if (t.kind === 'container') {
    const look: Look = { top: '#c2603f', front: '#8a3624', side: '#6a2a1b', edge: 'rgba(255,200,170,0.85)' }
    const along = long ? 90 : 0
    return (
      <Block x={x} y={y} w={w} d={d} h={h} look={look}
        topBg={ribs(along, '#c2603f', '#a8502f', 0.3 * s)}
        frontDecor={<div style={{ position: 'absolute', inset: 0, background: ribs(90, 'transparent', 'rgba(60,18,10,0.55)', 0.3 * s) }} />} />
    )
  }
  if (t.kind === 'barricade') {
    const look: Look = { top: '#57534e', front: '#1c1917', side: '#292524', edge: 'rgba(255,214,140,0.9)' }
    return <Block x={x} y={y} w={w} d={d} h={h} look={look} frontDecor={<div style={{ position: 'absolute', inset: 0, background: ribs(45, '#f59e0b', '#1c1917', 0.5 * s) }} />} />
  }
  // ruin: four walls around an open floor; the near wall has window gaps
  const wall = Math.min(WALL * s, w / 3, d / 3)
  const look: Look = { top: '#dbeafe', front: '#1f4e80', side: '#173d66', edge: 'rgba(207,233,255,0.85)' }
  const win = Math.max(1, Math.floor(b.w / 1.3))
  const windows = Array.from({ length: win }, (_, i) => (
    i % 3 === 1 ? null : <div key={i} style={{ position: 'absolute', left: `${((i + 0.25) / win) * 100}%`, top: '25%', width: `${(0.5 / win) * 100}%`, height: '50%', background: '#0a1c33' }} />
  ))
  return (
    <>
      <Block x={x} y={y} w={w} d={wall} h={h} look={look} />
      <Block x={x} y={y + d - wall} w={w} d={wall} h={h} look={look} frontDecor={windows} />
      <Block x={x} y={y + wall} w={wall} d={d - 2 * wall} h={h} look={look} />
      <Block x={x + w - wall} y={y + wall} w={wall} d={d - 2 * wall} h={h} look={look} />
    </>
  )
}

/** The 3D layer: positioned like the Konva stage (its x/y/scale come from the viewport). `layerRef` lets the board move it
 * while the stage is dragged, without re-rendering. */
export function TerrainBoxes({ terrain, view, layerRef }: { terrain: Terrain[]; view: Viewport; layerRef: Ref<HTMLDivElement> }) {
  return (
    <div ref={layerRef} className="pointer-events-none absolute left-0 top-0" style={{ transformStyle: 'preserve-3d' }} aria-hidden>
      <div style={{ position: 'absolute', left: view.x, top: view.y, transformStyle: 'preserve-3d' }}>
        {terrain.map((t) => <Piece key={t.id} t={t} s={view.scale} />)}
      </div>
    </div>
  )
}

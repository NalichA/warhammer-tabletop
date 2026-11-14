import { describe, expect, it } from 'vitest'
import { composeUnit, listPoints, listProblems, maxCopies, type ArmyList } from '../army/armyList'
import { decide } from '../ai/ai'
import { WEAPONS } from '../data/datasheets'
import { seededRoller } from '../dice/dice'
import { apply, meleeSetup, shockFailChance, shootPlan, unitActions, validate } from '../engine'
import { newUnit, objectiveLevels, profileOf } from '../gameState'
import { chooseCanticle } from '../rules/cawl'
import { loneOperative } from '../rules/enginseer'
import type { Command, GameState, PlayerId, UnitState, Vec } from '../types'
import { battle, column, endPhase } from './helpers'

// Belisarius Cawl (11th edition): Canticles of the Omnissiah (Machine Vengeance re-rolls, Mantra of Discipline +1 OC and
// Leadership, Shroudpsalm Stealth), Mechanicus Bodyguard (Lone Operative next to a friendly unit), Self-repair Mechanisms.

const AM: PlayerId = 'adeptus_mechanicus'

function make(owner: PlayerId, datasheetId: string, at: Vec[], id: string): UnitState {
  return newUnit(id, datasheetId, owner, id, composeUnit(datasheetId, at.length).map((p, i) => [p, at[i]]))
}

/** Mechanicus against Orks with only the given units on the board, in `active`'s `phase`. */
function board(phase: GameState['phase'], active: PlayerId, ...units: UnitState[]): GameState {
  const s = battle(AM, 'orks', phase, active)
  s.units = units
  return s
}

const cawl = (at: Vec, id = 'cawl') => make(AM, 'belisariusCawl', [at], id)
const rangers = (x: number, id = 'rangers') => make(AM, 'rangers', column(x, 4, 10, 1.1), id)
const boyz = (x: number, id = 'boyz') => make('orks', 'boyz', column(x, 4, 10, 1.2), id)
const sing = (u: UnitState, canticle: Extract<Command, { type: 'canticle' }>['canticle'], targetId?: string): Command => ({ type: 'canticle', unitId: u.id, canticle, ...(targetId ? { targetId } : {}) })
const logText = (s: GameState) => s.log.map((l) => l.text).join('\n')
const unit = (s: GameState, id: string) => s.units.find((u) => u.id === id)!

describe('Belisarius Cawl: the datasheet and the army builder', () => {
  it('has the 11th-edition profile and weapons and costs 220 points', () => {
    const p = profileOf({ id: 'x', profileId: 'belisariusCawl', pos: { x: 0, y: 0 }, wounds: 10, destroyed: false })
    expect([p.m, p.t, p.sv, p.w, p.ld, p.oc, p.invuln, p.baseMm, p.character]).toEqual([8, 8, 2, 10, 6, 3, 4, 86, true])
    expect(p.weapons).toEqual(['solarAtomiser', 'arcScourge', 'cawlAxe', 'mechadendriteHive'])
    expect(WEAPONS.mechadendriteHive.profiles[0].randomA).toBe('2D6')
    expect(WEAPONS.arcScourge.profiles[0].keywords.anti).toEqual({ keyword: 'VEHICLE', roll: 4 })
    expect(listPoints({ limit: 1000, units: [{ datasheetId: 'belisariusCawl', size: 1 }] })).toBe(220)
  })

  it('is an Epic Hero: one per army', () => {
    expect(maxCopies('belisariusCawl')).toBe(1)
    expect(maxCopies('rangers')).toBe(6)
    const one: ArmyList = { limit: 1000, units: [{ datasheetId: 'belisariusCawl', size: 1 }, { datasheetId: 'rangers', size: 10 }] }
    expect(listProblems(AM, one)).toEqual([])
    const two: ArmyList = { limit: 1000, units: [{ datasheetId: 'belisariusCawl', size: 1 }, { datasheetId: 'belisariusCawl', size: 1 }] }
    expect(listProblems(AM, two).join(' ')).toMatch(/не больше 1/)
  })
})

describe('Self-repair Mechanisms and the canticle at the start of the Command phase', () => {
  it('Cawl regains D3 wounds and the game picks a canticle before the Battle-shock tests', () => {
    const c = cawl({ x: 10, y: 20 })
    const s = board('fight', 'orks', c, rangers(12), boyz(30))
    c.models[0].wounds = 5
    const after = endPhase(s, seededRoller(7))
    expect(after.phase).toBe('command')
    expect(after.activePlayer).toBe(AM)
    const w = unit(after, 'cawl').models[0].wounds
    expect(w).toBeGreaterThanOrEqual(6)
    expect(w).toBeLessThanOrEqual(8)
    expect(logText(after)).toMatch(/Механизмы самопочинки — D3 = \d, восстановлено ран: \d/)
    // the Boyz are in reach: Machine Vengeance against them, picked automatically
    expect(unit(after, 'cawl').canticle).toBe('machineVengeance')
    expect(unit(after, 'cawl').vengeanceTargetId).toBe('boyz')
    expect(logText(after)).toMatch(/Песнопения Омниссии — Воззвание к машинной мести против «.*» \(выбрано автоматически/)
  })

  it('does not roll for an undamaged Cawl', () => {
    const s = board('fight', 'orks', cawl({ x: 10, y: 20 }), boyz(30))
    expect(logText(endPhase(s, seededRoller(7)))).not.toMatch(/самопочинки/)
  })

  it('picks Mantra of Discipline when friends nearby hold objectives, and Shroudpsalm when no enemy is in reach', () => {
    const c = cawl({ x: 10, y: 20 })
    const r1 = rangers(13, 'r1'), r2 = rangers(15, 'r2')
    const s = board('command', AM, c, r1, r2, boyz(30))
    s.objectives = [{ id: 'o1', pos: { x: 14, y: 8 } }] as GameState['objectives']
    expect(chooseCanticle(s, c).canticle).toBe('mantraDiscipline')
    s.objectives = []
    s.units = [c, r1, r2, boyz(55)]
    expect(chooseCanticle(s, c).canticle).toBe('shroudpsalm')
  })
})

describe('Canticles of the Omnissiah', () => {
  it('the player can change the canticle in the Command phase, not in another phase', () => {
    const c = cawl({ x: 10, y: 20 })
    const s = board('command', AM, c, rangers(12), boyz(30))
    const ids = unitActions(s, 'cawl').map((a) => a.id)
    expect(ids).toContain('canticle:mantraDiscipline')
    expect(ids).toContain('canticle:shroudpsalm')
    expect(ids).toContain('canticle:machineVengeance:boyz')
    const after = apply(s, sing(c, 'mantraDiscipline'), seededRoller(1))
    expect(unit(after, 'cawl').canticle).toBe('mantraDiscipline')
    expect(unit(after, 'cawl').vengeanceTargetId).toBeUndefined()
    expect(validate(after, sing(unit(after, 'cawl'), 'mantraDiscipline')).ok).toBe(false)
    expect(validate(board('shooting', AM, c, boyz(30)), sing(c, 'shroudpsalm')).ok).toBe(false)
    // Machine Vengeance needs an enemy unit
    expect(validate(s, sing(c, 'machineVengeance', 'rangers')).ok).toBe(false)
  })

  it('Invocation of Machine Vengeance: friendly Mechanicus units re-roll hits against the target only', () => {
    const c = cawl({ x: 10, y: 30 })
    const r = rangers(12)
    const b = boyz(30)
    const other = boyz(34, 'other')
    const s = board('shooting', AM, c, r, b, other)
    c.canticle = 'machineVengeance'
    c.vengeanceTargetId = 'boyz'
    const plan = shootPlan(s, r, b, { assumeSight: true })
    expect(plan.groups.length).toBeGreaterThan(0)
    for (const g of plan.groups) {
      expect(g.ctx.rerollHits).toBe('all')
      expect(g.notes.join(' ')).toMatch(/Машинная месть/)
    }
    for (const g of shootPlan(s, r, other, { assumeSight: true }).groups) expect(g.ctx.rerollHits).toBeUndefined()
    // in melee too
    const melee = meleeSetup(s, c, b, WEAPONS.cawlAxe.profiles[0], c.models[0])
    expect(melee.ctx.rerollHits).toBe('all')
    // a sung canticle does not help the enemy
    expect(shootPlan(s, b, r, { assumeSight: true }).groups.every((g) => g.ctx.rerollHits === undefined)).toBe(true)
  })

  it('Shroudpsalm: friendly Mechanicus units within 6″ of Cawl have Stealth (cover against shooting)', () => {
    const c = cawl({ x: 10, y: 9 })
    const r = rangers(12)
    const b = boyz(24)
    const s = board('shooting', 'orks', c, r, b)
    expect(shootPlan(s, b, r, { assumeSight: true }).cover).toBe(false)
    c.canticle = 'shroudpsalm'
    expect(shootPlan(s, b, r, { assumeSight: true }).cover).toBe(true)
    // farther than 6″: no Stealth
    c.models[0].pos = { x: 1, y: 40 }
    expect(shootPlan(s, b, r, { assumeSight: true }).cover).toBe(false)
  })

  it('Mantra of Discipline: +1 OC per model and +1 to Battle-shock tests within 6″', () => {
    const c = cawl({ x: 10, y: 9 })
    const r = rangers(12)
    const s = board('command', AM, c, r, boyz(40))
    s.objectives = [{ id: 'o1', pos: { x: 12, y: 8 } }] as GameState['objectives']
    const plain = objectiveLevels(s, s.objectives[0])[AM]
    const shock = shockFailChance(s, r)
    c.canticle = 'mantraDiscipline'
    const near = r.models.filter((m) => Math.hypot(m.pos.x - 12, m.pos.y - 8) <= 3.8).length
    expect(objectiveLevels(s, s.objectives[0])[AM]).toBeGreaterThan(plain)
    expect(objectiveLevels(s, s.objectives[0])[AM] - plain).toBeGreaterThanOrEqual(near)
    expect(shockFailChance(s, r)).toBeLessThan(shock)
  })
})

describe('Mechanicus Bodyguard', () => {
  it('Cawl within 3″ of a friendly Mechanicus unit has Lone Operative: shot only from within 12″', () => {
    const c = cawl({ x: 10, y: 10 })
    const r = rangers(14)
    const b = boyz(21)
    const s = board('shooting', 'orks', c, r, b)
    expect(loneOperative(s, c)).toBe(true)
    expect(shootPlan(s, b, c, { assumeSight: true }).problem).toBeNull()
    for (const m of b.models) m.pos = { x: m.pos.x + 6, y: m.pos.y }
    expect(shootPlan(s, b, c, { assumeSight: true }).problem).toMatch(/Одиночка/)
    // alone, he is an ordinary target
    s.units = [c, b]
    expect(loneOperative(s, c)).toBe(false)
  })
})

describe('the AI', () => {
  it('plays a Command phase with Cawl without errors', () => {
    const c = cawl({ x: 10, y: 20 })
    let s = board('fight', 'orks', c, rangers(12), boyz(30))
    c.models[0].wounds = 4
    s = endPhase(s, seededRoller(3))
    for (let i = 0; i < 10 && s.phase === 'command' && !s.winner; i++) {
      const d = decide(s)
      if (!d) break
      expect(validate(s, d.cmd).ok).toBe(true)
      s = apply(s, d.cmd, seededRoller(i))
      while (s.reaction && !s.winner) s = apply(s, { type: 'passReaction' }, seededRoller(i))
    }
    expect(unit(s, 'cawl').canticle).toBeDefined()
  })
})

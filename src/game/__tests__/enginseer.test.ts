import { describe, expect, it } from 'vitest'
import { attachments, composeUnit, listPoints, listProblems, type ArmyList } from '../army/armyList'
import { decide } from '../ai/ai'
import { WEAPONS } from '../data/datasheets'
import { seededRoller } from '../dice/dice'
import { apply, meleeSetup, shootPlan, unitActions, validate } from '../engine'
import { newUnit, profileOf } from '../gameState'
import { attachUnit } from '../rules/attached'
import { blessingOptions, loneOperative, noteWrecks } from '../rules/enginseer'
import type { Command, GameState, PlayerId, UnitState, Validation, Vec } from '../types'
import { battle, column, endPhase } from './helpers'

// Tech-Priest Enginseer (11th edition): Omnissiah's Blessing repairs a friendly Mechanicus model in the Command phase,
// Enginseer gives Lone Operative next to a friendly vehicle, Vengeance for the Omnissiah raises the axe to 6 attacks.

const AM: PlayerId = 'adeptus_mechanicus'

/** A unit of `datasheetId` with one model at each position. */
function make(owner: PlayerId, datasheetId: string, at: Vec[], id: string): UnitState {
  return newUnit(id, datasheetId, owner, id, composeUnit(datasheetId, at.length).map((p, i) => [p, at[i]]))
}

/** Mechanicus against Orks with only the given units on the board, in Mechanicus's `phase`. */
function board(phase: GameState['phase'], ...units: UnitState[]): GameState {
  const s = battle(AM, 'orks', phase, AM)
  s.units = units
  return s
}

const enginseer = (at: Vec, id = 'eng') => make(AM, 'techEnginseer', [at], id)
const onager = (at: Vec, id = 'onager') => make(AM, 'onager', [at], id)
const boyz = (x: number) => make('orks', 'boyz', column(x, 4, 10, 1.2), 'boyz')
const bless = (u: UnitState, t: UnitState, m = t.models[0]): Command => ({ type: 'blessing', unitId: u.id, targetId: t.id, modelId: m.id })
const why = (v: Validation) => (v.ok ? '' : v.reason)
const logText = (s: GameState) => s.log.map((l) => l.text).join('\n')

describe('Tech-Priest Enginseer: the datasheet and the army builder', () => {
  it('has the 11th-edition profile, 55 points and leads the Tech-Priests’ units', () => {
    const p = profileOf({ id: 'x', profileId: 'techEnginseer', pos: { x: 0, y: 0 }, wounds: 3, destroyed: false })
    expect([p.m, p.t, p.sv, p.w, p.ld, p.oc, p.invuln, p.baseMm, p.character]).toEqual([6, 4, 3, 3, 7, 1, 5, 32, true])
    expect(p.weapons).toEqual(['enginseerPistol', 'enginseerAxe', 'servoArm'])
    const l: ArmyList = { limit: 1000, units: [{ datasheetId: 'techEnginseer', size: 1 }] }
    expect(listPoints(l)).toBe(55)
  })

  it('joins a unit of its list in the builder, or stays on its own', () => {
    const l: ArmyList = { limit: 1000, units: [{ datasheetId: 'techEnginseer', size: 1 }, { datasheetId: 'onager', size: 1 }, { datasheetId: 'rangers', size: 10 }] }
    expect(attachments(l)).toEqual([2, null, null])
    expect(listProblems(AM, l)).toEqual([])
    const alone: ArmyList = { ...l, units: [{ datasheetId: 'techEnginseer', size: 1, attachTo: null }, ...l.units.slice(1)] }
    expect(attachments(alone)).toEqual([null, null, null])
    expect(listProblems(AM, alone)).toEqual([])
    // the Onager is a vehicle, not on the Enginseer's list
    const bad: ArmyList = { ...l, units: [{ datasheetId: 'techEnginseer', size: 1, attachTo: 1 }, ...l.units.slice(1)] }
    expect(attachments(bad)[0]).toBeNull()
    expect(listProblems(AM, bad).length).toBeGreaterThan(0)
  })
})

describe('Omnissiah’s Blessing', () => {
  it('repairs a damaged vehicle within 3″ by D3 wounds and gives it Feel No Pain 5+, with a log line', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    const s = board('command', e, o, boyz(30))
    o.models[0].wounds = 5
    expect(validate(s, bless(e, o)).ok).toBe(true)
    const after = apply(s, bless(e, o), seededRoller(3))
    const ao = after.units.find((u) => u.id === 'onager')!
    const healed = ao.models[0].wounds - 5
    expect(healed).toBeGreaterThanOrEqual(1)
    expect(healed).toBeLessThanOrEqual(3)
    expect(ao.blessingFnp).toEqual([o.models[0].id])
    expect(logText(after)).toMatch(/Благословение Омниссии — .* из «.*»: D3 = \d, восстановлено ран: \d, Feel No Pain 5\+/)
    // once per Command phase for the Enginseer
    expect(validate(after, bless(after.units.find((u) => u.id === 'eng')!, ao)).ok).toBe(false)
  })

  it('never heals above the Wounds characteristic', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    const s = board('command', e, o, boyz(30))
    o.models[0].wounds = 10
    for (let seed = 1; seed < 20; seed++) expect(apply(s, bless(e, o), seededRoller(seed)).units.find((u) => u.id === 'onager')!.models[0].wounds).toBe(11)
  })

  it('needs a friendly Mechanicus model within 3″, in your Command phase, and something to repair', () => {
    const e = enginseer({ x: 10, y: 10 })
    const far = onager({ x: 20, y: 10 }, 'far')
    const rangers = make(AM, 'rangers', column(11, 12, 10, 1.1), 'rangers')
    const b = boyz(12.5)
    const s = board('command', e, far, rangers, b)
    far.models[0].wounds = 3
    expect(why(validate(s, bless(e, far)))).toMatch(/3″/)
    expect(why(validate(s, bless(e, rangers)))).toMatch(/нечего/) // W1 Rangers have nothing to repair
    expect(validate(s, bless(e, e)).ok).toBe(false) // not itself
    expect(validate(s, { type: 'blessing', unitId: e.id, targetId: b.id, modelId: b.models[0].id }).ok).toBe(false)
    s.phase = 'movement'
    far.models[0].pos = { x: 13.5, y: 10 }
    expect(validate(s, bless(e, far)).ok).toBe(false)
    s.phase = 'command'
    expect(validate(s, bless(e, far)).ok).toBe(true)
    // an undamaged vehicle can still be blessed, for the Feel No Pain
    far.models[0].wounds = 11
    expect(validate(s, bless(e, far)).ok).toBe(true)
  })

  it('a blessed vehicle model has Feel No Pain 5+ against attacks until its owner’s next Command phase', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    let s = board('command', e, o, boyz(24))
    o.models[0].wounds = 6
    const r = seededRoller(5)
    s = apply(s, bless(e, o), r)
    const fnpOf = (st: GameState) => {
      const plan = shootPlan({ ...st, activePlayer: 'orks', phase: 'shooting' }, st.units.find((u) => u.id === 'boyz')!, st.units.find((u) => u.id === 'onager')!, { assumeSight: true })
      return plan.groups[0]?.ctx.fnpByModel?.[o.models[0].id]
    }
    expect(fnpOf(s)).toBe(5)
    // through the opponent's turn it stays; at the start of the Mechanicus Command phase it ends
    let guard = 0
    while (!(s.activePlayer === 'orks' && s.phase === 'shooting') && guard++ < 20) s = endPhase(s, r)
    expect(s.units.find((u) => u.id === 'onager')!.blessingFnp).toEqual([o.models[0].id])
    while (!(s.activePlayer === AM && s.phase === 'command') && guard++ < 40) s = endPhase(s, r)
    expect(s.units.find((u) => u.id === 'onager')!.blessingFnp).toBeUndefined()
    expect(fnpOf(s)).toBeUndefined()
  })

  it('a blessed model rolls Feel No Pain against the damage it takes', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    let s = board('command', e, o, boyz(16))
    s = apply(s, bless(e, o), seededRoller(1))
    s = { ...s, activePlayer: 'orks', phase: 'shooting' }
    let seen = false
    for (let seed = 1; seed < 30 && !seen; seed++) {
      const after = apply(s, { type: 'shoot', unitId: 'boyz', targetId: 'onager' }, seededRoller(seed))
      seen = after.diceLog.some((d) => d.steps.some((st) => st.meta?.kind === 'fnp' && st.target === '5+'))
    }
    expect(seen).toBe(true)
  })

  it('if the player does not pick, the most damaged vehicle is repaired at the end of the Command phase', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    const breachers = make(AM, 'breachers', [{ x: 10, y: 13 }, { x: 12.6, y: 13.5 }, { x: 8, y: 14 }], 'breachers')
    let s = board('command', e, o, breachers, boyz(30))
    o.models[0].wounds = 7
    breachers.models[0].wounds = 1
    expect(blessingOptions(s, e)[0].target.id).toBe('onager')
    s = endPhase(s, seededRoller(2))
    expect(s.phase).toBe('movement')
    expect(s.units.find((u) => u.id === 'onager')!.models[0].wounds).toBeGreaterThan(7)
    expect(s.units.find((u) => u.id === 'breachers')!.models[0].wounds).toBe(1)
    expect(logText(s)).toMatch(/Благословение Омниссии \(выбрано автоматически\)/)
  })

  it('the player sees one action per model it can repair, in the unit panel', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    const s = board('command', e, o, boyz(30))
    o.models[0].wounds = 4
    const acts = unitActions(s, e.id).filter((a) => a.id.startsWith('bless:'))
    expect(acts).toHaveLength(1)
    expect(acts[0].ok).toBe(true)
    expect(acts[0].label).toMatch(/потеряно ран: 7/)
  })

  it('an Enginseer leading Rangers repairs a vehicle near the unit', () => {
    const rangers = make(AM, 'rangers', column(10, 4, 10, 1.1), 'rangers')
    const unit = attachUnit(rangers, enginseer({ x: 11.5, y: 8 }))
    const o = onager({ x: 15, y: 8 })
    const s = board('command', unit, o, boyz(34))
    o.models[0].wounds = 2
    const best = blessingOptions(s, unit)[0]
    expect(best.target.id).toBe('onager')
    const after = apply(s, bless(unit, o), seededRoller(4))
    expect(after.units.find((u) => u.id === 'onager')!.models[0].wounds).toBeGreaterThan(2)
  })

  it('the AI repairs its damaged vehicle in the Command phase', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    const s = board('command', e, o, boyz(30))
    o.models[0].wounds = 3
    const d = decide(s, 'standard')!
    expect(d.cmd).toEqual(bless(e, o))
    expect(d.explanation).toMatch(/Благословение Омниссии/)
  })
})

describe('Enginseer: Lone Operative next to a friendly vehicle', () => {
  it('cannot be shot from farther than 12″ while on its own within 3″ of a Mechanicus vehicle', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 13.5, y: 10 })
    const b = boyz(20) // the Boyz' shootas reach 18″; the Enginseer is ~10″ away from the column
    const s: GameState = { ...board('shooting', e, o, b), activePlayer: 'orks' }
    expect(loneOperative(s, e)).toBe(true)
    // within 12″: allowed
    expect(shootPlan(s, b, e, { assumeSight: true }).problem).toBeNull()
    // move the Boyz back so that every model is farther than 12″, but still within shoota range of the Onager
    for (const m of b.models) m.pos = { x: m.pos.x + 4, y: m.pos.y }
    expect(shootPlan(s, b, e, { assumeSight: true }).problem).toMatch(/Lone Operative/)
    expect(shootPlan(s, b, o, { assumeSight: true }).problem).toBeNull()
    // away from the vehicle it is an ordinary target again
    e.models[0].pos = { x: 10, y: 20 }
    expect(loneOperative(s, e)).toBe(false)
  })

  it('has no Lone Operative while leading a unit', () => {
    const rangers = make(AM, 'rangers', column(10, 4, 10, 1.1), 'rangers')
    const unit = attachUnit(rangers, enginseer({ x: 11.5, y: 8 }))
    const s = board('shooting', unit, onager({ x: 14, y: 8 }), boyz(30))
    expect(loneOperative(s, unit)).toBe(false)
  })
})

describe('Vengeance for the Omnissiah', () => {
  const axe = WEAPONS.enginseerAxe.profiles[0]

  it('a friendly vehicle destroyed within 12″ gives the Enginseer’s axe 6 attacks for the rest of the battle', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 20, y: 10 })
    const b = boyz(11.5)
    const s = board('fight', e, o, b)
    expect(meleeSetup(s, e, b, axe, e.models[0]).profile.attacks).toBe(3)
    o.models[0].destroyed = true
    noteWrecks(s)
    expect(e.vengeance).toEqual([e.models[0].id])
    expect(meleeSetup(s, e, b, axe, e.models[0]).profile.attacks).toBe(6)
    // the servo-arm is unchanged
    expect(meleeSetup(s, e, b, WEAPONS.servoArm.profiles[0], e.models[0]).profile.attacks).toBe(1)
    expect(logText(s)).toMatch(/Месть за Омниссию/)
  })

  it('a vehicle destroyed farther away does not count, not even when the Enginseer walks up to the wreck later', () => {
    const e = enginseer({ x: 10, y: 10 })
    const o = onager({ x: 30, y: 10 })
    const s = board('fight', e, o, boyz(40))
    o.models[0].destroyed = true
    noteWrecks(s)
    expect(e.vengeance).toBeUndefined()
    e.models[0].pos = { x: 26, y: 10 }
    noteWrecks(s)
    expect(e.vengeance).toBeUndefined()
  })

  it('an army without an Enginseer keeps no record of wrecks', () => {
    const o = onager({ x: 30, y: 10 })
    const s = board('fight', o, boyz(40))
    o.models[0].destroyed = true
    noteWrecks(s)
    expect(s.players[AM].wrecks).toBeUndefined()
  })
})

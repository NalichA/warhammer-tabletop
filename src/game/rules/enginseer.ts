// Tech-Priest Enginseer (Adeptus Mechanicus, 11th-edition datasheet on Wahapedia, checked 2026-11-14): the army's only
// vehicle repair. Omnissiah's Blessing heals one friendly model in the Command phase (a VEHICLE also gets Feel No Pain 5+),
// Enginseer gives Lone Operative next to a friendly vehicle, Vengeance for the Omnissiah raises the axe to 6 attacks once a
// friendly vehicle is destroyed nearby. The engine applies them (engine.ts); see docs/mechanicus.md.
import { tr } from '../../i18n/index'
import { EPS } from '../geometry/geometry'
import { addLog, alive, hasAbility, hasKeyword, isDestroyed, modelDistance, modelHasAbility, profileOf, sidesOf, unitDistance } from '../gameState'
import { healModel } from './heal'
import { cawlLoneOperative } from './cawl'
import type { GameState, ModelState, PlayerId, UnitState } from '../types'

/** Omnissiah's Blessing: the repaired model is within 3″ of the Enginseer. */
export const BLESSING_RANGE = 3
/** Feel No Pain a blessed VEHICLE model gets until its owner's next Command phase. */
export const BLESSING_FNP = 5
/** Enginseer: Lone Operative while within 3″ of a friendly ADEPTUS MECHANICUS VEHICLE. */
export const ENGINSEER_VEHICLE_RANGE = 3
/** Lone Operative (core rules): only attackers within 12″ can shoot the unit. */
export const LONE_OPERATIVE_RANGE = 12
/** Vengeance for the Omnissiah: the destroyed vehicle model was within 12″ of the Enginseer. */
export const VENGEANCE_RANGE = 12
/** The Omnissian axe of an avenging Enginseer. */
export const VENGEANCE_ATTACKS = 6

const AM = 'ADEPTUS MECHANICUS'

/** The living Enginseer model of the unit (alone, or leading it), if any. */
export const enginseerModel = (u: UnitState): ModelState | undefined => alive(u).find((m) => modelHasAbility(u, m, 'omnissiahsBlessing'))

const lostWounds = (m: ModelState) => profileOf(m).w - m.wounds

/** Why the Enginseer of `u` cannot bless model `modelId` of `target` now, or null when it can. */
export function blessingProblem(s: GameState, u: UnitState, target: UnitState | undefined, modelId: string): string | null {
  if (s.phase !== 'command' || s.activePlayer !== u.owner) return tr('Omnissiah’s Blessing is used in your Command phase.')
  const eng = enginseerModel(u)
  if (!eng || !hasAbility(u, 'omnissiahsBlessing')) return tr('This unit has no Tech-Priest Enginseer.')
  if (u.blessed) return tr('The Enginseer has already used Omnissiah’s Blessing in this Command phase.')
  if (!target || isDestroyed(target) || target.owner !== u.owner) return tr('Pick a friendly unit.')
  if (!hasKeyword(target, AM)) return tr('Omnissiah’s Blessing repairs only Adeptus Mechanicus models.')
  const m = alive(target).find((x) => x.id === modelId)
  if (!m) return tr('The model was not found or is destroyed.')
  if (m.id === eng.id) return tr('The Enginseer does not repair itself.')
  if (target.blessedModels?.includes(m.id)) return tr('This model has already been picked for Omnissiah’s Blessing in this Command phase.')
  if (modelDistance(eng, m) > BLESSING_RANGE + EPS) return tr('The model is farther than {BLESSING_RANGE}″ from the Enginseer.', { BLESSING_RANGE })
  if (lostWounds(m) <= 0 && !hasKeyword(target, 'VEHICLE')) return tr('The model has lost no wounds: nothing to repair.')
  return null
}

export interface BlessingOption {
  target: UnitState
  model: ModelState
  /** higher is better: vehicles first, then the most wounds lost */
  score: number
}

/** Every model the Enginseer of `u` can bless now, best first: the most damaged VEHICLE, then the most damaged other model. */
export function blessingOptions(s: GameState, u: UnitState): BlessingOption[] {
  const eng = enginseerModel(u)
  if (!eng || u.blessed || !hasAbility(u, 'omnissiahsBlessing')) return []
  const out: BlessingOption[] = []
  for (const t of s.units) {
    if (t.owner !== u.owner || isDestroyed(t) || !hasKeyword(t, AM)) continue
    if (unitDistance(u, t) > BLESSING_RANGE + EPS) continue
    const vehicle = hasKeyword(t, 'VEHICLE')
    for (const m of alive(t)) {
      if (blessingProblem(s, u, t, m.id)) continue
      const lost = lostWounds(m)
      // D3 heals 2 on average: a wound lost beyond 3 cannot be healed now, but the model is still the one most at risk
      out.push({ target: t, model: m, score: (vehicle ? 1000 : 0) + Math.min(lost, 3) * 10 + lost + profileOf(m).w / 100 })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Omnissiah's Blessing: the model regains `wounds` lost wounds; a VEHICLE model gets Feel No Pain 5+ until its owner's
 * next Command phase. Mutates the state; returns the wounds regained and whether Feel No Pain was granted. */
export function bless(u: UnitState, target: UnitState, m: ModelState, wounds: number): { healed: number; fnp: boolean } {
  const healed = healModel(m, wounds)
  u.blessed = true
  target.blessedModels = [...(target.blessedModels ?? []), m.id]
  const fnp = hasKeyword(target, 'VEHICLE')
  if (fnp && !target.blessingFnp?.includes(m.id)) target.blessingFnp = [...(target.blessingFnp ?? []), m.id]
  return { healed, fnp }
}

/** The start of `p`'s Command phase: the blessings of the last one expire and every Enginseer may bless again. */
export function resetBlessings(s: GameState, p: PlayerId) {
  for (const u of s.units) {
    if (u.owner !== p) continue
    if (u.blessed) delete u.blessed
    if (u.blessedModels) delete u.blessedModels
    if (u.blessingFnp) delete u.blessingFnp
  }
}

/** Feel No Pain of single models from Omnissiah's Blessing, or undefined when none of the unit has it. */
export function blessingFnpByModel(u: UnitState): Record<string, number> | undefined {
  const ids = u.blessingFnp?.filter((id) => u.models.some((m) => m.id === id && !m.destroyed))
  return ids?.length ? Object.fromEntries(ids.map((id) => [id, BLESSING_FNP])) : undefined
}

/** Lone Operative: a Tech-Priest Enginseer on its own (not leading a unit) within 3″ of a friendly ADEPTUS MECHANICUS VEHICLE
 * (Enginseer), or Belisarius Cawl within 3″ of another friendly ADEPTUS MECHANICUS unit (Mechanicus Bodyguard). */
export function loneOperative(s: GameState, u: UnitState): boolean {
  if (cawlLoneOperative(s, u)) return true
  if (u.attached?.length || !hasAbility(u, 'enginseer') || isDestroyed(u)) return false
  return s.units.some((x) => x.owner === u.owner && x.id !== u.id && !isDestroyed(x) && hasKeyword(x, 'VEHICLE') && hasKeyword(x, AM) && unitDistance(u, x) <= ENGINSEER_VEHICLE_RANGE + EPS)
}

const hasEnginseer = (u: UnitState) => u.datasheetId === 'techEnginseer' || !!u.attached?.some((p) => p.datasheetId === 'techEnginseer')

/**
 * Vengeance for the Omnissiah: looks at the friendly ADEPTUS MECHANICUS VEHICLE models destroyed since the last call. Every
 * living Enginseer within 12″ of one of them gets the 6-attack axe for the rest of the battle. Called after each command,
 * so the wreck and the Enginseer stand where they were when the vehicle fell. Does nothing for an army without an Enginseer.
 */
export function noteWrecks(s: GameState) {
  for (const p of sidesOf(s)) {
    const mine = (us: UnitState[] | undefined) => (us ?? []).some((u) => u.owner === p && hasEnginseer(u))
    if (!mine(s.units) && !mine(s.reserves) && !mine(s.embarked)) continue
    const seen = s.players[p].wrecks ?? []
    const fresh = s.units
      .filter((u) => u.owner === p && hasKeyword(u, 'VEHICLE') && hasKeyword(u, AM))
      .flatMap((u) => u.models.filter((m) => m.destroyed && !seen.includes(m.id)))
    if (!fresh.length) continue
    s.players[p].wrecks = [...seen, ...fresh.map((m) => m.id)]
    for (const u of s.units) {
      if (u.owner !== p || isDestroyed(u)) continue
      for (const e of alive(u)) {
        if (!modelHasAbility(u, e, 'vengeanceOmnissiah') || u.vengeance?.includes(e.id)) continue
        if (!fresh.some((w) => modelDistance(e, w) <= VENGEANCE_RANGE + EPS)) continue
        u.vengeance = [...(u.vengeance ?? []), e.id]
        addLog(s, tr('{name}: Vengeance for the Omnissiah — a friendly vehicle fell nearby, the Enginseer’s Omnissian axe has {VENGEANCE_ATTACKS} attacks until the end of the battle.', { name: u.name, VENGEANCE_ATTACKS }), 'minimal')
      }
    }
  }
}

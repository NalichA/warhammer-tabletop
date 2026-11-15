// Belisarius Cawl (Adeptus Mechanicus, 11th-edition datasheet on Wahapedia, checked 2026-11-14), a named EPIC HERO.
// Canticles of the Omnissiah: one canticle per Command phase (Machine Vengeance re-rolls, Mantra of Discipline +1 OC and
// Leadership nearby, Shroudpsalm Stealth nearby). Mechanicus Bodyguard: Lone Operative next to a friendly unit.
// Self-repair Mechanisms: D3 wounds back at the start of the Command phase. The engine applies them (engine.ts); the aura
// check itself (`canticleAura`) lives in gameState.ts, because Objective Control needs it. See docs/mechanicus.md.
import { tr } from '../../i18n/index'
import { EPS } from '../geometry/geometry'
import { alive, atHalfStrength, CANTICLE_RANGE, hasAbility, hasKeyword, isDestroyed, profileOf, unitDistance, unitNearObjective } from '../gameState'
import type { Canticle, GameState, ModelState, PlayerId, UnitState } from '../types'

/** Mechanicus Bodyguard: Lone Operative while within 3″ of another friendly ADEPTUS MECHANICUS unit. */
export const BODYGUARD_RANGE = 3
/** How far from the friendly army an enemy unit counts as a Machine Vengeance candidate (the reach of most guns). */
const VENGEANCE_REACH = 24

const AM = 'ADEPTUS MECHANICUS'

export const CANTICLE_NAME: Record<Canticle, string> = {
  machineVengeance: tr('Invocation of Machine Vengeance'),
  mantraDiscipline: tr('Mantra of Discipline'),
  shroudpsalm: tr('Shroudpsalm'),
}

/** The living Belisarius Cawl model of the unit, if any. */
export const cawlModel = (u: UnitState): ModelState | undefined => (hasAbility(u, 'canticles') ? alive(u)[0] : undefined)

/** Why Cawl's unit `u` cannot sing canticle `c` now (with `targetId` for Machine Vengeance), or null when it can. */
export function canticleProblem(s: GameState, u: UnitState, c: Canticle, targetId?: string): string | null {
  if (s.phase !== 'command' || s.activePlayer !== u.owner) return tr('Canticles of the Omnissiah are chosen in your Command phase.')
  if (!cawlModel(u)) return tr('This unit has no Canticles of the Omnissiah.')
  if (!CANTICLE_NAME[c]) return tr('Unknown canticle.')
  if (c === 'machineVengeance') {
    const t = s.units.find((x) => x.id === targetId)
    if (!t || isDestroyed(t) || t.owner === u.owner) return tr('Pick an enemy unit as the Machine Vengeance target.')
  }
  if (u.canticle === c && (c !== 'machineVengeance' || u.vengeanceTargetId === targetId)) return tr('This canticle is already chosen.')
  return null
}

/** Cawl sings canticle `c` until the start of his owner's next Command phase. Mutates `u`. */
export function setCanticle(u: UnitState, c: Canticle, targetId?: string) {
  u.canticle = c
  if (c === 'machineVengeance' && targetId) u.vengeanceTargetId = targetId
  else delete u.vengeanceTargetId
}

/** The start of `p`'s Command phase: the canticles of the last one end. */
export function clearCanticles(s: GameState, p: PlayerId) {
  for (const u of s.units) {
    if (u.owner !== p) continue
    if (u.canticle) delete u.canticle
    if (u.vengeanceTargetId) delete u.vengeanceTargetId
  }
}

/** Invocation of Machine Vengeance: a friendly ADEPTUS MECHANICUS `attacker` re-rolls hit rolls against `target`. */
export const machineVengeance = (s: GameState, attacker: UnitState, target: UnitState) =>
  hasKeyword(attacker, AM)
  && s.units.some((x) => x.owner === attacker.owner && !isDestroyed(x) && x.canticle === 'machineVengeance' && x.vengeanceTargetId === target.id)

/** Every Machine Vengeance now: which living Cawl sings it against which living enemy unit (for the board and the card). */
export function vengeanceMarks(s: GameState): { source: UnitState; target: UnitState }[] {
  const out: { source: UnitState; target: UnitState }[] = []
  for (const u of s.units) {
    if (isDestroyed(u) || u.canticle !== 'machineVengeance' || !cawlModel(u)) continue
    const t = s.units.find((x) => x.id === u.vengeanceTargetId)
    if (t && !isDestroyed(t) && !t.embarkedIn) out.push({ source: u, target: t })
  }
  return out
}

const woundsLeft = (u: UnitState) => alive(u).reduce((a, m) => a + m.wounds, 0)

/** Enemy units worth a Machine Vengeance, best first: within 24″ of a friendly Mechanicus unit, the toughest (most wounds
 * left) first, then the nearest to Cawl. */
export function vengeanceTargets(s: GameState, u: UnitState): UnitState[] {
  const friends = s.units.filter((x) => x.owner === u.owner && !isDestroyed(x) && hasKeyword(x, AM))
  return s.units
    .filter((e) => e.owner !== u.owner && !isDestroyed(e) && friends.some((f) => unitDistance(f, e) <= VENGEANCE_REACH + EPS))
    .sort((a, b) => woundsLeft(b) - woundsLeft(a) || unitDistance(u, a) - unitDistance(u, b))
}

export interface CanticleChoice {
  canticle: Canticle
  targetId?: string
  /** why, for the log and the AI explanation */
  why: string
}

/**
 * The canticle the game picks for Cawl: Mantra of Discipline when two or more friendly units nearby are on an objective or
 * must take a Battle-shock test, else Machine Vengeance on the toughest enemy in reach, else Shroudpsalm when friends
 * stand near him, else Mantra of Discipline.
 */
export function chooseCanticle(s: GameState, u: UnitState): CanticleChoice {
  const near = s.units.filter((x) => x.owner === u.owner && !isDestroyed(x) && hasKeyword(x, AM) && unitDistance(u, x) <= CANTICLE_RANGE + EPS)
  const holding = near.filter((x) => s.objectives.some((o) => unitNearObjective(x, o))).length
  const shaky = near.filter((x) => atHalfStrength(x) && !x.battleShocked).length
  if (holding + shaky >= 2) return { canticle: 'mantraDiscipline', why: tr('{n} friendly units nearby hold objectives or test for Battle-shock', { n: holding + shaky }) }
  const t = vengeanceTargets(s, u)[0]
  if (t) return { canticle: 'machineVengeance', targetId: t.id, why: tr('“{name}” is the toughest enemy in reach ({w} wounds left)', { name: t.name, w: woundsLeft(t) }) }
  if (near.length >= 2) return { canticle: 'shroudpsalm', why: tr('no enemy in reach; {n} units near Cawl get Stealth', { n: near.length }) }
  return { canticle: 'mantraDiscipline', why: tr('no enemy in reach') }
}

/** Mechanicus Bodyguard: Cawl within 3″ of another friendly ADEPTUS MECHANICUS unit has Lone Operative. */
export const cawlLoneOperative = (s: GameState, u: UnitState) =>
  hasAbility(u, 'mechanicusBodyguard') && !isDestroyed(u)
  && s.units.some((x) => x.owner === u.owner && x.id !== u.id && !isDestroyed(x) && hasKeyword(x, AM) && unitDistance(u, x) <= BODYGUARD_RANGE + EPS)

/** Self-repair Mechanisms: the Cawl models of `p` that have lost wounds (they roll a D3 at the start of the Command phase). */
export const selfRepairing = (s: GameState, p: PlayerId) =>
  s.units.filter((u) => u.owner === p && !isDestroyed(u) && hasAbility(u, 'selfRepair'))
    .flatMap((u) => alive(u).filter((m) => m.wounds < profileOf(m).w).map((m) => ({ u, m })))

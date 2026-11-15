import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactionOption } from '../game/reactionAdvice'
import type { GameState } from '../game/types'
import { ReactionPrompt } from './ReactionPrompt'

// a big army: almost every unit can answer with Fire Overwatch
const options: ReactionOption[] = Array.from({ length: 6 }, (_, i) => ({
  cmd: { type: 'stratagem', player: 'adeptus_mechanicus', id: 'fireOverwatch', unitId: `u${i}`, targetId: 'foe' } as ReactionOption['cmd'],
  title: `Overwatch ${i}`,
  value: 6 - i,
  worth: true,
  why: '≈ 1 wound',
}))
vi.mock('../game/reactionAdvice', () => ({ reactionAdvice: () => options }))
vi.mock('../game/engine', async (orig) => ({ ...(await orig<typeof import('../game/engine')>()), reactionCommands: () => [] }))

const game = {
  reaction: { window: 'beforeShooting', player: 'adeptus_mechanicus' },
  players: { adeptus_mechanicus: { cp: 5 } },
  units: [],
} as unknown as GameState

describe('reaction prompt', () => {
  it('keeps «Skip» out of the scrolling list and shows the three best options first', () => {
    render(<ReactionPrompt game={game} human="adeptus_mechanicus" />)
    const list = screen.getByTestId('reaction-options')
    expect(list.className).toMatch(/overflow-y-auto/)
    expect(screen.getByRole('dialog').className).toMatch(/max-h-full/)
    // «Skip» stays below the list, always on screen
    const skip = screen.getByRole('button', { name: 'Пропустить' })
    expect(list.contains(skip)).toBe(false)
    // the three most valuable options are open, the rest wait behind «More useful options»
    for (const i of [0, 1, 2]) expect(screen.getByText(`Overwatch ${i}`).closest('details')).toBeNull()
    const more = screen.getByText('Ещё выгодные варианты (3)').closest('details')!
    for (const i of [3, 4, 5]) expect(within(more).getByText(`Overwatch ${i}`)).toBeInTheDocument()
  })
})

import { newFleet, type Fleet } from './fleet/fleet'
import type { Touch } from './map/estate'
import type { ReaderCache, ReviewLedger, Snapshot } from './reader/progress'
import type { TrackKey } from './reader/tracks'
import type { Rule } from './reader/rules'
import type { DeckScope } from './review/deck'

export const PANE_ID = 'modernize'
export const DECK_ID = 'modernize-review-pane'
export const SIGN_ID = 'modernize-sign'
export const RASTER_KEY = 'estate'
export const PLUGIN_NAME = 'code-modernization'

export type Options = {
  system: string
  /** Which way to follow the system: the one whose artifacts are newest (`auto`), or one named. */
  track: TrackKey | 'auto'
  panel: 'auto' | 'command' | 'off'
  isXrayOn: boolean
  commandPrefix: string
  legacyDir: string
}

/**
 * The raw settings the panel reads.
 *
 * The upstream plugin takes these from its own `userConfig` panel; pi has no
 * per-plugin settings screen, so they come from the workspace's
 * `.pi/settings.json` (or the agent's own settings) under one key.
 */
export type RawOptions = Record<string, unknown>

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** The options with their defaults applied, whatever the settings held. */
export function optionsOf(raw: RawOptions): Options {
  const str = (key: string, fallback: string) => {
    const value = raw[key]

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  }

  return {
    system: str('system', ''),
    track: pick(raw.track, ['auto', 'transform', 'uplift', 'reimagine'] as const, 'auto'),
    panel: pick(raw.panel, ['auto', 'command', 'off'] as const, 'auto'),
    isXrayOn: raw.xray !== false,
    // pi runs a skill as `/skill:<name>`, so the prefix is the skill command, not a plugin command.
    commandPrefix: str('commandPrefix', '/skill:modernize-'),
    legacyDir: str('legacyDir', 'legacy').replace(/^\.?\/+|\/+$/g, ''),
  }
}

export type RunningCall = {
  id: string
  tool: string
  subject: string
  startMs: number
  agentId?: string
}

export type FinishedCall = {
  tool: string
  subject: string
  isOk: boolean
  ms: number
  note?: string
}

export type Activity = {
  isWorking: boolean
  turnId: string | null
  turnStartMs: number
  /** The `/…modernize-<verb>` the current or last turn began with. */
  step: string | null
  running: Map<string, RunningCall>
  finished: FinishedCall[]
  xrays: number
  xraysThisTurn: number
}

export type DeckState = {
  isOpen: boolean
  scope: DeckScope
  filter: string
  queue: Rule[]
  index: number
  ledger: ReviewLedger
  /**
   * What this session set each rule to (null: its verdict taken back). The file is read again before it is written, and
   * these are laid on top of it, so a verdict the other writer (the review command) put there meanwhile is not lost.
   */
  edits: Map<string, ReviewLedger[string] | null>
  /** The source lines of the card in view, once asked for. */
  source: { ruleId: string; path: string; startLine: number; text: string } | null
  isSourceShown: boolean
}

export type SignState = {
  isOpen: boolean
  name: string
  covers: 'phase-1' | 'full'
  error: string | null
}

export type State = {
  cwd: string
  options: Options
  cache: ReaderCache
  snapshot: Snapshot | null
  readError: string | null
  activity: Activity
  touches: Map<string, Touch>
  fleet: Fleet
  deck: DeckState
  sign: SignState
}

export const newActivity = (): Activity => ({
  isWorking: false,
  turnId: null,
  turnStartMs: 0,
  step: null,
  running: new Map(),
  finished: [],
  xrays: 0,
  xraysThisTurn: 0,
})

export function newState(raw: RawOptions): State {
  return {
    cwd: '',
    options: optionsOf(raw),
    cache: new Map(),
    snapshot: null,
    readError: null,
    activity: newActivity(),
    touches: new Map(),
    fleet: newFleet(),
    deck: {
      isOpen: false,
      scope: 'flagged',
      filter: '',
      queue: [],
      index: 0,
      ledger: {},
      edits: new Map(),
      source: null,
      isSourceShown: false,
    },
    sign: { isOpen: false, name: '', covers: 'phase-1', error: null },
  }
}

// The history pane: each day's cost and tokens over the history window, as bars, with a total and a
// button that copies the table as text
import type { Kit } from './band'
import { dayLabel, formatClock, formatTokens, formatUsd } from './logic'
import type { FoundTrack } from './logic'
import { COLORS } from './state'
import type { HistoryDay } from '../types'

const HISTORY_BAR = 30

// The same table as plain text, for the clipboard
export const historyText = (days: HistoryDay[], span: number) => {
  const usd = days.reduce((sum, d) => sum + d.usd, 0)
  const tokens = days.reduce((sum, d) => sum + d.tokens, 0)
  return [
    ...days.map(d => `${dayLabel(d.day)}  ${formatUsd(d.usd).padStart(7)}  ${(d.tokens > 0 ? formatTokens(d.tokens) : '-').padStart(6)}`),
    `${span} days  ${formatUsd(usd)} · ${formatTokens(tokens)} tokens`,
  ].join('\n')
}

export function drawHistoryPane(
  { Box, Button, Text }: Kit,
  view: { days: HistoryDay[]; span: number; rows: number; onCopy: () => void },
) {
  const { days, span } = view
  const most = Math.max(0.01, ...days.map(d => d.usd))
  const usd = days.reduce((sum, d) => sum + d.usd, 0)
  const tokens = days.reduce((sum, d) => sum + d.tokens, 0)
  // The newest days when the pane is too short for all of them
  const room = Math.max(1, view.rows - 7)

  return (
    <Box flexDirection="column">
      {days.slice(-room).map(d => {
        const cells = d.usd > 0 ? Math.max(1, Math.round((d.usd / most) * HISTORY_BAR)) : 0
        return (
          <Text key={d.day} wrap="truncate">
            <Text dimColor>{`${dayLabel(d.day)}  `}</Text>
            <Text color={COLORS.ok}>{'█'.repeat(cells)}</Text>
            <Text dimColor>{'·'.repeat(HISTORY_BAR - cells)}</Text>
            <Text color={d.usd > 0 ? COLORS.ok : undefined} dimColor={d.usd === 0}>{`  ${formatUsd(d.usd).padStart(7)}`}</Text>
            <Text color={COLORS.model}>{`  ${(d.tokens > 0 ? formatTokens(d.tokens) : '–').padStart(6)}`}</Text>
          </Text>
        )
      })}
      <Text> </Text>
      <Text wrap="truncate">
        <Text dimColor>{`${span} days  `}</Text>
        <Text color={COLORS.ok} bold>{formatUsd(usd)}</Text>
        <Text dimColor>{' · '}</Text>
        <Text color={COLORS.model}>{formatTokens(tokens)}</Text>
        <Text dimColor>{' tokens, counted from when the mod was installed'}</Text>
      </Text>
      <Text> </Text>
      <Button key="copy-history" plain dimColor label="copy as text" onPress={view.onCopy} />
    </Box>
  )
}

// The Spotify search, a dialog: a box to type in, then up to ten tracks to play. No hotkeys on the tracks,
// so digits typed into the box never play one
export type SearchView = {
  query: string
  status: 'idle' | 'searching' | 'found' | 'failed'
  message: string
  tracks: FoundTrack[]
  rows: number
  onSearch: (query: string) => void
  onPlay: (track: FoundTrack) => void
}

const SPOTIFY_GREEN = '#1db954'

export function drawSearchPane({ Box, Button, Text, Input }: Kit, view: SearchView) {
  const room = Math.max(1, view.rows - 5)
  return (
    <Box flexDirection="column">
      {Input ? (
        <Input
          key="spotify-query"
          label="Search Spotify"
          placeholder="a track, an artist, an album"
          value={view.query}
          submitLabel="search"
          autoFocus
          onSubmit={value => view.onSearch(value)}
        />
      ) : (
        <Text dimColor>{'This surface has no text box.'}</Text>
      )}
      <Text> </Text>
      {view.status === 'searching' ? <Text dimColor>{'Searching…'}</Text> : null}
      {view.status === 'failed' ? <Text color="#f87171">{view.message}</Text> : null}
      {view.status === 'found' && view.tracks.length === 0 ? <Text dimColor>{'Nothing found.'}</Text> : null}
      {view.tracks.slice(0, room).map(track => (
        <Box key={`found-${track.uri}`}>
          <Button
            key={`play-${track.uri}`}
            plain
            label={track.name}
            onPress={() => view.onPlay(track)}
          />
          <Text wrap="truncate">
            <Text>{track.artist ? ` — ${track.artist}` : ''}</Text>
            <Text dimColor>{track.album ? ` · ${track.album}` : ''}</Text>
            <Text dimColor>{track.durationMs ? `  ${formatClock(track.durationMs)}` : ''}</Text>
          </Text>
        </Box>
      ))}
      {view.status === 'found' && view.tracks.length > 0 ? (
        <Box marginTop={1}>
          <Text dimColor>
            <Text color={SPOTIFY_GREEN}>{'▶ '}</Text>
            {'Tab or ↑↓ to a track and Enter, or click it, to play · Esc closes'}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}


// The history pane: each day's cost and tokens over the history window, as bars, with a total and a
// button that copies the table as text
import type { Kit } from './band'
import { dayLabel, fitText, formatClock, formatTokens, formatUsd } from './logic'
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

// The Spotify search, a dialog: a framed box to type in, then up to ten tracks, two lines each: the title
// (a button that plays it) with the time on the right, and the artist and album under it, dim. Widths come
// from the pane itself (truncating Text and flex), never from a column count, so nothing wraps. No hotkeys
// on the tracks, so digits typed into the box never play one
export type SearchView = {
  query: string
  status: 'idle' | 'searching' | 'found' | 'failed'
  message: string
  tracks: FoundTrack[]
  // The track Spotify plays now, marked in the list
  playingUri: string | null
  onSearch: (query: string) => void
  onPlay: (track: FoundTrack) => void
}

const SPOTIFY_GREEN = '#1db954'
// Long enough for any title the pane shows; a truncating Text cuts it at the pane's own edge
const RULE = '─'.repeat(240)
const TITLE_MAX = 48

export function drawSearchPane({ Box, Button, Text, Input }: Kit, view: SearchView) {
  const found = view.status === 'found' && view.tracks.length > 0
  const count = found ? `${view.tracks.length} tracks` : view.status === 'searching' ? 'searching…' : ''
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={SPOTIFY_GREEN} bold>{'● Spotify'}</Text>
        <Text dimColor>{count}</Text>
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor={SPOTIFY_GREEN} paddingX={1}>
        {Input ? (
          <Input
            key="spotify-query"
            placeholder="a track, an artist, an album"
            value={view.query}
            submitLabel="search"
            autoFocus
            onSubmit={value => view.onSearch(value)}
          />
        ) : (
          <Text dimColor>{'This surface has no text box.'}</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {view.status === 'idle' ? <Text dimColor>{'Type and press Enter; pick a track to play it.'}</Text> : null}
        {view.status === 'failed' ? <Text color="#f87171">{view.message}</Text> : null}
        {view.status === 'found' && view.tracks.length === 0 ? <Text dimColor>{`Nothing found for “${view.query}”.`}</Text> : null}
        {view.tracks.map(track => {
          const isPlaying = track.uri === view.playingUri
          const sub = [track.artist, track.album].filter(Boolean).join(' · ')
          return (
            <Box key={`found-${track.uri}`} flexDirection="column" marginBottom={1}>
              <Box justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text color={SPOTIFY_GREEN}>{isPlaying ? '♪ ' : '  '}</Text>
                  <Button
                    key={`play-${track.uri}`}
                    plain
                    label={fitText(track.name, Math.min(TITLE_MAX, [...track.name].length))}
                    onPress={() => view.onPlay(track)}
                  />
                </Box>
                <Text dimColor>{track.durationMs ? ` ${formatClock(track.durationMs)}` : ''}</Text>
              </Box>
              <Text dimColor wrap="truncate">{`  ${sub}`}</Text>
            </Box>
          )
        })}
      </Box>
      {found ? (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate">{RULE}</Text>
          <Text dimColor wrap="truncate">
            <Text color={SPOTIFY_GREEN}>{'▶ '}</Text>
            {'↑↓ or Tab · Enter plays · Esc closes'}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

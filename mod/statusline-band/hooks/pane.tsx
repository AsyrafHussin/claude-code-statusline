// The history pane: each day's cost and tokens over the history window, as bars, with a total and a
// button that copies the table as text
import type { Kit } from './band'
import { dayLabel, fitText, formatClock, formatTokens, formatUsd, searchColumns } from './logic'
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

// The Spotify search, a dialog: a box to type in, then up to ten tracks as a table, each row one button
// to play it. No hotkeys on the tracks, so digits typed into the box never play one
export type SearchView = {
  query: string
  status: 'idle' | 'searching' | 'found' | 'failed'
  message: string
  tracks: FoundTrack[]
  rows: number
  columns: number
  // The track Spotify plays now, marked in the table
  playingUri: string | null
  onSearch: (query: string) => void
  onPlay: (track: FoundTrack) => void
}

const SPOTIFY_GREEN = '#1db954'

export function drawSearchPane({ Box, Button, Text, Input }: Kit, view: SearchView) {
  const { title, artist, album } = searchColumns(view.columns)
  const rule = '─'.repeat(Math.max(10, view.columns - 4))
  const row = (n: string, t: string, a: string, al: string, time: string) =>
    [n.padStart(2), fitText(t, title), fitText(a, artist), album > 0 ? fitText(al, album) : null, time.padStart(5)]
      .filter(part => part !== null)
      .join('  ')
  const found = view.status === 'found' && view.tracks.length > 0
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text color={SPOTIFY_GREEN} bold>{'● Spotify'}</Text>
          <Text dimColor>{'  search'}</Text>
        </Text>
        <Text dimColor>
          {found ? `${view.tracks.length} tracks for “${view.query}”` : view.status === 'searching' ? 'searching…' : ''}
        </Text>
      </Box>
      <Text> </Text>
      {Input ? (
        <Input
          key="spotify-query"
          label="Find"
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
      {view.status === 'failed' ? <Text color="#f87171">{view.message}</Text> : null}
      {view.status === 'found' && view.tracks.length === 0 ? <Text dimColor>{`Nothing found for “${view.query}”.`}</Text> : null}
      {view.status === 'idle' ? <Text dimColor>{'Type and press Enter. Up to 10 tracks come back; pick one to play it.'}</Text> : null}
      {found ? (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate">{`  ${row('#', 'TITLE', 'ARTIST', 'ALBUM', 'TIME')}`}</Text>
          <Text dimColor wrap="truncate">{rule}</Text>
          {view.tracks.map((track, i) => {
            const isPlaying = track.uri === view.playingUri
            return (
              <Box key={`found-${track.uri}`}>
                <Text color={SPOTIFY_GREEN}>{isPlaying ? '♪ ' : '  '}</Text>
                <Button
                  key={`play-${track.uri}`}
                  plain
                  label={row(String(i + 1), track.name, track.artist, track.album, track.durationMs ? formatClock(track.durationMs) : '')}
                  onPress={() => view.onPlay(track)}
                />
              </Box>
            )
          })}
          <Text dimColor wrap="truncate">{rule}</Text>
          <Text dimColor>
            <Text color={SPOTIFY_GREEN}>{'▶ '}</Text>
            {'↑↓ or Tab to a track · Enter or click plays it · Esc closes'}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

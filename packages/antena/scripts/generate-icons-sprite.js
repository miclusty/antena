#!/usr/bin/env node
// Genera public/icons.svg con todos los Material Symbols usados
// Lee los SVGs de node_modules/@material-design-icons/svg/round/

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = resolve(__dirname, '../node_modules/@material-design-icons/svg/round')
const OUT_FILE = resolve(__dirname, '../public/icons.svg')

// Icon name → SVG filename mapping.
// Most icons use their ligature name as filename, but some differ.
const ICON_MAP = {
  'progress_activity': 'sync',  // replaced with sync (loading spinner)
  'signal_3_bar': 'signal_cellular_alt_1_bar',
  'signal_4_bar': 'signal_cellular_alt_2_bar',
}
const ICON_NAMES = [
  'add', 'add_circle', 'all_inclusive', 'arrow_back', 'arrow_downward',
  'arrow_forward', 'article', 'auto_awesome', 'auto_stories',
  'account_balance', 'balance', 'block', 'bookmark', 'bookmark_border',
  'brightness_auto', 'campaign', 'cancel', 'category', 'check',
  'check_circle', 'chevron_left', 'chevron_right', 'close', 'cloud',
  'content_copy', 'dark_mode', 'density_medium', 'density_small',
  'devices', 'download', 'error', 'expand_more', 'favorite',
  'favorite_border', 'flag', 'flash_on', 'gavel', 'group', 'groups',
  'history', 'home', 'hub', 'image', 'info', 'install_mobile',
  'ios_share', 'language', 'light_mode', 'link', 'local_police',
  'location_city', 'location_on', 'mail', 'map', 'menu', 'menu_book',
  'more_horiz', 'newspaper', 'open_in_new', 'palette', 'pause',
  'person', 'play_arrow', 'play_circle', 'progress_activity', 'public',
  'radio', 'recommend', 'record_voice_over', 'rss_feed', 'schedule',
  'search', 'search_off', 'settings', 'share', 'shield', 'signal_3_bar',
  'signal_4_bar', 'sports_soccer', 'stop', 'swipe', 'sync',
  'theater_comedy', 'theaters', 'thumb_down', 'thumb_up', 'today',
  'trending_up', 'tune', 'visibility_off', 'volume_off', 'volume_up',
  'warning', 'wifi_off',
]

const symbols = []

for (const name of ICON_NAMES) {
  const filename = ICON_MAP[name] || name
  const svgPath = resolve(ICONS_DIR, `${filename}.svg`)
  if (!existsSync(svgPath)) {
    console.warn(`  MISSING: ${name} (${filename})`)
    continue
  }
  const svg = readFileSync(svgPath, 'utf-8')
  // Extract all <path> (and other children) from the SVG
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').trim()
  symbols.push(`  <symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`)
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
${symbols.join('\n')}
</svg>
`

writeFileSync(OUT_FILE, sprite, 'utf-8')
console.log(`✓ Generated icons sprite: ${OUT_FILE}`)
console.log(`  ${symbols.length}/${ICON_NAMES.length} icons found`)

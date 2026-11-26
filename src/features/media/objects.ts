/**
 * Fixed object colours of the input materials (DIRECTION §2.3): a note slip, a photo print, the marigold voice
 * strip, film stock. These are things, not interface, so they look the same in Paper and Ink night. One place,
 * so the tray, the photo panel, the drawing panel and the video panel never drift apart.
 */
export const OBJECT_COLORS = {
  paper: '#FFFDF8',
  ruling: '#D8D1C4',
  ballpoint: '#2A2622',
  print: '#F5F2EA',
  haldi: '#F2A541',
  bars: '#1C1917',
  film: '#1F1C19',
  sprocket: '#E9E7DE',
  markBg: '#FFFFFF',
  cloudInk: '#0A6E87',
  deviceInk: '#1C6E43',
} as const;

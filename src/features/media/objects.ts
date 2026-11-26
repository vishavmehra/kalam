/**
 * Fixed object colours of the input materials (DIRECTION §2.3): a note slip, a photo print, the haldi voice
 * strip, film stock. These are things, not interface, so they look the same in Paper and Ink night. One place,
 * so the tray, the photo panel, the drawing panel and the video panel never drift apart.
 */
export const OBJECT_COLORS = {
  paper: '#FDFDF9',
  ruling: '#CBD5EE',
  ballpoint: '#1D2340',
  print: '#F5F2EA',
  haldi: '#F5B323',
  bars: '#12172E',
  film: '#1B1D29',
  sprocket: '#E9E7DE',
  markBg: '#FFFFFF',
  cloudInk: '#0A6E87',
  deviceInk: '#1C6E43',
} as const;

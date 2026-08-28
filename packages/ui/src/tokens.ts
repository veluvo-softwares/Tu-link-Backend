const brandColors = {
  deepTeal: '#075261',
  routeTeal: '#12848d',
  sunsetOrange: '#f35d32',
  warmSand: '#f9f4f0',
  journeyInk: '#1a1a19',
  white: '#ffffff',
  borderSoft: '#ded8d1',
  success: '#1e8e63',
} as const;

export const tulinkTokens = {
  colors: {
    ...brandColors,
    /** @deprecated Use deepTeal. */
    carbonBlack: brandColors.deepTeal,
    /** @deprecated Use deepTeal. */
    graphite: brandColors.deepTeal,
    /** @deprecated Use deepTeal. */
    brushedSteel: brandColors.deepTeal,
    /** @deprecated Use sunsetOrange. */
    electricRed: brandColors.sunsetOrange,
    /** @deprecated Use borderSoft. */
    silver: brandColors.borderSoft,
    /** @deprecated Use sunsetOrange. */
    emberRed: brandColors.sunsetOrange,
    ivory: brandColors.white,
  },
  fonts: {
    display: '"Manrope", "Helvetica Neue", sans-serif',
    badge: '"Manrope", "Helvetica Neue", sans-serif',
    body: '"Manrope", "Helvetica Neue", sans-serif',
  },
} as const;

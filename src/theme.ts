// Slo N Ready design system v1.4
// Jungle watercolor palette — slightly brighter than the backdrop illustration.
// Warm cream base, sage greens, peach accents. Fresh but never harsh.

export const colors = {
  // Backgrounds
  background:    '#FAF7F2', // bright warm cream — main screen bg
  surface:       '#FFFFFF', // clean white — cards and rows
  surfaceAlt:    '#F0EDE7', // light stone — grouped section bg

  // Brand
  primary:       '#6FA882', // brighter sage green — buttons, income, checking accent
  primaryLight:  '#E8F3EC', // very light moss — selected states
  accent:        '#D4956A', // peach/apricot — credit card accent
  accentLight:   '#FAF0E8', // very light peach

  // Financial meaning
  income:        '#6FA882', // sage green
  expense:       '#C4785A', // terracotta — warm, not harsh red
  netPositive:   '#6FA882',
  netNegative:   '#C4785A',

  // Transaction states
  pending:       '#A89878', // warm khaki/tan
  dropped:       '#C0BDB7', // neutral warm gray

  // Text
  text:          '#28261E', // deep warm near-black
  textSecondary: '#6A6760', // warm stone gray
  textTertiary:  '#A09D97', // light warm gray
  textOnColor:   '#FFFFFF', // text on colored backgrounds

  // Chrome
  border:        '#E0DDD6', // warm light border
  separator:     '#ECEAE4', // slightly lighter
  destructive:   '#C4785A', // terracotta
};

export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

export const radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  full: 999,
};

export const font = {
  regular:   'Nunito_400Regular',
  semiBold:  'Nunito_600SemiBold',
  bold:      'Nunito_700Bold',
  extraBold: 'Nunito_800ExtraBold',
};

// Account type → brand color mapping
export const accountColor = {
  checking:    colors.primary, // sage green
  credit_card: colors.accent,  // peach
} as const;

/**
 * TrendCategoryRow — a single category comparison row on the Trends screen.
 *
 * Shows: emoji + name + Rachey micro-comment on the left;
 *        current $ + previous $ + Δ% badge on the right.
 *
 * Color convention (inverted from expense color, because down is good):
 *   spending went DOWN → green (good news)
 *   spending went UP   → terracotta (heads up)
 *   same               → neutral gray
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendRow } from '../domain/trends';
import { centsToDollars } from '../domain/money';
import { colors, font, spacing, radius } from '../theme';

interface Props {
  row:          TrendRow;
  categoryEmoji: string | null;
}

export function TrendCategoryRow({ row, categoryEmoji }: Props) {
  const { delta_pct, current_cents, previous_cents, category_name, rachey_message } = row;

  // Determine direction color — for spending rows (negative), down is good.
  // For income rows (positive), up is good.
  const isSame    = Math.abs(delta_pct) < 0.05;
  const isExpense = current_cents <= 0 && previous_cents <= 0;

  let deltaColor: string;
  if (isSame) {
    deltaColor = colors.textTertiary;
  } else if (isExpense) {
    // Expense: down = green, up = terracotta
    deltaColor = delta_pct < 0 ? colors.income : colors.expense;
  } else {
    // Income: up = green, down = terracotta
    deltaColor = delta_pct > 0 ? colors.income : colors.expense;
  }

  const pctAbs = Math.abs(delta_pct * 100);
  const arrow  = isSame ? '→' : delta_pct > 0 ? '↑' : '↓';
  const pctStr = isSame ? '~0%' : `${arrow} ${pctAbs < 10 ? pctAbs.toFixed(1) : Math.round(pctAbs)}%`;

  return (
    <View style={styles.row}>
      {/* Left: emoji + name + Rachey comment */}
      <View style={styles.left}>
        {categoryEmoji ? (
          <Text style={styles.emoji}>{categoryEmoji}</Text>
        ) : (
          <View style={styles.emojiPlaceholder} />
        )}
        <View style={styles.textBlock}>
          <Text style={styles.name} numberOfLines={1}>{category_name}</Text>
          <Text style={styles.comment} numberOfLines={1}>{rachey_message}</Text>
        </View>
      </View>

      {/* Right: current $ + previous $ + Δ% badge */}
      <View style={styles.right}>
        <Text style={styles.currentAmt}>
          {centsToDollars(current_cents)}
        </Text>
        <Text style={styles.prevAmt}>
          vs {centsToDollars(previous_cents)}
        </Text>
        <View style={[styles.badge, { backgroundColor: isSame ? colors.surfaceAlt : deltaColor + '22' }]}>
          <Text style={[styles.badgeText, { color: deltaColor }]}>{pctStr}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   12,
    gap: spacing.sm,
  },

  left: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing.sm,
    minWidth:      0,
  },
  emoji: {
    fontSize: 22,
    width:    28,
    textAlign: 'center',
  },
  emojiPlaceholder: {
    width: 28,
  },
  textBlock: {
    flex:    1,
    minWidth: 0,
  },
  name: {
    fontFamily: font.semiBold,
    fontSize:   14,
    color:      colors.text,
  },
  comment: {
    fontFamily: font.regular,
    fontSize:   12,
    color:      colors.textTertiary,
    marginTop:  1,
  },

  right: {
    alignItems: 'flex-end',
    gap:        2,
  },
  currentAmt: {
    fontFamily: font.bold,
    fontSize:   14,
    color:      colors.text,
  },
  prevAmt: {
    fontFamily: font.regular,
    fontSize:   11,
    color:      colors.textTertiary,
  },
  badge: {
    borderRadius:    radius.full,
    paddingVertical: 2,
    paddingHorizontal: 7,
    marginTop: 2,
  },
  badgeText: {
    fontFamily:  font.semiBold,
    fontSize:    12,
  },
});

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Transaction, Category } from '../db/queries';
import { centsToDollars } from '../domain/money';
import { colors, font, spacing, radius } from '../theme';
import { CategoryBadge } from './CategoryBadge';

interface Props {
  transaction:  Transaction;
  accountBadge?: string;
  category?:    Category | null;
  onPress?:     () => void;
  bulkMode?:    boolean;
  selected?:    boolean;
}

export function TransactionRow({ transaction, accountBadge, category, onPress, bulkMode = false, selected = false }: Props) {
  const isDropped  = transaction.dropped_at != null;
  const isPending  = !!transaction.is_pending && !isDropped;
  const isPositive = transaction.amount_cents >= 0;

  const amountColor = isDropped
    ? colors.dropped
    : isPositive
    ? colors.income
    : colors.text;

  const content = (
    <View style={[styles.row, isDropped && styles.rowDropped, bulkMode && selected && styles.rowSelected]}>
      {bulkMode && (
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Text style={styles.checkboxMark}>✓</Text>}
        </View>
      )}
      <View style={styles.left}>
        <Text
          style={[styles.description, isDropped && styles.textDropped]}
          numberOfLines={1}
        >
          {transaction.description}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.date}>{transaction.date}</Text>
          {accountBadge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{accountBadge}</Text>
            </View>
          )}
          {category && <CategoryBadge name={category.name} color={category.color} emoji={category.emoji} />}
          {category && transaction.category_set_manually === 1 && (
            <Text style={styles.sourceIcon}>✎</Text>
          )}
          {category && !transaction.category_set_manually && transaction.applied_rule_id && (
            <Text style={styles.sourceIcon}>⚙</Text>
          )}
          {category?.exclude_from_totals ? (
            <View style={[styles.pill, styles.pillExcluded]}>
              <Text style={[styles.pillText, styles.pillExcludedText]}>↔</Text>
            </View>
          ) : null}
          {isDropped && (
            <View style={[styles.pill, styles.pillDropped]}>
              <Text style={[styles.pillText, { color: colors.dropped }]}>Dropped</Text>
            </View>
          )}
          {isPending && (
            <View style={[styles.pill, styles.pillPending]}>
              <Text style={[styles.pillText, { color: colors.pending }]}>Pending</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={[styles.amount, { color: amountColor }, isDropped && styles.textDropped]}>
        {centsToDollars(transaction.amount_cents)}
      </Text>
    </View>
  );

  if (onPress || bulkMode) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   13,
    paddingHorizontal: spacing.md,
    backgroundColor:   colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  rowDropped: {
    backgroundColor: colors.background,
  },
  rowSelected: {
    backgroundColor: colors.primaryLight,
  },
  checkbox: {
    width:           22,
    height:          22,
    borderRadius:    11,
    borderWidth:     1.5,
    borderColor:     colors.border,
    marginRight:     spacing.sm,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor:     colors.primary,
  },
  checkboxMark: {
    fontFamily: font.bold,
    fontSize:   12,
    color:      '#fff',
    lineHeight: 14,
  },
  left: {
    flex:        1,
    marginRight: spacing.sm,
    gap:         4,
  },
  description: {
    fontFamily: font.semiBold,
    fontSize:   15,
    color:      colors.text,
  },
  textDropped: {
    color:               colors.dropped,
    textDecorationLine:  'line-through',
  },
  meta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  date: {
    fontFamily: font.regular,
    fontSize:   12,
    color:      colors.textTertiary,
  },
  badge: {
    backgroundColor:  colors.surfaceAlt,
    borderRadius:     radius.sm,
    paddingHorizontal: 6,
    paddingVertical:   1,
  },
  badgeText: {
    fontFamily: font.semiBold,
    fontSize:   11,
    color:      colors.textSecondary,
  },
  pill: {
    borderRadius:     radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
  },
  pillPending: {
    backgroundColor: colors.accentLight,
  },
  pillDropped: {
    backgroundColor: colors.surfaceAlt,
  },
  pillExcluded: {
    backgroundColor: colors.surfaceAlt,
  },
  pillExcludedText: {
    color: colors.textTertiary,
  },
  pillText: {
    fontFamily: font.semiBold,
    fontSize:   11,
  },
  amount: {
    fontFamily: font.bold,
    fontSize:   15,
  },
  sourceIcon: {
    fontSize:   11,
    color:      colors.textTertiary,
    lineHeight: 14,
  },
});

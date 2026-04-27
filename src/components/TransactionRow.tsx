import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Transaction } from '../db/queries';
import { centsToDollars } from '../domain/money';

interface Props {
  transaction: Transaction;
  accountBadge?: string;
}

export function TransactionRow({ transaction, accountBadge }: Props) {
  const isDropped = transaction.dropped_at != null;
  const isPositive = transaction.amount_cents >= 0;
  return (
    <View style={[styles.row, isDropped && styles.rowDropped]}>
      <View style={styles.left}>
        <Text style={[styles.description, isDropped && styles.descriptionDropped]} numberOfLines={1}>
          {transaction.description}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.date}>{transaction.date}</Text>
          {accountBadge && <Text style={styles.badge}>{accountBadge}</Text>}
          {isDropped
            ? <Text style={styles.dropped}>Dropped</Text>
            : !!transaction.is_pending && <Text style={styles.pending}>Pending</Text>
          }
        </View>
      </View>
      <Text style={[styles.amount, isDropped ? styles.amountDropped : isPositive ? styles.positive : styles.negative]}>
        {centsToDollars(transaction.amount_cents)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  left: {
    flex: 1,
    marginRight: 8,
  },
  description: {
    fontSize: 15,
    color: '#1c1c1e',
    marginBottom: 3,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  date: {
    fontSize: 12,
    color: '#8e8e93',
  },
  badge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: '#636366',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  pending: {
    fontSize: 11,
    color: '#ff9f0a',
    fontStyle: 'italic',
  },
  dropped: {
    fontSize: 11,
    color: '#aeaeb2',
    fontStyle: 'italic',
  },
  rowDropped: {
    backgroundColor: '#f9f9f9',
  },
  descriptionDropped: {
    color: '#aeaeb2',
    textDecorationLine: 'line-through',
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
  },
  amountDropped: {
    color: '#aeaeb2',
    textDecorationLine: 'line-through',
  },
  positive: { color: '#2a9d5c' },
  negative: { color: '#1c1c1e' },
});

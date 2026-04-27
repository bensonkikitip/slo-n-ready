import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Transaction,
  getAllAccounts, getDistinctMonths, getAllTransactionsForMonth,
} from '../src/db/queries';
import { buildMonthList, MonthEntry } from '../src/domain/month';
import { SummaryBar } from '../src/components/SummaryBar';
import { MonthPicker } from '../src/components/MonthPicker';
import { TransactionRow } from '../src/components/TransactionRow';
import { Sloth } from '../src/components/Sloth';
import { colors, font, spacing } from '../src/theme';

export default function AllAccountsScreen() {
  const insets = useSafeAreaInsets();
  const [accounts,     setAccounts]     = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [months,       setMonths]       = useState<MonthEntry[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasAnyData, setHasAnyData] = useState(false);

  const selectedMonthRef = useRef('');

  function updateMonth(m: string) {
    selectedMonthRef.current = m;
    setSelectedMonth(m);
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths] = await Promise.all([
        getAllAccounts(), getDistinctMonths(),
      ]);
      if (!active) return;

      const monthList = buildMonthList(dbMonths);
      const cur       = selectedMonthRef.current;
      const month     = (cur && monthList.some(m => m.key === cur))
        ? cur
        : monthList.find(m => m.count > 0)?.key ?? '';

      setAccounts(accts);
      setMonths(monthList);
      setHasAnyData(dbMonths.length > 0);
      updateMonth(month);

      const txns = month ? await getAllTransactionsForMonth(month) : [];
      if (!active) return;
      setTransactions(txns);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []));

  async function handleMonthChange(month: string) {
    updateMonth(month);
    const txns = await getAllTransactionsForMonth(month);
    setTransactions(txns);
  }

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts],
  );

  const monthSummary = useMemo(() => {
    const active = transactions.filter(t => t.dropped_at === null);
    return {
      income_cents:  active.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0),
      expense_cents: active.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0),
      net_cents:     active.reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [transactions]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Sloth sloth="sleeping" size={80} />
        <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'All Accounts' }} />
      <View style={styles.container}>
        {months.length > 0 && selectedMonth && (
          <MonthPicker
            months={months}
            selected={selectedMonth}
            onChange={handleMonthChange}
          />
        )}

        <SummaryBar
          incomeCents={monthSummary.income_cents}
          expenseCents={monthSummary.expense_cents}
          netCents={monthSummary.net_cents}
        />

        <FlatList
          data={transactions}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              accountBadge={accountMap[item.account_id]?.name}
            />
          )}
          contentContainerStyle={[
            transactions.length === 0 && styles.emptyContainer,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="meditating" size={130} />
              <Text style={styles.emptyTitle}>
                {!hasAnyData ? "I'm ready when you are!" : 'Nothing here this month'}
              </Text>
              <Text style={styles.emptyBody}>
                {!hasAnyData
                  ? "Import a CSV from one of your accounts and I'll show everything together here."
                  : "I don't see any transactions for this month — try a different one."}
              </Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.background },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, backgroundColor: colors.background },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text },
  emptyBody: {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
});

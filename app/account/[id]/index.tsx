import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Transaction,
  getAllAccounts, deleteAccount,
  getDistinctMonths, getTransactionsForMonth,
} from '../../../src/db/queries';
import { writeBackup } from '../../../src/db/backup';
import { buildMonthList, MonthEntry } from '../../../src/domain/month';
import { SummaryBar } from '../../../src/components/SummaryBar';
import { MonthPicker } from '../../../src/components/MonthPicker';
import { TransactionRow } from '../../../src/components/TransactionRow';
import { Sloth } from '../../../src/components/Sloth';
import { colors, font, spacing, radius, accountColor } from '../../../src/theme';

export default function AccountDetailScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const [account,      setAccount]      = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [months,       setMonths]       = useState<MonthEntry[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(true);

  const selectedMonthRef = useRef('');

  function updateMonth(m: string) {
    selectedMonthRef.current = m;
    setSelectedMonth(m);
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths] = await Promise.all([
        getAllAccounts(), getDistinctMonths(id),
      ]);
      if (!active) return;

      const acct      = accts.find(a => a.id === id) ?? null;
      const monthList = buildMonthList(dbMonths);
      const cur       = selectedMonthRef.current;
      const month     = (cur && monthList.some(m => m.key === cur))
        ? cur
        : monthList.find(m => m.count > 0)?.key ?? '';

      setAccount(acct);
      setMonths(monthList);
      updateMonth(month);

      const txns = month ? await getTransactionsForMonth(id, month) : [];
      if (!active) return;
      setTransactions(txns);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]));

  async function handleMonthChange(month: string) {
    updateMonth(month);
    const txns = await getTransactionsForMonth(id, month);
    setTransactions(txns);
  }

  // Compute summary from the already-loaded (month-filtered) transactions
  const monthSummary = useMemo(() => {
    const active = transactions.filter(t => t.dropped_at === null);
    return {
      income_cents:  active.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0),
      expense_cents: active.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0),
      net_cents:     active.reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [transactions]);

  function handleDelete() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete this account and all its transactions. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => { await deleteAccount(id); void writeBackup(); router.back(); },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Sloth sloth="sleeping" size={80} />
        <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />
      </View>
    );
  }

  if (!account) {
    return (
      <View style={styles.center}>
        <Sloth sloth="box" size={80} />
        <Text style={styles.notFound}>Account not found.</Text>
      </View>
    );
  }

  const accent = accountColor[account.type];

  return (
    <>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => (
            <View style={styles.headerBtns}>
              <TouchableOpacity onPress={() => router.push(`/account/${id}/edit`)} hitSlop={12}>
                <Text style={styles.editBtn}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} hitSlop={12}>
                <Text style={styles.deleteBtn}>Delete</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        <View style={[styles.typeStrip, { backgroundColor: accent }]}>
          <Text style={styles.typeStripText}>
            {account.type === 'checking' ? 'Checking Account' : 'Credit Card'}
          </Text>
        </View>

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
          renderItem={({ item }) => <TransactionRow transaction={item} />}
          contentContainerStyle={[
            transactions.length === 0 && styles.emptyContainer,
            { paddingBottom: insets.bottom + 88 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="receipt" size={120} />
              <Text style={styles.emptyTitle}>Nothing here yet!</Text>
              <Text style={styles.emptyBody}>
                {months.length === 0
                  ? "Hand me a CSV and I'll get to work sorting your transactions."
                  : "I don't see any transactions for this month — try another one or import more."}
              </Text>
            </View>
          }
        />

        <TouchableOpacity
          style={[styles.importFab, { bottom: insets.bottom + spacing.lg, backgroundColor: accent }]}
          onPress={() => router.push(`/account/${id}/import`)}
          activeOpacity={0.85}
        >
          <Text style={styles.importFabText}>Import CSV</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, backgroundColor: colors.background },
  notFound:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary },

  typeStrip: { paddingVertical: 6, paddingHorizontal: spacing.md },
  typeStripText: {
    fontFamily: font.semiBold, fontSize: 12,
    color: colors.textOnColor, letterSpacing: 0.4,
  },

  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  editBtn:    { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  deleteBtn:  { fontFamily: font.semiBold, fontSize: 15, color: colors.destructive, marginRight: 4 },

  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text, marginTop: spacing.sm },
  emptyBody:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  importFab: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    borderRadius: radius.full, paddingVertical: 16, alignItems: 'center',
    shadowColor: '#2C2416', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  importFabText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },
});

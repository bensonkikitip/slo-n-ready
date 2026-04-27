import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, ImageBackground,
} from 'react-native';
import { useRouter, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, AccountSummary, getAllAccounts,
  getDistinctMonths, getAccountSummaryForMonth, getAllAccountsSummaryForMonth,
} from '../src/db/queries';
import { buildMonthList, MonthEntry } from '../src/domain/month';
import { SummaryBar } from '../src/components/SummaryBar';
import { MonthPicker } from '../src/components/MonthPicker';
import { Sloth } from '../src/components/Sloth';
import { colors, font, spacing, radius, accountColor } from '../src/theme';
import { centsToDollars } from '../src/domain/money';

interface AccountWithSummary extends Account { summary: AccountSummary }

const EMPTY_SUMMARY: AccountSummary = {
  income_cents: 0, expense_cents: 0, net_cents: 0,
  transaction_count: 0, last_imported_at: null,
};

export default function AccountsListScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const [accounts,   setAccounts]   = useState<AccountWithSummary[]>([]);
  const [allSummary, setAllSummary] = useState<AccountSummary | null>(null);
  const [months,     setMonths]     = useState<MonthEntry[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(true);

  // Ref so the useFocusEffect (empty deps) can read the latest selected month
  const selectedMonthRef = useRef('');

  function updateMonth(m: string) {
    selectedMonthRef.current = m;
    setSelectedMonth(m);
  }

  async function loadSummaries(accts: Account[], month: string) {
    if (!month || accts.length === 0) return;
    const [allSum, ...acctSums] = await Promise.all([
      getAllAccountsSummaryForMonth(month),
      ...accts.map(a => getAccountSummaryForMonth(a.id, month)),
    ]);
    setAllSummary(allSum);
    setAccounts(accts.map((a, i) => ({ ...a, summary: acctSums[i] })));
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths] = await Promise.all([
        getAllAccounts(), getDistinctMonths(),
      ]);
      if (!active) return;

      const monthList = buildMonthList(dbMonths);
      const cur = selectedMonthRef.current;
      const month = (cur && monthList.some(m => m.key === cur))
        ? cur
        : monthList.find(m => m.count > 0)?.key ?? '';

      setMonths(monthList);
      updateMonth(month);

      if (month && accts.length > 0) {
        const [allSum, ...acctSums] = await Promise.all([
          getAllAccountsSummaryForMonth(month),
          ...accts.map(a => getAccountSummaryForMonth(a.id, month)),
        ]);
        if (!active) return;
        setAllSummary(allSum);
        setAccounts(accts.map((a, i) => ({ ...a, summary: acctSums[i] })));
      } else {
        setAccounts(accts.map(a => ({ ...a, summary: EMPTY_SUMMARY })));
        setAllSummary(null);
      }

      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []));

  async function handleMonthChange(month: string) {
    updateMonth(month);
    await loadSummaries(accounts.map(a => a), month);
  }

  if (loading) {
    return (
      <ImageBackground
        source={require('../assets/backdrop.png')}
        style={styles.center}
        resizeMode="cover"
      >
        <Sloth sloth="sleeping" size={80} />
        <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />
      </ImageBackground>
    );
  }

  const hasAccounts = accounts.length > 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Slo N Ready' }} />
      <ImageBackground
        source={require('../assets/backdrop.png')}
        style={styles.container}
        resizeMode="cover"
      >
        <FlatList
          data={accounts}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.list,
            !hasAccounts && styles.listEmpty,
            { paddingBottom: insets.bottom + 80 },
          ]}
          ListHeaderComponent={hasAccounts ? (
            <>
              {/* Month picker */}
              {months.length > 0 && selectedMonth && (
                <MonthPicker
                  months={months}
                  selected={selectedMonth}
                  onChange={handleMonthChange}
                />
              )}

              {/* All Accounts card */}
              <TouchableOpacity onPress={() => router.push('/all')} activeOpacity={0.7}>
                <View style={styles.allCard}>
                  <View style={styles.allCardTop}>
                    <Sloth sloth="piggyBank" size={56} />
                    <View style={styles.allCardText}>
                      <Text style={styles.allCardTitle}>All Accounts</Text>
                      <Text style={styles.allCardSub}>Combined view</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                  {allSummary && (
                    <SummaryBar
                      incomeCents={allSummary.income_cents}
                      expenseCents={allSummary.expense_cents}
                      netCents={allSummary.net_cents}
                    />
                  )}
                </View>
              </TouchableOpacity>
            </>
          ) : null}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/account/${item.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.accountCard}>
                <View style={[
                  styles.accountAccent,
                  { backgroundColor: accountColor[item.type] },
                ]} />
                <View style={styles.accountCardInner}>
                  <View style={styles.accountCardTop}>
                    <View style={styles.accountInfo}>
                      <Text style={styles.accountName}>{item.name}</Text>
                      <Text style={styles.accountType}>
                        {item.type === 'checking' ? 'Checking' : 'Credit Card'}
                      </Text>
                      {item.summary.last_imported_at && (
                        <Text style={styles.lastImport}>
                          Last import: {new Date(item.summary.last_imported_at).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                  <SummaryBar
                    incomeCents={item.summary.income_cents}
                    expenseCents={item.summary.expense_cents}
                    netCents={item.summary.net_cents}
                  />
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="laptop" size={140} />
              <Text style={styles.emptyTitle}>Welcome to Slo N Ready</Text>
              <Text style={styles.emptyBody}>
                No rush — add your first account and{'\n'}we'll start tracking at our own pace.
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => router.push('/account/new')}
              >
                <Text style={styles.emptyButtonText}>Add First Account</Text>
              </TouchableOpacity>
            </View>
          }
        />

        {hasAccounts && (
          <TouchableOpacity
            style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
            onPress={() => router.push('/account/new')}
            activeOpacity={0.85}
          >
            <Text style={styles.fabText}>+</Text>
          </TouchableOpacity>
        )}
      </ImageBackground>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:      { padding: spacing.md, gap: spacing.md },
  listEmpty: { flex: 1 },

  allCard: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius:    radius.lg,
    overflow:        'hidden',
    shadowColor:     '#2C2416',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.1,
    shadowRadius:    10,
    elevation:       3,
  },
  allCardTop: {
    flexDirection: 'row',
    alignItems:    'center',
    padding:       spacing.md,
    gap:           spacing.md,
  },
  allCardText:  { flex: 1 },
  allCardTitle: { fontFamily: font.bold, fontSize: 18, color: colors.text },
  allCardSub:   { fontFamily: font.regular, fontSize: 13, color: colors.textTertiary, marginTop: 2 },

  accountCard: {
    flexDirection:   'row',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius:    radius.lg,
    overflow:        'hidden',
    shadowColor:     '#2C2416',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.1,
    shadowRadius:    10,
    elevation:       3,
  },
  accountAccent:    { width: 5 },
  accountCardInner: { flex: 1 },
  accountCardTop: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingTop:        spacing.md,
    paddingBottom:     spacing.sm,
    paddingHorizontal: spacing.md,
  },
  accountInfo: { flex: 1 },
  accountName: { fontFamily: font.bold, fontSize: 17, color: colors.text },
  accountType: { fontFamily: font.regular, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  lastImport:  { fontFamily: font.regular, fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  chevron:     { fontSize: 22, color: colors.textTertiary, marginLeft: spacing.sm },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: {
    fontFamily: font.extraBold, fontSize: 24, color: colors.text,
    textAlign: 'center', marginTop: spacing.md,
  },
  emptyBody: {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
  emptyButton: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 14, paddingHorizontal: spacing.xl, marginTop: spacing.sm,
  },
  emptyButtonText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },

  fab: {
    position: 'absolute', right: spacing.lg,
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1A4030', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabText: { fontSize: 30, color: colors.textOnColor, lineHeight: 34, fontFamily: font.regular },
});

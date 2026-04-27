import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, ImageBackground, Alert,
} from 'react-native';
import { useRouter, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, AccountSummary, Category, getAllAccounts, getAllCategories,
  getDistinctMonths, getAccountSummaryForMonth, getAllAccountsSummaryForMonth,
  getDistinctYears, getAccountSummaryForYear, getAllAccountsSummaryForYear,
  getDistinctCategoryIdsForMonth, getDistinctCategoryIdsForYear,
} from '../src/db/queries';
import { buildMonthList, buildYearList, MonthEntry, YearEntry } from '../src/domain/month';
import { FilterMode } from '../src/components/MonthPicker';
import { SummaryBar } from '../src/components/SummaryBar';
import { MonthPicker } from '../src/components/MonthPicker';
import { CategoryPicker } from '../src/components/CategoryPicker';
import { Sloth } from '../src/components/Sloth';
import { colors, font, spacing, radius, accountColor } from '../src/theme';
import { centsToDollars } from '../src/domain/money';
import { getBackupInfo, restoreFromData, readBackupFromPath, BACKUP_PATH } from '../src/db/backup';


interface AccountWithSummary extends Account { summary: AccountSummary }

const EMPTY_SUMMARY: AccountSummary = {
  income_cents: 0, expense_cents: 0, net_cents: 0,
  transaction_count: 0, last_imported_at: null,
};

export default function AccountsListScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const [accounts,         setAccounts]         = useState<AccountWithSummary[]>([]);
  const [allSummary,       setAllSummary]       = useState<AccountSummary | null>(null);
  const [months,           setMonths]           = useState<MonthEntry[]>([]);
  const [years,            setYears]            = useState<YearEntry[]>([]);
  const [selectedMonth,    setSelectedMonth]    = useState('');
  const [selectedYear,     setSelectedYear]     = useState('');
  const [filterMode,       setFilterMode]       = useState<FilterMode>('month');
  const [loading,          setLoading]          = useState(true);
  const [hasBackup,        setHasBackup]        = useState(false);
  const [categories,       setCategories]       = useState<Category[]>([]);
  const [categoryFilters,  setCategoryFilters]  = useState<string[]>([]);
  const [categoriesInPeriod, setCategoriesInPeriod] = useState<Category[]>([]);

  // Refs so useFocusEffect (empty deps) can always read latest values
  const selectedMonthRef   = useRef('');
  const selectedYearRef    = useRef('');
  const filterModeRef      = useRef<FilterMode>('month');
  const categoryFiltersRef = useRef<string[]>([]);

  function updateMonth(m: string) { selectedMonthRef.current = m; setSelectedMonth(m); }
  function updateYear(y: string)  { selectedYearRef.current  = y; setSelectedYear(y);  }
  function updateMode(m: FilterMode) { filterModeRef.current = m; setFilterMode(m);    }
  function updateCategoryFilters(ids: string[]) {
    categoryFiltersRef.current = ids;
    setCategoryFilters(ids);
  }

  async function loadSummaries(accts: Account[], mode: FilterMode, period: string, catIds: string[] = []) {
    if (!period || accts.length === 0) return;
    const [allSum, ...acctSums] = await Promise.all(
      mode === 'year'
        ? [getAllAccountsSummaryForYear(period, catIds),  ...accts.map(a => getAccountSummaryForYear(a.id,  period, catIds))]
        : [getAllAccountsSummaryForMonth(period, catIds), ...accts.map(a => getAccountSummaryForMonth(a.id, period, catIds))],
    );
    setAllSummary(allSum);
    setAccounts(accts.map((a, i) => ({ ...a, summary: acctSums[i] })));
  }

  async function refreshCategoriesInPeriod(mode: FilterMode, period: string, allCats: Category[]) {
    if (!period) { setCategoriesInPeriod([]); return; }
    const ids = mode === 'year'
      ? await getDistinctCategoryIdsForYear(period)
      : await getDistinctCategoryIdsForMonth(period);
    const idSet = new Set(ids);
    setCategoriesInPeriod(allCats.filter(c => idSet.has(c.id)));
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths, dbYears, allCats] = await Promise.all([
        getAllAccounts(), getDistinctMonths(), getDistinctYears(), getAllCategories(),
      ]);
      if (!active) return;

      setCategories(allCats);

      const monthList = buildMonthList(dbMonths);
      const yearList  = buildYearList(dbYears);

      const curMonth  = selectedMonthRef.current;
      const curYear   = selectedYearRef.current;
      const curMode   = filterModeRef.current;
      const curCatIds = categoryFiltersRef.current;

      const month = (curMonth && monthList.some(m => m.key === curMonth))
        ? curMonth
        : monthList.find(m => m.count > 0)?.key ?? '';
      const year = (curYear && yearList.some(y => y.key === curYear))
        ? curYear
        : yearList[0]?.key ?? '';

      setMonths(monthList);
      setYears(yearList);
      updateMonth(month);
      updateYear(year);

      const period = curMode === 'year' ? year : month;
      if (period && accts.length > 0) {
        const [allSum, ...acctSums] = await Promise.all(
          curMode === 'year'
            ? [getAllAccountsSummaryForYear(period, curCatIds),  ...accts.map(a => getAccountSummaryForYear(a.id,  period, curCatIds))]
            : [getAllAccountsSummaryForMonth(period, curCatIds), ...accts.map(a => getAccountSummaryForMonth(a.id, period, curCatIds))],
        );
        if (!active) return;
        setAllSummary(allSum);
        setAccounts(accts.map((a, i) => ({ ...a, summary: acctSums[i] })));
        await refreshCategoriesInPeriod(curMode, period, allCats);
      } else {
        setAccounts(accts.map(a => ({ ...a, summary: EMPTY_SUMMARY })));
        setAllSummary(null);
        setCategoriesInPeriod([]);
        const backup = await getBackupInfo();
        if (active) setHasBackup(backup.exists && backup.account_count > 0);
      }

      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []));

  async function handleRestore() {
    const data = await readBackupFromPath(BACKUP_PATH);
    if (!data) {
      Alert.alert("Hmm, I can't find it", "I couldn't locate a backup file to restore from.");
      return;
    }
    const accountWord = data.accounts.length === 1 ? 'account' : 'accounts';
    const txnWord     = data.transactions.length === 1 ? 'transaction' : 'transactions';
    Alert.alert(
      'Ready to restore?',
      `I found a backup from ${new Date(data.exported_at).toLocaleString()} with ${data.accounts.length} ${accountWord} and ${data.transactions.length} ${txnWord}. Want me to load it up?`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            try {
              await restoreFromData(data);
              const [restored, restoredMonths] = await Promise.all([
                getAllAccounts(), getDistinctMonths(),
              ]);
              const restoredList  = buildMonthList(restoredMonths);
              const restoredMonth = restoredList.find(m => m.count > 0)?.key ?? '';
              setMonths(restoredList);
              updateMonth(restoredMonth);
              setHasBackup(false);
              if (restoredMonth && restored.length > 0) {
                const [allSum, ...acctSums] = await Promise.all([
                  getAllAccountsSummaryForMonth(restoredMonth),
                  ...restored.map(a => getAccountSummaryForMonth(a.id, restoredMonth)),
                ]);
                setAllSummary(allSum);
                setAccounts(restored.map((a, i) => ({ ...a, summary: acctSums[i] })));
              } else {
                setAccounts(restored.map(a => ({ ...a, summary: EMPTY_SUMMARY })));
              }
            } catch (e: any) {
              Alert.alert('Restore failed', e.message ?? 'Something went wrong.');
            }
          },
        },
      ],
    );
  }

  async function handleMonthChange(month: string) {
    updateMonth(month);
    updateMode('month');
    updateCategoryFilters([]);
    await Promise.all([
      loadSummaries(accounts.map(a => a), 'month', month, []),
      refreshCategoriesInPeriod('month', month, categories),
    ]);
  }

  async function handleYearChange(year: string) {
    updateYear(year);
    updateMode('year');
    updateCategoryFilters([]);
    await Promise.all([
      loadSummaries(accounts.map(a => a), 'year', year, []),
      refreshCategoriesInPeriod('year', year, categories),
    ]);
  }

  async function handleCategoryFilterChange(ids: string[]) {
    updateCategoryFilters(ids);
    const mode   = filterModeRef.current;
    const period = mode === 'year' ? selectedYearRef.current : selectedMonthRef.current;
    await loadSummaries(accounts.map(a => a), mode, period, ids);
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
      <Stack.Screen
        options={{
          title: 'Slo N Ready',
          headerRight: () => (
            <View style={styles.headerBtnsRight}>
              <TouchableOpacity onPress={() => router.push('/categories')} hitSlop={12}>
                <Text style={styles.categoriesBtn}>Categories</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/backup')} hitSlop={12}>
                <Text style={styles.backupBtn}>Backup</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />
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
              {/* Date + category picker row */}
              {(months.length > 0 || years.length > 0) && (
                <View style={styles.pickerRow}>
                  <MonthPicker
                    months={months}
                    years={years}
                    filterMode={filterMode}
                    selectedMonth={selectedMonth}
                    selectedYear={selectedYear}
                    onChangeMonth={handleMonthChange}
                    onChangeYear={handleYearChange}
                  />
                  {categoriesInPeriod.length > 0 && (
                    <CategoryPicker
                      categories={categoriesInPeriod}
                      selected={categoryFilters}
                      onSelect={handleCategoryFilterChange}
                    />
                  )}
                </View>
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
              <Text style={styles.emptyTitle}>Hi, I'm Rachey!</Text>
              <Text style={styles.emptyBody}>
                I'll help you track your spending — add your first account and we'll go at our own pace.
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => router.push('/account/new')}
              >
                <Text style={styles.emptyButtonText}>Add First Account</Text>
              </TouchableOpacity>
              {hasBackup && (
                <TouchableOpacity
                  style={styles.restoreButton}
                  onPress={handleRestore}
                >
                  <Text style={styles.restoreButtonText}>Restore from Backup</Text>
                </TouchableOpacity>
              )}
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
  pickerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

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
  restoreButton:     { paddingVertical: 14, alignItems: 'center' },
  restoreButtonText: { fontFamily: font.semiBold, fontSize: 15, color: colors.textSecondary },

  fab: {
    position: 'absolute', right: spacing.lg,
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1A4030', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabText:   { fontSize: 30, color: colors.textOnColor, lineHeight: 34, fontFamily: font.regular },
  headerBtnsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  categoriesBtn:   { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  backupBtn:       { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
});

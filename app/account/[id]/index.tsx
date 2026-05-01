import React, { useCallback, useMemo, useRef, useState } from 'react';
import { usePeriodFilter } from '../../../src/hooks/usePeriodFilter';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Transaction, Category, Budget,
  getAllAccounts, deleteAccount,
  getDistinctMonths, getTransactionsForMonth,
  getDistinctYears, getTransactionsForYear,
  getAllCategories, setTransactionCategory, bulkManualSetCategory,
  getBudgetsForAccountYear, getActualsByCategoryMonth,
  getFoundationalRuleSettingsForAccount,
} from '../../../src/db/queries';
import { writeBackupSafe } from '../../../src/db/backup';
import { buildMonthList, buildYearList, MonthEntry, YearEntry } from '../../../src/domain/month';
import { monthsForPeriod } from '../../../src/domain/budget';
import { buildCategoryRows, computeVarianceSummary } from '../../../src/domain/budget-variance';
import { SummaryBar } from '../../../src/components/SummaryBar';
import { MonthPicker, FilterMode } from '../../../src/components/MonthPicker';
import { CategoryPicker, NONE_FILTER } from '../../../src/components/CategoryPicker';
import { TransactionRow } from '../../../src/components/TransactionRow';
import { CategoryPickerSheet } from '../../../src/components/CategoryPickerSheet';
import { ActivityBudgetToggle } from '../../../src/components/ActivityBudgetToggle';
import { BudgetView } from '../../../src/components/BudgetView';
import { Sloth } from '../../../src/components/Sloth';
import { RacheyBanner } from '../../../src/components/RacheyBanner';
import { colors, font, spacing, radius, accountColor } from '../../../src/theme';
import { centsToDollars } from '../../../src/domain/money';

type ActualRow = { category_id: string; month: string; total_cents: number };

export default function AccountDetailScreen() {
  const { id, showFoundationalOnboarding } =
    useLocalSearchParams<{ id: string; showFoundationalOnboarding?: string }>();
  const router   = useRouter();
  const insets   = useSafeAreaInsets();

  // Guard so the onboarding push fires once per param-pass — useLocalSearchParams
  // can re-fire on focus or render before our setParams has cleared the flag.
  const onboardingFiredRef = useRef(false);

  // ── period / view filters (state + matching refs for async paths) ────────
  const {
    month:         selectedMonth,
    year:          selectedYear,
    filterMode,
    viewMode,
    categoryFilters,
    setMonth:           updateMonth,
    setYear:            updateYear,
    setFilterMode:      updateMode,
    setViewMode:        updateViewMode,
    setCategoryFilters,
    refs:               periodRefs,
    yearForCurrentPeriod,
  } = usePeriodFilter();

  // ── other screen state ───────────────────────────────────────────────────
  const [account,               setAccount]               = useState<Account | null>(null);
  const [transactions,          setTransactions]          = useState<Transaction[]>([]);
  const [months,                setMonths]                = useState<MonthEntry[]>([]);
  const [years,                 setYears]                 = useState<YearEntry[]>([]);
  const [categories,            setCategories]            = useState<Category[]>([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [loading,               setLoading]               = useState(true);
  const [menuOpen,              setMenuOpen]              = useState(false);
  const [bulkMode,              setBulkMode]              = useState(false);
  const [selectedIds,           setSelectedIds]           = useState<Set<string>>(new Set());
  const [bulkPickerVisible,     setBulkPickerVisible]     = useState(false);
  const [searchText,            setSearchText]            = useState('');
  const [breakdownOpen,         setBreakdownOpen]         = useState(false);
  const [undoBanner,            setUndoBanner]            = useState<{ txId: string; prevCategoryId: string | null } | null>(null);
  const [racheyMoment,          setRacheyMoment]          = useState<'firstTransactionCategorized' | 'bulkCategorize' | null>(null);

  // ── Budget view state ─────────────────────────────────────────────────────
  const [budgetDataYear, setBudgetDataYear] = useState<string | null>(null);
  const [budgetRows,     setBudgetRows]     = useState<Budget[]>([]);
  const [actualsRows,    setActualsRows]    = useState<ActualRow[]>([]);

  // ── budget data loading ───────────────────────────────────────────────────
  async function loadBudgetData(year: string) {
    if (budgetDataYear === year) return;
    const [b, a] = await Promise.all([
      getBudgetsForAccountYear(id, year),
      getActualsByCategoryMonth(id, year),
    ]);
    setBudgetRows(b);
    setActualsRows(a);
    setBudgetDataYear(year);
  }

  // ── focus effect ──────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths, dbYears, cats] = await Promise.all([
        getAllAccounts(), getDistinctMonths(id), getDistinctYears(id), getAllCategories(),
      ]);
      if (!active) return;

      const acct      = accts.find(a => a.id === id) ?? null;
      const monthList = buildMonthList(dbMonths);
      const yearList  = buildYearList(dbYears);

      const curMonth = periodRefs.month.current;
      const curYear  = periodRefs.year.current;
      const curMode  = periodRefs.filterMode.current;

      const month = (curMonth && monthList.some(m => m.key === curMonth))
        ? curMonth : monthList.find(m => m.count > 0)?.key ?? '';
      const year  = (curYear && yearList.some(y => y.key === curYear))
        ? curYear : yearList[0]?.key ?? '';

      setAccount(acct);
      setMonths(monthList);
      setYears(yearList);
      setCategories(cats);
      updateMonth(month);
      updateYear(year);

      const period = curMode === 'year' ? year : month;
      const txns = period
        ? await (curMode === 'year'
            ? getTransactionsForYear(id, period)
            : getTransactionsForMonth(id, period))
        : [];
      if (!active) return;
      setTransactions(txns);
      setLoading(false);

      // Invalidate budget cache on refocus; reload if Budget view is active
      setBudgetDataYear(null);
      if (periodRefs.viewMode.current === 'budget') {
        const yr = curMode === 'year' ? year : month.slice(0, 4);
        if (yr) {
          const [b, a] = await Promise.all([
            getBudgetsForAccountYear(id, yr),
            getActualsByCategoryMonth(id, yr),
          ]);
          if (!active) return;
          setBudgetRows(b);
          setActualsRows(a);
          setBudgetDataYear(yr);
        }
      }
    })();
    return () => { active = false; };
  }, [id]));

  // ── Foundational rules onboarding trigger ─────────────────────────────────
  // Fires when /account/new redirects here with ?showFoundationalOnboarding=1.
  // Only pushes if this account has no foundational_rule_settings rows yet —
  // skipping a previous time writes enabled=0 rows, which prevent re-prompting.
  useFocusEffect(useCallback(() => {
    if (showFoundationalOnboarding !== '1' || onboardingFiredRef.current) return;
    onboardingFiredRef.current = true;
    let active = true;
    (async () => {
      const [existing, allAccts] = await Promise.all([
        getFoundationalRuleSettingsForAccount(id),
        getAllAccounts(),
      ]);
      if (!active) return;
      // Strip the param so navigating back here later doesn't re-fire.
      router.setParams({ showFoundationalOnboarding: undefined });
      if (existing.length > 0) return; // user already saw onboarding for this account
      const isFirst = allAccts.length === 1;
      router.push({
        pathname: '/onboarding/foundational-rules',
        params: { accountId: id, first: isFirst ? '1' : '0' },
      });
    })();
    return () => { active = false; };
  }, [id, showFoundationalOnboarding]));

  async function handleMonthChange(month: string) {
    updateMonth(month);
    updateMode('month');
    setCategoryFilters([]);
    setSearchText('');
    setTransactions(await getTransactionsForMonth(id, month));
    if (periodRefs.viewMode.current === 'budget') void loadBudgetData(month.slice(0, 4));
  }

  async function handleYearChange(year: string) {
    updateYear(year);
    updateMode('year');
    setCategoryFilters([]);
    setSearchText('');
    setTransactions(await getTransactionsForYear(id, year));
    if (periodRefs.viewMode.current === 'budget') void loadBudgetData(year);
  }

  async function handleToggleViewMode(v: 'activity' | 'budget') {
    updateViewMode(v);
    if (v === 'budget') void loadBudgetData(yearForCurrentPeriod());
  }

  // ── derived data (activity) ───────────────────────────────────────────────
  const categoriesInPeriod = useMemo(() => {
    const ids = new Set(
      transactions.filter(t => t.category_id && t.dropped_at === null).map(t => t.category_id!),
    );
    return categories.filter(c => ids.has(c.id));
  }, [transactions, categories]);

  const hasUncategorized = useMemo(() =>
    transactions.some(t => t.category_id === null && t.dropped_at === null),
  [transactions]);

  const filteredTransactions = useMemo(() => {
    if (categoryFilters.length === 0) return transactions;
    const noneSelected  = categoryFilters.includes(NONE_FILTER);
    const realFilters   = categoryFilters.filter(f => f !== NONE_FILTER);
    return transactions.filter(t =>
      (noneSelected && t.category_id === null) ||
      (realFilters.length > 0 && t.category_id !== null && realFilters.includes(t.category_id)),
    );
  }, [transactions, categoryFilters]);

  const displayedTransactions = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return filteredTransactions;
    return filteredTransactions.filter(t => t.description.toLowerCase().includes(q));
  }, [filteredTransactions, searchText]);

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map(c => [c.id, c])),
    [categories],
  );

  const monthSummary = useMemo(() => {
    const active = displayedTransactions.filter(t => t.dropped_at === null);
    const isExcluded = (t: { category_id: string | null }) =>
      !!categoryMap[t.category_id ?? '']?.exclude_from_totals;
    return {
      income_cents:   active.filter(t => t.amount_cents > 0 && !isExcluded(t)).reduce((s, t) => s + t.amount_cents, 0),
      expense_cents:  active.filter(t => t.amount_cents < 0 && !isExcluded(t)).reduce((s, t) => s + t.amount_cents, 0),
      net_cents:      active.filter(t => !isExcluded(t)).reduce((s, t) => s + t.amount_cents, 0),
      excluded_cents: active.filter(t => isExcluded(t)).reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [displayedTransactions, categoryMap]);

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (t.dropped_at !== null) continue;
      const key = t.category_id ?? '__none__';
      map.set(key, (map.get(key) ?? 0) + t.amount_cents);
    }
    return Array.from(map.entries())
      .filter(([, total]) => total !== 0)
      .map(([key, total]) => {
        if (key === '__none__') return { key, name: 'Uncategorized', color: null, total };
        const cat = categoryMap[key];
        return { key, name: cat?.name ?? 'Unknown', color: cat?.color ?? null, total };
      })
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [transactions, categoryMap]);

  const allDisplayedSelected = displayedTransactions.length > 0 &&
    displayedTransactions.every(t => selectedIds.has(t.id));

  // ── derived data (budget view) ────────────────────────────────────────────
  const monthsInRange = useMemo(
    () => monthsForPeriod(filterMode, selectedMonth, selectedYear),
    [filterMode, selectedMonth, selectedYear],
  );

  const budgetCategoryRows = useMemo(
    () => buildCategoryRows(budgetRows, actualsRows, monthsInRange),
    [budgetRows, actualsRows, monthsInRange],
  );

  const budgetSummary = useMemo(
    () => computeVarianceSummary(
      budgetCategoryRows.filter(r => !categoryMap[r.category_id]?.exclude_from_totals),
    ),
    [budgetCategoryRows, categoryMap],
  );

  const hasAnyBudget = useMemo(() => {
    const rangeSet = new Set(monthsInRange);
    return budgetRows.some(r => rangeSet.has(r.month));
  }, [budgetRows, monthsInRange]);

  const ytdNote = useMemo(() => {
    if (filterMode !== 'year') return undefined;
    const thisYear = new Date().getFullYear().toString();
    if (selectedYear !== thisYear) return undefined;
    const nowMonth = new Date().getMonth(); // 0-indexed
    if (nowMonth >= 11) return undefined; // full year elapsed
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    return `Through ${monthNames[nowMonth]} ${selectedYear}`;
  }, [filterMode, selectedYear]);

  // ── misc handlers ─────────────────────────────────────────────────────────
  function handleSelectAll() {
    if (allDisplayedSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedTransactions.map(t => t.id)));
    }
  }

  function toggleSelectId(txId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId); else next.add(txId);
      return next;
    });
  }

  function exitBulkMode() {
    setBulkMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkCategorySelect(categoryId: string | null) {
    const ids = Array.from(selectedIds);
    await bulkManualSetCategory(ids, categoryId);
    setTransactions(prev => prev.map(t =>
      selectedIds.has(t.id)
        ? { ...t, category_id: categoryId, category_set_manually: 1, applied_rule_id: null }
        : t,
    ));
    exitBulkMode();
    setBulkPickerVisible(false);
    writeBackupSafe();
    if (categoryId) setRacheyMoment('bulkCategorize');
  }

  function handleDelete() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete this account and all its transactions. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => { await deleteAccount(id); writeBackupSafe(); router.back(); },
        },
      ],
    );
  }

  async function handleCategorySelect(categoryId: string | null) {
    if (!selectedTransactionId) return;
    const tx = transactions.find(t => t.id === selectedTransactionId);
    if (tx?.category_id === categoryId) { setSelectedTransactionId(null); return; }
    const wasUncategorized = tx?.category_id == null;
    const prevCategoryId = tx?.category_id ?? null;
    const isFirstCategorized = wasUncategorized && categoryId !== null &&
      transactions.filter(t => t.category_id !== null && t.dropped_at === null).length === 0;
    await setTransactionCategory(selectedTransactionId, categoryId, true, null);
    setTransactions(prev => prev.map(t =>
      t.id === selectedTransactionId
        ? { ...t, category_id: categoryId, category_set_manually: 1, applied_rule_id: null }
        : t,
    ));
    setSelectedTransactionId(null);
    writeBackupSafe();
    if (isFirstCategorized) setRacheyMoment('firstTransactionCategorized');

    if (wasUncategorized && categoryId && tx?.description) {
      if (account?.suggest_rules !== 0) {
        Alert.alert(
          'Create a rule?',
          `Want to automatically categorize future transactions containing "${tx.description}"?`,
          [
            {
              text: 'Undo',
              onPress: async () => {
                await setTransactionCategory(tx.id, null, false, null);
                setTransactions(prev => prev.map(t =>
                  t.id === tx.id
                    ? { ...t, category_id: null, category_set_manually: 0, applied_rule_id: null }
                    : t,
                ));
                writeBackupSafe();
              },
            },
            { text: 'No thanks', style: 'cancel' },
            {
              text: 'Create Rule',
              onPress: () => router.push({
                pathname: `/account/${id}/rules`,
                params: { prefillText: tx.description, prefillCategory: categoryId },
              }),
            },
          ],
        );
      } else {
        setUndoBanner({ txId: tx.id, prevCategoryId });
      }
    }
  }

  // ── early returns ─────────────────────────────────────────────────────────
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

  const accent       = accountColor[account.type];
  const showPickers  = months.length > 0 || years.length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: bulkMode ? `${selectedIds.size} selected` : account.name,
          headerRight: () =>
            bulkMode ? (
              <TouchableOpacity onPress={exitBulkMode} hitSlop={12}>
                <Text style={styles.editBtn}>Done</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={12}>
                <Text style={styles.menuDots}>•••</Text>
              </TouchableOpacity>
            ),
        }}
      />

      {/* Action menu dropdown */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuCard, { top: insets.top + 44 + 6 }]}>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push(`/account/${id}/rules`); }}>
            <Text style={styles.menuItemText}>Rules</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push(`/account/${id}/budget`); }}>
            <Text style={styles.menuItemText}>Budget</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push(`/account/${id}/edit`); }}>
            <Text style={styles.menuItemText}>Edit Account</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setBulkMode(true); }}>
            <Text style={styles.menuItemText}>Bulk Categorize</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <View style={styles.container}>
        <View style={[styles.typeStrip, { backgroundColor: accent }]}>
          <Text style={styles.typeStripText}>
            {account.type === 'checking' ? 'Checking Account' : 'Credit Card'}
          </Text>
        </View>

        {showPickers && (
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
            <ActivityBudgetToggle value={viewMode} onChange={handleToggleViewMode} />
            {viewMode === 'activity' && (categoriesInPeriod.length > 0 || hasUncategorized) && (
              <CategoryPicker
                categories={categoriesInPeriod}
                selected={categoryFilters}
                onSelect={setCategoryFilters}
                showNone={hasUncategorized}
              />
            )}
          </View>
        )}

        {/* ── Budget view ─────────────────────────────────────────── */}
        {viewMode === 'budget' && (
          <BudgetView
            summary={budgetSummary}
            rows={budgetCategoryRows}
            categoryById={categoryMap}
            hasAnyBudget={hasAnyBudget}
            budgetGridHref={`/account/${id}/budget`}
            ytdNote={ytdNote}
          />
        )}

        {/* ── Activity view ───────────────────────────────────────── */}
        {viewMode === 'activity' && (
          <>
            {categoryTotals.length > 0 && (
              <View style={styles.breakdown}>
                <TouchableOpacity
                  style={styles.breakdownHeader}
                  onPress={() => setBreakdownOpen(o => !o)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.breakdownTitle}>Totals by Category</Text>
                  <Text style={styles.breakdownChevron}>{breakdownOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {breakdownOpen && categoryTotals.map(row => (
                  <TouchableOpacity
                    key={row.key}
                    style={styles.breakdownRow}
                    activeOpacity={0.7}
                    onPress={() => { setCategoryFilters([row.key]); setBreakdownOpen(false); }}
                  >
                    {row.color
                      ? <View style={[styles.breakdownDot, { backgroundColor: row.color }]} />
                      : <View style={[styles.breakdownDot, styles.breakdownDotEmpty]} />
                    }
                    <Text style={styles.breakdownName} numberOfLines={1}>{row.name}</Text>
                    <Text style={[styles.breakdownAmount, { color: row.total >= 0 ? colors.income : colors.text }]}>
                      {centsToDollars(row.total)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {transactions.length > 0 && (
              <View style={styles.searchBar}>
                <Text style={styles.searchIcon}>⌕</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search transactions…"
                  placeholderTextColor={colors.textTertiary}
                  value={searchText}
                  onChangeText={setSearchText}
                  clearButtonMode="while-editing"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            )}

            <SummaryBar
              incomeCents={monthSummary.income_cents}
              expenseCents={monthSummary.expense_cents}
              netCents={monthSummary.net_cents}
              excludedCents={monthSummary.excluded_cents}
            />

            {bulkMode && displayedTransactions.length > 0 && (
              <TouchableOpacity style={styles.selectAllBar} onPress={handleSelectAll} activeOpacity={0.7}>
                <Text style={styles.selectAllText}>
                  {allDisplayedSelected ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
            )}

            {racheyMoment && (
              <RacheyBanner moment={racheyMoment} onDismiss={() => setRacheyMoment(null)} />
            )}

            <FlatList
              data={displayedTransactions}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TransactionRow
                  transaction={item}
                  category={item.category_id ? categoryMap[item.category_id] ?? null : null}
                  onPress={bulkMode ? () => toggleSelectId(item.id) : () => setSelectedTransactionId(item.id)}
                  bulkMode={bulkMode}
                  selected={selectedIds.has(item.id)}
                />
              )}
              contentContainerStyle={[
                displayedTransactions.length === 0 && styles.emptyContainer,
                { paddingBottom: insets.bottom + 88 },
              ]}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Sloth sloth="receipt" size={120} />
                  <Text style={styles.emptyTitle}>No transactions yet</Text>
                  <Text style={styles.emptyBody}>
                    {months.length === 0
                      ? "Take a breath. Tap Import CSV when you're ready and I'll get to work."
                      : categoryFilters.length > 0
                      ? "No transactions match the selected categories."
                      : "Nothing for this period — try another month or import more."}
                  </Text>
                </View>
              }
            />

            {bulkMode ? (
              <TouchableOpacity
                style={[
                  styles.importFab,
                  { bottom: insets.bottom + spacing.lg, backgroundColor: accent },
                  selectedIds.size === 0 && styles.fabDisabled,
                ]}
                onPress={() => selectedIds.size > 0 && setBulkPickerVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.importFabText}>
                  Bulk Categorize{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.importFab, { bottom: insets.bottom + spacing.lg, backgroundColor: accent }]}
                onPress={() => router.push(`/account/${id}/import`)}
                activeOpacity={0.85}
              >
                <Text style={styles.importFabText}>Import CSV</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      <CategoryPickerSheet
        visible={selectedTransactionId !== null}
        categories={categories}
        currentCategoryId={
          transactions.find(t => t.id === selectedTransactionId)?.category_id ?? null
        }
        onClose={() => setSelectedTransactionId(null)}
        onSelect={handleCategorySelect}
        onCategoryCreated={cat => setCategories(prev => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))}
      />

      <CategoryPickerSheet
        visible={bulkPickerVisible}
        categories={categories}
        currentCategoryId={null}
        onClose={() => setBulkPickerVisible(false)}
        onSelect={handleBulkCategorySelect}
        onCategoryCreated={cat => setCategories(prev => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))}
      />

      {undoBanner && (
        <>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setUndoBanner(null)}
          />
          <View style={[styles.undoBanner, { bottom: insets.bottom + spacing.lg + 64 }]}>
            <Text style={styles.undoBannerText}>Transaction categorized</Text>
            <TouchableOpacity
              onPress={async () => {
                await setTransactionCategory(undoBanner.txId, undoBanner.prevCategoryId, false, null);
                setTransactions(prev => prev.map(t =>
                  t.id === undoBanner.txId
                    ? { ...t, category_id: undoBanner.prevCategoryId, category_set_manually: 0, applied_rule_id: null }
                    : t,
                ));
                setUndoBanner(null);
                writeBackupSafe();
              }}
            >
              <Text style={styles.undoBannerAction}>Undo</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
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

  menuDots: {
    fontFamily:  font.bold,
    fontSize:    18,
    color:       colors.primary,
    letterSpacing: 2,
    marginRight: 4,
  },
  editBtn: { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },

  menuBackdrop: { ...StyleSheet.absoluteFillObject },
  menuCard: {
    position:          'absolute',
    right:             spacing.md,
    backgroundColor:   colors.surface,
    borderRadius:      radius.md,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.15,
    shadowRadius:      12,
    elevation:         8,
    minWidth:          160,
    overflow:          'hidden',
  },
  menuItem: {
    paddingVertical:   14,
    paddingHorizontal: spacing.md,
  },
  menuItemText: { fontFamily: font.semiBold, fontSize: 15, color: colors.text },
  menuDivider:  { height: 1, backgroundColor: colors.separator },

  pickerRow: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   4,
    gap:               spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  breakdown: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    backgroundColor:   colors.surface,
  },
  breakdownHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical:   11,
  },
  breakdownTitle: {
    fontFamily: font.semiBold,
    fontSize:   14,
    color:      colors.textSecondary,
    letterSpacing: 0.3,
  },
  breakdownChevron: {
    fontSize: 10,
    color:    colors.textTertiary,
  },
  breakdownRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   9,
    borderTopWidth:    1,
    borderTopColor:    colors.separator,
    gap:               spacing.sm,
  },
  breakdownDot: {
    width: 10, height: 10, borderRadius: radius.full, flexShrink: 0,
  },
  breakdownDotEmpty: {
    borderWidth: 1, borderColor: colors.border,
  },
  breakdownName: {
    fontFamily: font.regular,
    fontSize:   14,
    color:      colors.text,
    flex:       1,
  },
  breakdownAmount: {
    fontFamily: font.semiBold,
    fontSize:   14,
  },

  searchBar: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    gap:               spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    backgroundColor:   colors.surface,
  },
  searchIcon: {
    fontSize:  19,
    color:     colors.textTertiary,
    marginTop: 1,
  },
  searchInput: {
    flex:       1,
    fontFamily: font.regular,
    fontSize:   15,
    color:      colors.text,
    paddingVertical: 4,
  },

  selectAllBar: {
    paddingHorizontal: spacing.md,
    paddingVertical:   10,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    backgroundColor:   colors.surface,
  },
  selectAllText: {
    fontFamily: font.semiBold,
    fontSize:   14,
    color:      colors.primary,
  },

  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text, marginTop: spacing.sm },
  emptyBody:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  undoBanner: {
    position:          'absolute',
    left:              spacing.lg,
    right:             spacing.lg,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   colors.text,
    paddingVertical:   14,
    paddingHorizontal: spacing.md,
    borderRadius:      radius.md,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 2 },
    shadowOpacity:     0.2,
    shadowRadius:      6,
    elevation:         6,
  },
  undoBannerText:   { fontFamily: font.regular,  fontSize: 14, color: colors.textOnColor },
  undoBannerAction: { fontFamily: font.semiBold, fontSize: 14, color: colors.primary },

  importFab: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    borderRadius: radius.full, paddingVertical: 16, alignItems: 'center',
    shadowColor: '#2C2416', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  importFabText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },
  fabDisabled:   { opacity: 0.45 },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Modal, TextInput, StyleSheet, SafeAreaView,
  ActivityIndicator, Alert, ScrollView, Switch,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Rule, RuleCondition, Category, MatchType,
  getRulesForAccount, getAllCategories, getAllAccounts,
  insertRule, updateRule, deleteRule, reorderRules, insertCategory,
  updateAccountSuggestRules,
} from '../../../src/db/queries';
import { autoApplyRulesForAccount } from '../../../src/domain/rules-engine';
import { CATEGORY_COLORS } from '../../../src/domain/category-colors';
import { Sloth } from '../../../src/components/Sloth';
import { RacheyBanner } from '../../../src/components/RacheyBanner';
import { colors, font, spacing, radius } from '../../../src/theme';
import * as Crypto from 'expo-crypto';

const TEXT_MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: 'contains',    label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with',   label: 'Ends with' },
  { value: 'equals',      label: 'Equals' },
];

const AMOUNT_MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: 'amount_eq', label: '=' },
  { value: 'amount_lt', label: '<' },
  { value: 'amount_gt', label: '>' },
];

const ALL_MATCH_TYPES = [...TEXT_MATCH_TYPES, ...AMOUNT_MATCH_TYPES];

function isAmountType(t: MatchType) {
  return t === 'amount_eq' || t === 'amount_lt' || t === 'amount_gt';
}

function centsToDisplayDollars(cents: string): string {
  const n = parseInt(cents, 10);
  if (isNaN(n)) return '';
  // Keep trailing decimal if user typed it — just show the dollar value
  return String(n / 100);
}

function displayDollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

function ruleMatchSummary(cond: { match_type: MatchType; match_text: string }): { typeLabel: string; valueLabel: string } {
  if (cond.match_type === 'amount_eq') return { typeLabel: 'Amount', valueLabel: `= $${(parseInt(cond.match_text, 10) / 100).toFixed(2)}` };
  if (cond.match_type === 'amount_lt') return { typeLabel: 'Amount', valueLabel: `< $${(parseInt(cond.match_text, 10) / 100).toFixed(2)}` };
  if (cond.match_type === 'amount_gt') return { typeLabel: 'Amount', valueLabel: `> $${(parseInt(cond.match_text, 10) / 100).toFixed(2)}` };
  const typeLabel = ALL_MATCH_TYPES.find(m => m.value === cond.match_type)?.label ?? cond.match_type;
  return { typeLabel, valueLabel: `"${cond.match_text}"` };
}

// Three states for the inline category picker within the rule form
type CatView = 'collapsed' | 'list' | 'create';

interface RuleWithCategory extends Rule { categoryName: string; categoryColor: string; }

export default function AccountRulesScreen() {
  const { id, prefillText, prefillCategory } = useLocalSearchParams<{
    id: string;
    prefillText?: string;
    prefillCategory?: string;
  }>();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const [account,       setAccount]       = useState<Account | null>(null);
  const [rules,         setRules]         = useState<RuleWithCategory[]>([]);
  const [categories,    setCategories]    = useState<Category[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [racheyMoment,  setRacheyMoment]  = useState<'firstRule' | null>(null);

  // Rule form sheet
  const [sheetOpen,     setSheetOpen]     = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [conditions,    setConditions]    = useState<RuleCondition[]>([{ match_type: 'contains', match_text: '' }]);
  const [logic,         setLogic]         = useState<'AND' | 'OR'>('AND');
  const [categoryId,    setCategoryId]    = useState('');
  const [saving,        setSaving]        = useState(false);

  // Tracks whether we've already consumed the prefill params (so it only fires once)
  const prefillApplied = useRef(false);
  // True when the sheet was opened via the "Create Rule?" prefill flow
  const fromPrefill = useRef(false);

  // Inline category picker (inside the sheet ScrollView — no second modal)
  const [catView,     setCatView]     = useState<CatView>('collapsed');
  const [newCatName,  setNewCatName]  = useState('');
  const [newCatColor, setNewCatColor] = useState<string>(CATEGORY_COLORS[0].hex);
  const [creatingCat, setCreatingCat] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, rawRules, cats] = await Promise.all([
        getAllAccounts(),
        getRulesForAccount(id),
        getAllCategories(),
      ]);
      if (!active) return;
      setAccount(accts.find(a => a.id === id) ?? null);
      const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
      setRules(rawRules.map(r => ({
        ...r,
        categoryName:  catMap[r.category_id]?.name  ?? '(deleted)',
        categoryColor: catMap[r.category_id]?.color ?? colors.textTertiary,
      })));
      setCategories(cats);
      if (cats.length > 0 && !categoryId) setCategoryId(cats[0].id);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]));

  // Auto-open Add sheet pre-filled when navigated here from the "Create Rule?" prompt
  useEffect(() => {
    if (!prefillText || prefillApplied.current || loading) return;
    prefillApplied.current = true;
    fromPrefill.current    = true;
    setEditingRuleId(null);
    setConditions([{ match_type: 'contains', match_text: prefillText }]);
    setLogic('AND');
    if (prefillCategory) setCategoryId(prefillCategory);
    else if (categories.length > 0) setCategoryId(categories[0].id);
    setCatView('collapsed');
    setSheetOpen(true);
  }, [loading, prefillText, prefillCategory]);

  function openAddSheet() {
    setEditingRuleId(null);
    setConditions([{ match_type: 'contains', match_text: '' }]);
    setLogic('AND');
    if (categories.length > 0) setCategoryId(categories[0].id);
    setCatView('collapsed');
    setSheetOpen(true);
  }

  function openEditSheet(rule: RuleWithCategory) {
    setEditingRuleId(rule.id);
    setConditions(rule.conditions.map(c => ({
      match_type: c.match_type,
      match_text: isAmountType(c.match_type) ? centsToDisplayDollars(c.match_text) : c.match_text,
    })));
    setLogic(rule.logic ?? 'AND');
    setCategoryId(rule.category_id);
    setCatView('collapsed');
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setCatView('collapsed');
    if (fromPrefill.current) {
      fromPrefill.current = false;
      router.back();
    }
  }

  function selectCategory(id: string) {
    setCategoryId(id);
    setCatView('collapsed');
  }

  function openCreateForm() {
    setNewCatName('');
    setNewCatColor(CATEGORY_COLORS[0].hex);
    setCatView('create');
  }

  async function handleQuickCreateCat() {
    const trimmed = newCatName.trim();
    if (!trimmed || creatingCat) return;
    setCreatingCat(true);
    try {
      const newId = Crypto.randomUUID();
      await insertCategory({ id: newId, name: trimmed, color: newCatColor });
      const newCat: Category = { id: newId, name: trimmed, color: newCatColor, created_at: Date.now() };
      setCategories(prev => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(newId);
      setCatView('collapsed'); // header shows newly created category, list closed
    } finally {
      setCreatingCat(false);
    }
  }

  async function reloadRules() {
    const [rawRules, cats] = await Promise.all([getRulesForAccount(id), getAllCategories()]);
    const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
    setRules(rawRules.map(r => ({
      ...r,
      categoryName:  catMap[r.category_id]?.name  ?? '(deleted)',
      categoryColor: catMap[r.category_id]?.color ?? colors.textTertiary,
    })));
  }

  function updateCondition(idx: number, patch: Partial<RuleCondition>) {
    setConditions(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  function changeConditionType(idx: number, type: MatchType) {
    setConditions(prev => prev.map((c, i) =>
      i === idx ? { match_type: type, match_text: isAmountType(type) !== isAmountType(c.match_type) ? '' : c.match_text } : c,
    ));
  }

  function addCondition() {
    setConditions(prev => [...prev, { match_type: 'contains', match_text: '' }]);
  }

  function removeCondition(idx: number) {
    setConditions(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveRule() {
    if (!categoryId || conditions.length === 0) return;
    const stored: RuleCondition[] = conditions.map(c => ({
      match_type: c.match_type,
      match_text: isAmountType(c.match_type) ? String(displayDollarsToCents(c.match_text.trim())) : c.match_text.trim(),
    }));
    if (stored.some(c => !c.match_text || (isAmountType(c.match_type) && isNaN(Number(c.match_text))))) return;
    const first = stored[0];
    setSaving(true);
    try {
      if (editingRuleId) {
        await updateRule(editingRuleId, {
          match_type: first.match_type, match_text: first.match_text,
          category_id: categoryId, logic, conditions: stored,
        });
        await reloadRules();
        closeSheet();
      } else {
        const isFirstRule = rules.length === 0 && !fromPrefill.current;
        const maxPriority = rules.length > 0 ? Math.max(...rules.map(r => r.priority)) : 0;
        await insertRule({
          id: Crypto.randomUUID(),
          account_id: id,
          category_id: categoryId,
          match_type: first.match_type,
          match_text: first.match_text,
          logic,
          conditions: stored,
          priority: maxPriority + 1,
        });
        await reloadRules();
        if (isFirstRule) setRacheyMoment('firstRule');
        const navigateBack = fromPrefill.current;
        // Close sheet without triggering back-navigation yet — alert comes first
        fromPrefill.current = false;
        setSheetOpen(false);
        setCatView('collapsed');
        Alert.alert(
          'Rule saved!',
          'Want to apply this rule to your existing uncategorized transactions now?',
          [
            {
              text: 'Not Now',
              style: 'cancel',
              onPress: () => { if (navigateBack) router.back(); },
            },
            {
              text: 'Apply Now',
              onPress: async () => {
                const count = await autoApplyRulesForAccount(id);
                Alert.alert('Done!', `Categorized ${count} transaction${count === 1 ? '' : 's'}.`);
                if (navigateBack) router.back();
              },
            },
          ],
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ruleId: string) {
    Alert.alert(
      'Delete Rule',
      'This rule will be removed. Transactions already categorized by it will keep their category.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteRule(ruleId);
            setRules(prev => prev.filter(r => r.id !== ruleId));
          },
        },
      ],
    );
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const newRules = [...rules];
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= newRules.length) return;
    [newRules[index], newRules[swapWith]] = [newRules[swapWith], newRules[index]];
    setRules(newRules);
    await reorderRules(newRules.map(r => r.id));
  }

  const selectedCat = categories.find(c => c.id === categoryId);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Rules',
          headerRight: () => (
            <TouchableOpacity onPress={openAddSheet} hitSlop={12}>
              <Text style={styles.addBtn}>Add</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {racheyMoment && (
          <RacheyBanner moment={racheyMoment} onDismiss={() => setRacheyMoment(null)} />
        )}
        <FlatList
          data={rules}
          keyExtractor={r => r.id}
          contentContainerStyle={rules.length === 0 && styles.listEmpty}
          ListHeaderComponent={(
            <View>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Suggest rule creation</Text>
                  <Text style={styles.settingDesc}>
                    After manually categorizing a transaction, suggest creating a rule for it.
                  </Text>
                </View>
                <Switch
                  value={account?.suggest_rules !== 0}
                  onValueChange={async (val) => {
                    const next = val ? 1 : 0;
                    setAccount(prev => prev ? { ...prev, suggest_rules: next } : prev);
                    await updateAccountSuggestRules(id, next);
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.surface}
                />
              </View>
              {rules.length > 0 && (
                <Text style={styles.hint}>Rules run top-to-bottom on import. First match wins. Tap a rule to edit it.</Text>
              )}
            </View>
          )}
          renderItem={({ item, index }) => (
            <View style={[styles.ruleRow, index > 0 && styles.rowBorder]}>
              <TouchableOpacity style={styles.ruleInfo} onPress={() => openEditSheet(item)} activeOpacity={0.6}>
                {(item.conditions.length > 0 ? item.conditions : [{ match_type: item.match_type, match_text: item.match_text }])
                  .map((c, ci) => {
                    const { typeLabel, valueLabel } = ruleMatchSummary(c);
                    return (
                      <React.Fragment key={ci}>
                        {ci > 0 && (
                          <Text style={styles.ruleLogicSep}>{item.logic ?? 'AND'}</Text>
                        )}
                        <Text style={styles.ruleMatchLine}>
                          <Text style={styles.ruleMatchType}>{typeLabel}</Text>
                          {' '}
                          <Text style={styles.ruleMatchText}>{valueLabel}</Text>
                        </Text>
                      </React.Fragment>
                    );
                  })}
                <View style={styles.ruleCategoryRow}>
                  <View style={[styles.ruleCatDot, { backgroundColor: item.categoryColor }]} />
                  <Text style={styles.ruleCatName}>{item.categoryName}</Text>
                </View>
              </TouchableOpacity>
              <View style={styles.ruleActions}>
                <TouchableOpacity onPress={() => handleMove(index, 'up')} disabled={index === 0} hitSlop={8}>
                  <Text style={[styles.arrow, index === 0 && styles.arrowDisabled]}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleMove(index, 'down')} disabled={index === rules.length - 1} hitSlop={8}>
                  <Text style={[styles.arrow, index === rules.length - 1 && styles.arrowDisabled]}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item.id)} hitSlop={8}>
                  <Text style={styles.deleteBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="books" size={120} />
              <Text style={styles.emptyTitle}>No rules yet</Text>
              <Text style={styles.emptyBody}>
                Knowing where it goes is half the battle. Tap "Add" to create a rule and I'll sort your transactions on import.
              </Text>
            </View>
          }
        />
      </View>

      {/* Rule form sheet */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeSheet} />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetScroll}>

            <Text style={styles.sheetTitle}>{editingRuleId ? 'Edit Rule' : 'Add Rule'}</Text>

            {/* Conditions */}
            {conditions.map((cond, idx) => (
              <React.Fragment key={idx}>
                {/* AND / OR separator — tappable to toggle */}
                {idx > 0 && (
                  <TouchableOpacity
                    style={styles.logicSep}
                    onPress={() => setLogic(l => l === 'AND' ? 'OR' : 'AND')}
                    activeOpacity={0.7}
                  >
                    <View style={styles.logicLine} />
                    <Text style={styles.logicLabel}>{logic} ⇅</Text>
                    <View style={styles.logicLine} />
                  </TouchableOpacity>
                )}

                <View style={styles.conditionCard}>
                  {conditions.length > 1 && (
                    <View style={styles.conditionHeader}>
                      <Text style={styles.conditionNum}>Condition {idx + 1}</Text>
                      <TouchableOpacity onPress={() => removeCondition(idx)} hitSlop={8}>
                        <Text style={styles.removeCondBtn}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Text style={styles.sheetLabel}>By description</Text>
                  <View style={styles.tabs}>
                    {TEXT_MATCH_TYPES.map(m => (
                      <TouchableOpacity
                        key={m.value}
                        style={[styles.tab, cond.match_type === m.value && styles.tabActive]}
                        onPress={() => changeConditionType(idx, m.value)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.tabText, cond.match_type === m.value && styles.tabTextActive]}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.sheetLabel}>By amount</Text>
                  <View style={[styles.tabs, { marginBottom: spacing.md }]}>
                    {AMOUNT_MATCH_TYPES.map(m => (
                      <TouchableOpacity
                        key={m.value}
                        style={[styles.tab, styles.tabAmount, cond.match_type === m.value && styles.tabActive]}
                        onPress={() => changeConditionType(idx, m.value)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.tabText, cond.match_type === m.value && styles.tabTextActive]}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {isAmountType(cond.match_type) ? (
                    <>
                      <Text style={styles.sheetLabel}>Amount ($)</Text>
                      <TextInput
                        style={styles.sheetInput}
                        value={cond.match_text}
                        onChangeText={t => updateCondition(idx, { match_text: t })}
                        placeholder="e.g. 50.00"
                        placeholderTextColor={colors.textTertiary}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.sheetLabel}>Text to match (case-insensitive)</Text>
                      <TextInput
                        style={styles.sheetInput}
                        value={cond.match_text}
                        onChangeText={t => updateCondition(idx, { match_text: t })}
                        placeholder="e.g. whole foods"
                        placeholderTextColor={colors.textTertiary}
                      />
                    </>
                  )}
                </View>
              </React.Fragment>
            ))}

            <TouchableOpacity style={styles.addCondBtn} onPress={addCondition} activeOpacity={0.7}>
              <Text style={styles.addCondBtnText}>+ Add Condition</Text>
            </TouchableOpacity>

            {/* ── Inline category picker ── */}
            <Text style={styles.sheetLabel}>Assign category</Text>

            <View style={styles.catDropdown}>
              {/* Header row — always visible, tap to open/close list */}
              <TouchableOpacity
                style={styles.catDropdownHeader}
                onPress={() => setCatView(catView === 'list' ? 'collapsed' : 'list')}
                activeOpacity={0.7}
              >
                {selectedCat
                  ? <View style={[styles.catRowDot, { backgroundColor: selectedCat.color }]} />
                  : <View style={styles.catRowDotEmpty} />
                }
                <Text style={[styles.catRowLabel, !selectedCat && { color: colors.textTertiary }]}>
                  {selectedCat?.name ?? 'Select category…'}
                </Text>
                <Text style={styles.catChevron}>{catView === 'list' ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* Expanded list */}
              {catView === 'list' && (
                <>
                  {categories.map((item, index) => {
                    const isSelected = item.id === categoryId;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.catDropdownRow, styles.catRowBorder, isSelected && styles.catRowSelected]}
                        onPress={() => selectCategory(item.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.catRowDot, { backgroundColor: item.color }]} />
                        <Text style={styles.catRowLabel}>{item.name}</Text>
                        {isSelected && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                  {categories.length === 0 && (
                    <View style={[styles.catEmptyWrap, styles.catRowBorder]}>
                      <Text style={styles.catEmptyText}>No categories yet — create one below.</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[styles.catDropdownRow, styles.catRowBorder]}
                    onPress={openCreateForm}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.newCatListBtn}>+ New Category</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Create new category inline */}
              {catView === 'create' && (
                <>
                  <TouchableOpacity
                    style={[styles.catDropdownRow, styles.catRowBorder]}
                    onPress={() => setCatView('list')}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.backBtn}>← Back to list</Text>
                  </TouchableOpacity>
                  <View style={[styles.createForm, styles.catRowBorder]}>
                    <TextInput
                      style={styles.sheetInput}
                      value={newCatName}
                      onChangeText={setNewCatName}
                      placeholder="Category name"
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="done"
                      onSubmitEditing={handleQuickCreateCat}
                    />
                    <View style={styles.colorGrid}>
                      {CATEGORY_COLORS.map(c => (
                        <TouchableOpacity
                          key={c.hex}
                          style={[styles.colorSwatch, { backgroundColor: c.hex }, newCatColor === c.hex && styles.colorSwatchSelected]}
                          onPress={() => setNewCatColor(c.hex)}
                          activeOpacity={0.8}
                        >
                          {newCatColor === c.hex && <Text style={styles.colorCheck}>✓</Text>}
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity
                      style={[styles.createSaveBtn, (!newCatName.trim() || creatingCat) && styles.saveBtnDisabled]}
                      onPress={handleQuickCreateCat}
                      disabled={!newCatName.trim() || creatingCat}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.saveBtnText}>{creatingCat ? 'Saving…' : 'Create & Select'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {/* Save rule button — hide only while in create sub-form */}
            {catView !== 'create' && (
              <TouchableOpacity
                style={[styles.saveBtn, (!categoryId || saving || conditions.some(c => !c.match_text.trim() || (isAmountType(c.match_type) && isNaN(parseFloat(c.match_text))))) && styles.saveBtnDisabled]}
                onPress={handleSaveRule}
                disabled={!categoryId || saving || conditions.some(c => !c.match_text.trim() || (isAmountType(c.match_type) && isNaN(parseFloat(c.match_text))))}
                activeOpacity={0.85}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'Saving…' : editingRuleId ? 'Save Changes' : 'Add Rule'}
                </Text>
              </TouchableOpacity>
            )}

          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  addBtn:    { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  listEmpty: { flex: 1 },

  settingRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    gap:               spacing.md,
  },
  settingInfo: { flex: 1 },
  settingLabel: {
    fontFamily: font.semiBold,
    fontSize:   15,
    color:      colors.text,
  },
  settingDesc: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textSecondary,
    marginTop:  2,
  },

  hint: {
    fontFamily: font.regular, fontSize: 13, color: colors.textTertiary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },

  ruleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  rowBorder:  { borderTopWidth: 1, borderTopColor: colors.separator },
  ruleInfo:   { flex: 1 },
  ruleLogicSep: { fontFamily: font.semiBold, fontSize: 11, color: colors.textTertiary, letterSpacing: 0.5, marginBottom: 2 },
  ruleMatchLine: { fontFamily: font.regular, fontSize: 15, color: colors.text, marginBottom: 2 },
  ruleMatchType: { fontFamily: font.semiBold, color: colors.textSecondary },
  ruleMatchText: { fontFamily: font.semiBold, color: colors.primary },
  ruleCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleCatDot:  { width: 10, height: 10, borderRadius: radius.full },
  ruleCatName: { fontFamily: font.regular, fontSize: 13, color: colors.textSecondary },

  ruleActions:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  arrow:         { fontSize: 18, color: colors.primary, fontFamily: font.bold },
  arrowDisabled: { color: colors.border },
  deleteBtn:     { fontSize: 16, color: colors.destructive, fontFamily: font.bold },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text },
  emptyBody:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    maxHeight: '95%', paddingBottom: spacing.lg,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  sheetTitle:  { fontFamily: font.bold, fontSize: 17, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  sheetLabel:  { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },
  sheetScroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },

  sheetInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontFamily: font.regular, fontSize: 16, color: colors.text,
    marginBottom: spacing.md,
  },

  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  tab: {
    paddingVertical: 7, paddingHorizontal: spacing.md,
    borderRadius: radius.full, backgroundColor: colors.surfaceAlt,
  },
  tabAmount:     { minWidth: 52, alignItems: 'center' },
  tabActive:     { backgroundColor: colors.primary },
  tabText:       { fontFamily: font.semiBold, fontSize: 14, color: colors.textSecondary },
  tabTextActive: { color: colors.textOnColor },

  // Multi-condition form
  conditionCard: {
    backgroundColor: colors.surface,
    borderRadius:    radius.md,
    borderWidth:     1,
    borderColor:     colors.border,
    padding:         spacing.md,
    marginBottom:    spacing.sm,
  },
  conditionHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   spacing.sm,
  },
  conditionNum:   { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, letterSpacing: 0.3 },
  removeCondBtn:  { fontFamily: font.semiBold, fontSize: 13, color: colors.destructive },
  logicSep: {
    flexDirection: 'row',
    alignItems:    'center',
    marginVertical: spacing.xs,
    gap:           spacing.sm,
  },
  logicLine:  { flex: 1, height: 1, backgroundColor: colors.separator },
  logicLabel: {
    fontFamily:      font.bold,
    fontSize:        12,
    color:           colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical:   3,
    borderRadius:    radius.sm,
    backgroundColor: colors.primaryLight,
    letterSpacing:   0.5,
  },
  addCondBtn:     { paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.md },
  addCondBtnText: { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },

  // Inline dropdown container
  catDropdown: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  catDropdownHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  catDropdownRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  catChevron:      { fontSize: 10, color: colors.textTertiary },
  catRowDotEmpty:  { width: 12, height: 12, borderRadius: radius.full, marginRight: spacing.sm, backgroundColor: colors.border },
  catRowBorder:   { borderTopWidth: 1, borderTopColor: colors.separator },
  catRowSelected: { backgroundColor: colors.primaryLight },
  catRowDot:      { width: 12, height: 12, borderRadius: radius.full, marginRight: spacing.sm },
  catRowLabel:    { fontFamily: font.semiBold, fontSize: 15, color: colors.text, flex: 1 },
  checkmark:      { fontFamily: font.bold, fontSize: 15, color: colors.primary },
  newCatListBtn:  { fontFamily: font.semiBold, fontSize: 15, color: colors.primary, flex: 1 },
  catEmptyWrap:   { padding: spacing.lg, alignItems: 'center' },
  catEmptyText:   { fontFamily: font.regular, fontSize: 14, color: colors.textTertiary },

  // Inline create form
  createBackRow: { paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.separator },
  backBtn:       { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  createForm:    { padding: spacing.md },
  colorGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  colorSwatch: {
    width: 36, height: 36, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.text },
  colorCheck:          { fontSize: 14, color: '#fff', fontFamily: font.bold },
  createSaveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 12, alignItems: 'center',
  },

  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 16, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText:     { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Modal, TextInput, StyleSheet, SafeAreaView,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Rule, Category, MatchType,
  getRulesForAccount, getAllCategories,
  insertRule, updateRule, deleteRule, reorderRules, insertCategory,
} from '../../../src/db/queries';
import { autoApplyRulesForAccount } from '../../../src/domain/rules-engine';
import { CATEGORY_COLORS } from '../../../src/domain/category-colors';
import { Sloth } from '../../../src/components/Sloth';
import { colors, font, spacing, radius } from '../../../src/theme';
import * as Crypto from 'expo-crypto';

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: 'contains',    label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with',   label: 'Ends with' },
  { value: 'equals',      label: 'Equals' },
];

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
  const [rules,         setRules]         = useState<RuleWithCategory[]>([]);
  const [categories,    setCategories]    = useState<Category[]>([]);
  const [loading,       setLoading]       = useState(true);

  // Rule form sheet
  const [sheetOpen,     setSheetOpen]     = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [matchType,     setMatchType]     = useState<MatchType>('contains');
  const [matchText,     setMatchText]     = useState('');
  const [categoryId,    setCategoryId]    = useState('');
  const [saving,        setSaving]        = useState(false);

  // Tracks whether we've already consumed the prefill params (so it only fires once)
  const prefillApplied = useRef(false);
  // True when the sheet was opened via the "Create Rule?" prefill flow
  const fromPrefill = useRef(false);

  // Inline category picker (inside the sheet ScrollView — no second modal)
  const [catView,     setCatView]     = useState<CatView>('collapsed');
  const [newCatName,  setNewCatName]  = useState('');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0].hex);
  const [creatingCat, setCreatingCat] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [rawRules, cats] = await Promise.all([
        getRulesForAccount(id),
        getAllCategories(),
      ]);
      if (!active) return;
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
    setMatchType('contains');
    setMatchText(prefillText);
    if (prefillCategory) {
      setCategoryId(prefillCategory);
    } else if (categories.length > 0) {
      setCategoryId(categories[0].id);
    }
    setCatView('collapsed');
    setSheetOpen(true);
  }, [loading, prefillText, prefillCategory]);

  function openAddSheet() {
    setEditingRuleId(null);
    setMatchType('contains');
    setMatchText('');
    if (categories.length > 0) setCategoryId(categories[0].id);
    setCatView('collapsed');
    setSheetOpen(true);
  }

  function openEditSheet(rule: RuleWithCategory) {
    setEditingRuleId(rule.id);
    setMatchType(rule.match_type);
    setMatchText(rule.match_text);
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

  async function handleSaveRule() {
    const text = matchText.trim();
    if (!text || !categoryId) return;
    setSaving(true);
    try {
      if (editingRuleId) {
        await updateRule(editingRuleId, { match_type: matchType, match_text: text, category_id: categoryId });
        await reloadRules();
        closeSheet();
      } else {
        const maxPriority = rules.length > 0 ? Math.max(...rules.map(r => r.priority)) : 0;
        await insertRule({
          id: Crypto.randomUUID(),
          account_id: id,
          category_id: categoryId,
          match_type: matchType,
          match_text: text,
          priority: maxPriority + 1,
        });
        await reloadRules();
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
        <FlatList
          data={rules}
          keyExtractor={r => r.id}
          contentContainerStyle={rules.length === 0 && styles.listEmpty}
          ListHeaderComponent={rules.length > 0 ? (
            <Text style={styles.hint}>Rules run top-to-bottom on import. First match wins. Tap a rule to edit it.</Text>
          ) : null}
          renderItem={({ item, index }) => (
            <View style={[styles.ruleRow, index > 0 && styles.rowBorder]}>
              <TouchableOpacity style={styles.ruleInfo} onPress={() => openEditSheet(item)} activeOpacity={0.6}>
                <Text style={styles.ruleMatchLine}>
                  <Text style={styles.ruleMatchType}>{MATCH_TYPES.find(m => m.value === item.match_type)?.label ?? item.match_type}</Text>
                  {' "'}
                  <Text style={styles.ruleMatchText}>{item.match_text}</Text>
                  {'"'}
                </Text>
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
              <Sloth sloth="meditating" size={120} />
              <Text style={styles.emptyTitle}>No rules yet</Text>
              <Text style={styles.emptyBody}>
                Tap "Add" to create a rule. I'll use it to automatically categorize transactions when you import.
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

            {/* Match type */}
            <Text style={styles.sheetLabel}>Match type</Text>
            <View style={styles.tabs}>
              {MATCH_TYPES.map(m => (
                <TouchableOpacity
                  key={m.value}
                  style={[styles.tab, matchType === m.value && styles.tabActive]}
                  onPress={() => setMatchType(m.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.tabText, matchType === m.value && styles.tabTextActive]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Match text */}
            <Text style={styles.sheetLabel}>Text to match (case-insensitive)</Text>
            <TextInput
              style={styles.sheetInput}
              value={matchText}
              onChangeText={setMatchText}
              placeholder="e.g. whole foods"
              placeholderTextColor={colors.textTertiary}
            />

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
                style={[styles.saveBtn, (!matchText.trim() || !categoryId || saving) && styles.saveBtnDisabled]}
                onPress={handleSaveRule}
                disabled={!matchText.trim() || !categoryId || saving}
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
  ruleMatchLine: { fontFamily: font.regular, fontSize: 15, color: colors.text, marginBottom: 4 },
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

  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  tab: {
    paddingVertical: 7, paddingHorizontal: spacing.md,
    borderRadius: radius.full, backgroundColor: colors.surfaceAlt,
  },
  tabActive:     { backgroundColor: colors.primary },
  tabText:       { fontFamily: font.semiBold, fontSize: 14, color: colors.textSecondary },
  tabTextActive: { color: colors.textOnColor },

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

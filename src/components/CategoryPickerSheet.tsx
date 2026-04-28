import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Modal, StyleSheet, SafeAreaView, TextInput, ScrollView,
} from 'react-native';
import { Category, insertCategory } from '../db/queries';
import { CATEGORY_COLORS } from '../domain/category-colors';
import { colors, font, spacing, radius } from '../theme';
import * as Crypto from 'expo-crypto';

interface Props {
  visible:            boolean;
  categories:         Category[];
  currentCategoryId:  string | null;
  onSelect:           (categoryId: string | null) => void;
  onClose:            () => void;
  onCategoryCreated?: (category: Category) => void;
}

export function CategoryPickerSheet({
  visible, categories, currentCategoryId, onSelect, onClose, onCategoryCreated,
}: Props) {
  const [phase,      setPhase]      = useState<'list' | 'create'>('list');
  const [newName,    setNewName]    = useState('');
  const [newColor,   setNewColor]   = useState<string>(CATEGORY_COLORS[0].hex);
  const [creating,   setCreating]   = useState(false);
  const [searchText, setSearchText] = useState('');

  // Reset form and search whenever modal closes or re-opens
  useEffect(() => {
    if (!visible) {
      setPhase('list');
      setNewName('');
      setNewColor(CATEGORY_COLORS[0].hex);
      setSearchText('');
    }
  }, [visible]);

  const filteredCategories = searchText.trim()
    ? categories.filter(c => c.name.toLowerCase().includes(searchText.trim().toLowerCase()))
    : categories;

  async function handleQuickCreate() {
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const id = Crypto.randomUUID();
      await insertCategory({ id, name: trimmed, color: newColor, emoji: null, description: null });
      const newCat: Category = { id, name: trimmed, color: newColor, emoji: null, description: null, created_at: Date.now() };
      onCategoryCreated?.(newCat);
      onSelect(id); // auto-select the new category and close
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHandle} />

        {phase === 'list' ? (
          <>
            <Text style={styles.title}>Assign Category</Text>
            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search categories…"
                placeholderTextColor={colors.textTertiary}
                value={searchText}
                onChangeText={setSearchText}
                clearButtonMode="while-editing"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            <FlatList
              data={filteredCategories}
              keyExtractor={c => c.id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <TouchableOpacity
                  style={[styles.row, currentCategoryId === null && styles.rowSelected]}
                  onPress={() => onSelect(null)}
                  activeOpacity={0.7}
                >
                  <View style={styles.noColorDot} />
                  <Text style={styles.rowLabel}>None (clear category)</Text>
                  {currentCategoryId === null && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              }
              renderItem={({ item, index }) => {
                const isSelected = item.id === currentCategoryId;
                return (
                  <TouchableOpacity
                    style={[styles.row, styles.rowBorder, isSelected && styles.rowSelected]}
                    onPress={() => onSelect(item.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.swatch, { backgroundColor: item.color }]} />
                    <Text style={styles.rowLabel}>{item.name}</Text>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>
                    {searchText.trim() ? 'No matching categories.' : 'No categories yet.'}
                  </Text>
                </View>
              }
              ListFooterComponent={
                <TouchableOpacity
                  style={[styles.row, styles.rowBorder]}
                  onPress={() => setPhase('create')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.newCatBtn}>+ New Category</Text>
                </TouchableOpacity>
              }
            />
          </>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.createContent}>
            <View style={styles.createHeader}>
              <TouchableOpacity onPress={() => setPhase('list')} hitSlop={12}>
                <Text style={styles.backBtn}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.title}>New Category</Text>
              <View style={styles.headerSpacer} />
            </View>

            <Text style={styles.createLabel}>Name</Text>
            <TextInput
              style={styles.createInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Groceries"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleQuickCreate}
            />

            <Text style={[styles.createLabel, { marginTop: spacing.md }]}>Color</Text>
            <View style={styles.colorGrid}>
              {CATEGORY_COLORS.map(c => (
                <TouchableOpacity
                  key={c.hex}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: c.hex },
                    newColor === c.hex && styles.colorSwatchSelected,
                  ]}
                  onPress={() => setNewColor(c.hex)}
                  activeOpacity={0.8}
                >
                  {newColor === c.hex && <Text style={styles.colorCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, (!newName.trim() || creating) && styles.saveBtnDisabled]}
              onPress={handleQuickCreate}
              disabled={!newName.trim() || creating}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>{creating ? 'Saving…' : 'Save & Select'}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor:      colors.background,
    borderTopLeftRadius:  radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight:            '65%',
    paddingBottom:        spacing.lg,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  title: {
    fontFamily: font.bold, fontSize: 17, color: colors.text,
    textAlign: 'center', marginBottom: spacing.sm,
  },

  searchBar: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  spacing.md,
    marginBottom:      spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical:   6,
    backgroundColor:   colors.surface,
    borderRadius:      radius.md,
    borderWidth:       1,
    borderColor:       colors.border,
    gap:               spacing.xs,
  },
  searchIcon: {
    fontSize:  19,
    color:     colors.textTertiary,
    marginTop: 1,
  },
  searchInput: {
    flex:            1,
    fontFamily:      font.regular,
    fontSize:        15,
    color:           colors.text,
    paddingVertical: 2,
  },

  // List phase
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  rowBorder:   { borderTopWidth: 1, borderTopColor: colors.separator },
  rowSelected: { backgroundColor: colors.primaryLight },
  rowLabel:    { fontFamily: font.semiBold, fontSize: 15, color: colors.text, flex: 1 },
  swatch:      { width: 14, height: 14, borderRadius: radius.full, marginRight: spacing.md },
  noColorDot:  { width: 14, height: 14, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, marginRight: spacing.md },
  checkmark:   { fontFamily: font.bold, fontSize: 15, color: colors.primary },
  newCatBtn:   { fontFamily: font.semiBold, fontSize: 15, color: colors.primary, flex: 1 },
  emptyWrap:   { padding: spacing.lg, alignItems: 'center' },
  emptyText:   { fontFamily: font.regular, fontSize: 14, color: colors.textTertiary },

  // Create phase
  createContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  createHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  backBtn:       { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  headerSpacer:  { width: 48 },
  createLabel:   { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },
  createInput: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontFamily: font.regular, fontSize: 16, color: colors.text,
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  colorSwatch: {
    width: 40, height: 40, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.text },
  colorCheck:          { fontSize: 16, color: '#fff', fontFamily: font.bold },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 15, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText:     { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
});

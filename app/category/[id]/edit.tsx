import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert, Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { getAllCategories, updateCategory, deleteCategory } from '../../../src/db/queries';
import { CATEGORY_COLORS } from '../../../src/domain/category-colors';
import { CATEGORY_EMOJIS } from '../new';
import { friendlyError } from '../../../src/domain/errors';
import { colors, font, spacing, radius } from '../../../src/theme';

export default function EditCategoryScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const [name,          setName]          = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(CATEGORY_COLORS[0].hex);
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const [description,       setDescription]       = useState('');
  const [excludeFromTotals, setExcludeFromTotals] = useState(false);
  const [saving,            setSaving]            = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cats = await getAllCategories();
        const cat  = cats.find(c => c.id === id);
        if (cat) {
          setName(cat.name);
          setSelectedColor(cat.color);
          setSelectedEmoji(cat.emoji ?? null);
          setDescription(cat.description ?? '');
          setExcludeFromTotals(!!cat.exclude_from_totals);
        }
      } catch (e) {
        Alert.alert('Error', friendlyError(e));
      }
    })();
  }, [id]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await updateCategory(id, {
        name:                trimmed,
        color:               selectedColor,
        emoji:               selectedEmoji,
        description:         description.trim() || null,
        exclude_from_totals: excludeFromTotals ? 1 : 0,
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
      setSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert(
      'Delete Category',
      'This will remove this category from all transactions. Rules for this category will also be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(id);
              router.back();
            } catch (e) {
              Alert.alert('Could not delete', friendlyError(e));
            }
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Edit Category',
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete} hitSlop={12}>
              <Text style={styles.deleteBtn}>Delete</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSave}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Emoji (optional)</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.emojiScroll}
          contentContainerStyle={styles.emojiRow}
        >
          <TouchableOpacity
            style={[styles.emojiChip, selectedEmoji === null && styles.emojiChipSelected]}
            onPress={() => setSelectedEmoji(null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.emojiChipText, selectedEmoji === null && styles.emojiChipTextSelected]}>None</Text>
          </TouchableOpacity>
          {CATEGORY_EMOJIS.map(e => (
            <TouchableOpacity
              key={e}
              style={[styles.emojiChip, selectedEmoji === e && styles.emojiChipSelected]}
              onPress={() => setSelectedEmoji(e)}
              activeOpacity={0.7}
            >
              <Text style={styles.emojiGlyph}>{e}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Description (optional)</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="e.g. Restaurants, takeout, coffee"
          placeholderTextColor={colors.textTertiary}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={2}
        />

        <View style={[styles.toggleRow, { marginTop: spacing.lg }]}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Exclude from income &amp; expense totals</Text>
            <Text style={styles.toggleSubtitle}>Use for transfers, investments, etc.</Text>
          </View>
          <Switch
            value={excludeFromTotals}
            onValueChange={setExcludeFromTotals}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Color</Text>
        <View style={styles.colorGrid}>
          {CATEGORY_COLORS.map(c => (
            <TouchableOpacity
              key={c.hex}
              style={[
                styles.colorSwatch,
                { backgroundColor: c.hex },
                selectedColor === c.hex && styles.colorSwatchSelected,
              ]}
              onPress={() => setSelectedColor(c.hex)}
              activeOpacity={0.8}
            >
              {selectedColor === c.hex && <Text style={styles.colorCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, (!name.trim() || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!name.trim() || saving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.mergeBtn}
          onPress={() => router.push(`/category/${id}/merge`)}
          activeOpacity={0.85}
        >
          <Text style={styles.mergeBtnText}>Merge into another category →</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, paddingBottom: spacing.xl },
  deleteBtn: { fontFamily: font.semiBold, fontSize: 15, color: colors.destructive, marginRight: 4 },
  label:     { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontFamily: font.regular, fontSize: 16, color: colors.text,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },

  emojiScroll: { marginBottom: spacing.sm },
  emojiRow:    { flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.xs },
  emojiChip: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 44,
  },
  emojiChipSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  emojiChipText:         { fontFamily: font.semiBold, fontSize: 12, color: colors.textSecondary },
  emojiChipTextSelected: { color: colors.primary },
  emojiGlyph:            { fontSize: 20 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  toggleText:     { flex: 1 },
  toggleTitle:    { fontFamily: font.semiBold, fontSize: 14, color: colors.text },
  toggleSubtitle: { fontFamily: font.regular,  fontSize: 12, color: colors.textTertiary, marginTop: 2 },

  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  colorSwatch: {
    width: 44, height: 44, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.text },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: font.bold },

  saveBtn: {
    marginTop: spacing.xl, backgroundColor: colors.primary,
    borderRadius: radius.full, paddingVertical: 16, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },

  mergeBtn: {
    marginTop: spacing.md,
    borderRadius: radius.full,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mergeBtnText: {
    fontFamily: font.semiBold,
    fontSize: 15,
    color: colors.textSecondary,
  },
});

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert, Switch,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { insertCategory } from '../../src/db/queries';
import { CATEGORY_COLORS } from '../../src/domain/category-colors';
import { CATEGORY_EMOJIS } from '../../src/domain/category-emojis';
import { colors, font, spacing, radius } from '../../src/theme';
import * as Crypto from 'expo-crypto';

// Re-export so existing imports from this file keep working
export { CATEGORY_EMOJIS };

export default function NewCategoryScreen() {
  const router = useRouter();
  const [name,           setName]           = useState('');
  const [selectedColor,  setSelectedColor]  = useState<string>(CATEGORY_COLORS[0].hex);
  const [selectedEmoji,  setSelectedEmoji]  = useState<string | null>(null);
  const [description,       setDescription]       = useState('');
  const [excludeFromTotals, setExcludeFromTotals] = useState(false);
  const [saving,            setSaving]            = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await insertCategory({
        id:                 Crypto.randomUUID(),
        name:               trimmed,
        color:              selectedColor,
        emoji:              selectedEmoji,
        description:        description.trim() || null,
        exclude_from_totals: excludeFromTotals ? 1 : 0,
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save category.');
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'New Category' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Groceries"
          placeholderTextColor={colors.textTertiary}
          value={name}
          onChangeText={setName}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Emoji (optional)</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.emojiScroll}
          contentContainerStyle={styles.emojiRow}
        >
          {/* "None" chip */}
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
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Category'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, paddingBottom: spacing.xl },

  label: { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontFamily: font.regular, fontSize: 16, color: colors.text,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },

  // Emoji picker
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
});

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { insertCategory } from '../../src/db/queries';
import { CATEGORY_COLORS } from '../../src/domain/category-colors';
import { colors, font, spacing, radius } from '../../src/theme';
import * as Crypto from 'expo-crypto';

export default function NewCategoryScreen() {
  const router = useRouter();
  const [name,          setName]          = useState('');
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0].hex);
  const [saving,        setSaving]        = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await insertCategory({ id: Crypto.randomUUID(), name: trimmed, color: selectedColor });
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
  content:   { padding: spacing.md },

  label: { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontFamily: font.regular, fontSize: 16, color: colors.text,
  },

  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  colorSwatch: {
    width: 44, height: 44, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: {
    borderWidth: 3, borderColor: colors.text,
  },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: font.bold },

  saveBtn: {
    marginTop: spacing.xl, backgroundColor: colors.primary,
    borderRadius: radius.full, paddingVertical: 16, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
});

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { getAllCategories, updateCategory, deleteCategory } from '../../../src/db/queries';
import { CATEGORY_COLORS } from '../../../src/domain/category-colors';
import { colors, font, spacing, radius } from '../../../src/theme';

export default function EditCategoryScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const [name,          setName]          = useState('');
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0].hex);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    (async () => {
      const cats = await getAllCategories();
      const cat  = cats.find(c => c.id === id);
      if (cat) { setName(cat.name); setSelectedColor(cat.color); }
    })();
  }, [id]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await updateCategory(id, { name: trimmed, color: selectedColor });
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
            await deleteCategory(id);
            router.back();
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
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md },
  deleteBtn: { fontFamily: font.semiBold, fontSize: 15, color: colors.destructive, marginRight: 4 },
  label:     { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },

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
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.text },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: font.bold },

  saveBtn: {
    marginTop: spacing.xl, backgroundColor: colors.primary,
    borderRadius: radius.full, paddingVertical: 16, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
});

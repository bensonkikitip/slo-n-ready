import React from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Modal, StyleSheet, SafeAreaView,
} from 'react-native';
import { Category } from '../db/queries';
import { colors, font, spacing, radius } from '../theme';

interface Props {
  visible:           boolean;
  categories:        Category[];
  currentCategoryId: string | null;
  onSelect:          (categoryId: string | null) => void;
  onClose:           () => void;
}

export function CategoryPickerSheet({
  visible, categories, currentCategoryId, onSelect, onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.title}>Assign Category</Text>

        <FlatList
          data={categories}
          keyExtractor={c => c.id}
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
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No categories yet — create one first.</Text>
            </View>
          }
        />
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
    maxHeight:            '60%',
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

  empty:     { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontFamily: font.regular, fontSize: 14, color: colors.textTertiary },
});

import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { colors, font, spacing, radius } from '../theme';

interface CategoryOption {
  id:    string;
  name:  string;
  color: string;
}

interface Props {
  categories: CategoryOption[];
  selected:   string | null;
  onSelect:   (id: string | null) => void;
}

export function CategoryFilterBar({ categories, selected, onSelect }: Props) {
  if (categories.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <TouchableOpacity
          style={[styles.pill, selected === null && styles.pillActive]}
          onPress={() => onSelect(null)}
          activeOpacity={0.7}
        >
          <Text style={[styles.pillText, selected === null && styles.pillTextActive]}>All</Text>
        </TouchableOpacity>

        {categories.map(c => {
          const isActive = selected === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.pill,
                { borderColor: c.color },
                isActive && { backgroundColor: c.color },
              ]}
              onPress={() => onSelect(isActive ? null : c.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.dot, { backgroundColor: c.color }, isActive && styles.dotActive]} />
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  scroll: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  dotActive: {
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  pillText: {
    fontFamily: font.semiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.textOnColor,
  },
});

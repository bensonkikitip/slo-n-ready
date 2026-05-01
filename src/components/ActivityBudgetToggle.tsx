import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  value:    'activity' | 'budget';
  onChange: (v: 'activity' | 'budget') => void;
}

export function ActivityBudgetToggle({ value, onChange }: Props) {
  return (
    <View style={styles.tabs}>
      <TouchableOpacity
        style={[styles.tab, value === 'activity' && styles.tabActive]}
        onPress={() => onChange('activity')}
        activeOpacity={0.7}
      >
        <Text style={[styles.tabText, value === 'activity' && styles.tabTextActive]}>Activity</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, value === 'budget' && styles.tabActive]}
        onPress={() => onChange('budget')}
        activeOpacity={0.7}
      >
        <Text style={[styles.tabText, value === 'budget' && styles.tabTextActive]}>Goals</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection:  'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius:   radius.md,
    padding:        3,
  },
  tab: {
    paddingVertical:   7,
    paddingHorizontal: spacing.sm,
    alignItems:        'center',
    borderRadius:      radius.sm,
  },
  tabActive:     { backgroundColor: colors.surface },
  tabText:       { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary },
  tabTextActive: { color: colors.primary },
});

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList,
  StyleSheet, SafeAreaView,
} from 'react-native';
import { MonthEntry, YearEntry } from '../domain/month';
import { colors, font, spacing, radius } from '../theme';

export type FilterMode = 'month' | 'year';

interface MonthPickerProps {
  months:        MonthEntry[];
  years:         YearEntry[];
  filterMode:    FilterMode;
  selectedMonth: string;
  selectedYear:  string;
  onChangeMonth: (month: string) => void;
  onChangeYear:  (year: string) => void;
}

const RECENT_COUNT = 6;

export function MonthPicker({
  months, years,
  filterMode, selectedMonth, selectedYear,
  onChangeMonth, onChangeYear,
}: MonthPickerProps) {
  const [open,      setOpen]      = useState(false);
  const [activeTab, setActiveTab] = useState<FilterMode>(filterMode);
  const [expanded,  setExpanded]  = useState(false);

  // Pill label reflects the active filter
  const pillLabel = filterMode === 'year'
    ? (years.find(y => y.key === selectedYear)?.label ?? '—')
    : (months.find(m => m.key === selectedMonth)?.label ?? '—');

  function handleOpen() {
    setActiveTab(filterMode); // sync tab to current filter on open
    setExpanded(false);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setExpanded(false);
  }

  function handleSelectMonth(key: string) {
    onChangeMonth(key);
    handleClose();
  }

  function handleSelectYear(key: string) {
    onChangeYear(key);
    handleClose();
  }

  // Month tab content
  const recentMonths   = months.slice(0, RECENT_COUNT);
  const allWithData    = months.filter(m => m.count > 0);
  const visibleMonths  = expanded ? allWithData : recentMonths;

  return (
    <>
      {/* Pill button */}
      <TouchableOpacity style={styles.pill} onPress={handleOpen} activeOpacity={0.75}>
        <Text style={styles.pillText}>{pillLabel}</Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      {/* Modal */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Select Dates</Text>

          {/* Tab switcher */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'month' && styles.tabActive]}
              onPress={() => { setActiveTab('month'); setExpanded(false); }}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === 'month' && styles.tabTextActive]}>
                By Month
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'year' && styles.tabActive]}
              onPress={() => setActiveTab('year')}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === 'year' && styles.tabTextActive]}>
                By Year
              </Text>
            </TouchableOpacity>
          </View>

          {/* Month list */}
          {activeTab === 'month' && (
            <FlatList
              data={visibleMonths}
              keyExtractor={m => m.key}
              renderItem={({ item, index }) => {
                const isEmpty    = item.count === 0;
                const isSelected = item.key === selectedMonth && filterMode === 'month';
                return (
                  <TouchableOpacity
                    style={[
                      styles.row,
                      index > 0 && styles.rowBorder,
                      isSelected && styles.rowSelected,
                    ]}
                    onPress={() => handleSelectMonth(item.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.rowLabel, isEmpty && styles.rowLabelEmpty]}>
                      {item.label}
                    </Text>
                    <Text style={[
                      styles.rowCount,
                      isEmpty ? styles.rowCountEmpty : styles.rowCountFilled,
                    ]}>
                      {isEmpty ? '(0)' : String(item.count)}
                    </Text>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
              ListFooterComponent={
                !expanded ? (
                  <TouchableOpacity
                    style={[styles.row, styles.rowBorder, styles.showAllRow]}
                    onPress={() => setExpanded(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.showAllText}>Show all months</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          )}

          {/* Year list */}
          {activeTab === 'year' && (
            <FlatList
              data={years}
              keyExtractor={y => y.key}
              ListEmptyComponent={
                <View style={styles.emptyYears}>
                  <Text style={styles.emptyYearsText}>No data yet — import a CSV first.</Text>
                </View>
              }
              renderItem={({ item, index }) => {
                const isSelected = item.key === selectedYear && filterMode === 'year';
                return (
                  <TouchableOpacity
                    style={[
                      styles.row,
                      index > 0 && styles.rowBorder,
                      isSelected && styles.rowSelected,
                    ]}
                    onPress={() => handleSelectYear(item.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <Text style={styles.rowCountFilled}>{String(item.count)}</Text>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   colors.surface,
    borderRadius:      radius.full,
    borderWidth:       1,
    borderColor:       colors.border,
    paddingVertical:   7,
    paddingHorizontal: spacing.md,
    gap:               spacing.xs,
    marginVertical:    spacing.sm,
  },
  pillText: { fontFamily: font.semiBold, fontSize: 15, color: colors.text },
  chevron:  { fontSize: 11, color: colors.textTertiary, marginTop: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor:      colors.background,
    borderTopLeftRadius:  radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight:            '65%',
    paddingBottom:        spacing.lg,
  },
  sheetHandle: {
    width:           40,
    height:          4,
    borderRadius:    radius.full,
    backgroundColor: colors.border,
    alignSelf:       'center',
    marginTop:       spacing.sm,
    marginBottom:    spacing.sm,
  },
  sheetTitle: {
    fontFamily:   font.bold,
    fontSize:     17,
    color:        colors.text,
    textAlign:    'center',
    marginBottom: spacing.sm,
  },

  // Tabs
  tabs: {
    flexDirection:     'row',
    marginHorizontal:  spacing.md,
    marginBottom:      spacing.sm,
    backgroundColor:   colors.surfaceAlt,
    borderRadius:      radius.md,
    padding:           3,
  },
  tab: {
    flex:            1,
    paddingVertical: 7,
    alignItems:      'center',
    borderRadius:    radius.sm,
  },
  tabActive: { backgroundColor: colors.surface },
  tabText:   { fontFamily: font.semiBold, fontSize: 14, color: colors.textSecondary },
  tabTextActive: { color: colors.primary },

  // Rows
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   14,
    backgroundColor:   colors.surface,
  },
  rowBorder:   { borderTopWidth: 1, borderTopColor: colors.separator },
  rowSelected: { backgroundColor: colors.primaryLight },

  rowLabel:      { fontFamily: font.semiBold, fontSize: 15, color: colors.text, flex: 1 },
  rowLabelEmpty: { color: colors.textTertiary },

  rowCount:       { fontFamily: font.bold, fontSize: 14, marginRight: spacing.sm },
  rowCountFilled: { color: colors.primary, fontFamily: font.bold, fontSize: 14, marginRight: spacing.sm },
  rowCountEmpty:  { color: colors.textTertiary },

  checkmark: { fontFamily: font.bold, fontSize: 15, color: colors.primary },

  showAllRow:  { justifyContent: 'center' },
  showAllText: { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },

  emptyYears:     { padding: spacing.xl, alignItems: 'center' },
  emptyYearsText: { fontFamily: font.regular, fontSize: 14, color: colors.textTertiary },
});

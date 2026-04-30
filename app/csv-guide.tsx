/**
 * CSV download guide — how to export a CSV from your bank.
 * Accessible from account/new.tsx and account/[id]/import.tsx
 * via "How do I get this file?" link.
 *
 * Each bank is a collapsible accordion with numbered steps.
 * No screenshots yet — text-only steps for v4.0.
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView,
} from 'react-native';
import { Stack } from 'expo-router';
import { Sloth } from '../src/components/Sloth';
import { colors, font, spacing, radius } from '../src/theme';

interface BankStep {
  text: string;
}

interface BankGuide {
  name: string;
  icon: string;
  steps: BankStep[];
}

const BANKS: BankGuide[] = [
  {
    name: 'Chase',
    icon: '🏛️',
    steps: [
      { text: 'Log in to chase.com and go to your checking or credit card account.' },
      { text: 'Click the "Download" icon (arrow pointing down) near the top of the transaction list.' },
      { text: 'In the popup, choose date range "Custom" and set the start and end dates you want.' },
      { text: 'Under "File type," select "CSV" (not PDF or OFX).' },
      { text: 'Click "Download" — the file will appear in your iPhone\'s Downloads folder.' },
    ],
  },
  {
    name: 'Bank of America',
    icon: '🏦',
    steps: [
      { text: 'Log in to bankofamerica.com and open your account.' },
      { text: 'Click the "Download" link just above the transaction list on the right side.' },
      { text: 'Choose a date range (up to 18 months at a time).' },
      { text: 'Under "File format," choose "Microsoft Excel format (.csv)".' },
      { text: 'Click "Download transactions" — the file lands in Downloads.' },
    ],
  },
  {
    name: 'Wells Fargo',
    icon: '🐎',
    steps: [
      { text: 'Log in to wellsfargo.com and click on your account.' },
      { text: 'Click "Download Account Activity" below the account summary.' },
      { text: 'Choose a date range — you can go back up to 2 years.' },
      { text: 'Set the format to "Comma-Delimited File (.csv)".' },
      { text: 'Click "Download" to save the file to your Downloads folder.' },
    ],
  },
  {
    name: 'Citi',
    icon: '🌆',
    steps: [
      { text: 'Log in to citi.com and open your credit card account.' },
      { text: 'Go to "Account" → "Statements & Documents" → "Transactions."' },
      { text: 'Select the date range using the dropdown (up to 24 months back).' },
      { text: 'Click "Download" and choose "CSV — Spreadsheet" from the format list.' },
      { text: 'Confirm the download — the file goes to your Downloads folder.' },
    ],
  },
  {
    name: 'Capital One',
    icon: '💰',
    steps: [
      { text: 'Log in to capitalone.com and open your account.' },
      { text: 'Click on "View Transactions" to see the full list.' },
      { text: 'Click the "Download" button above the transaction list.' },
      { text: 'Choose your date range (up to 3 years for most accounts).' },
      { text: 'Select "CSV" as the file format and click "Download."' },
    ],
  },
  {
    name: 'American Express',
    icon: '💎',
    steps: [
      { text: 'Log in to americanexpress.com and go to your card account.' },
      { text: 'Click "Statements & Activity" in the navigation.' },
      { text: 'Scroll down to the transaction list and click "Download" (top right of the list).' },
      { text: 'Under "File type," choose "CSV" and set your date range.' },
      { text: 'Click "Download" — the file saves to your Downloads folder.' },
    ],
  },
];

const GENERIC: BankGuide = {
  name: 'My bank isn\'t listed',
  icon: '🔍',
  steps: [
    { text: 'Log in to your bank\'s website (not the app — desktop or mobile browser is easier).' },
    { text: 'Open the account you want to track.' },
    { text: 'Look for a button or link labeled "Download," "Export," "Statements," or "Transaction History."' },
    { text: 'Choose "CSV," "Comma-Separated Values," or "Excel." Avoid PDF, OFX, or QFX if you see CSV as an option.' },
    { text: 'Pick a date range — 3–6 months is a good start. Download the file.' },
    { text: 'If you can\'t find the option, search "[your bank name] export transactions CSV" — most banks have a help article.' },
  ],
};

const ALL_GUIDES = [...BANKS, GENERIC];

export default function CsvGuideScreen() {
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggle(name: string) {
    setExpanded(prev => prev === name ? null : name);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'How to export your CSV', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <Sloth sloth="dreaming" size={90} />
            <Text style={styles.heroText}>
              Take your time — I'll be right here when you get back.
            </Text>
            <Text style={styles.heroSub}>
              Pick your bank below for step-by-step instructions on downloading a CSV file.
            </Text>
          </View>

          {/* Bank accordions */}
          <View style={styles.card}>
            {ALL_GUIDES.map((bank, i) => {
              const open = expanded === bank.name;
              return (
                <View key={bank.name}>
                  <TouchableOpacity
                    style={[styles.bankRow, i > 0 && styles.bankRowBorder]}
                    onPress={() => toggle(bank.name)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.bankIcon}>{bank.icon}</Text>
                    <Text style={styles.bankName}>{bank.name}</Text>
                    <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {open && (
                    <View style={styles.stepsWrap}>
                      {bank.steps.map((step, si) => (
                        <View key={si} style={styles.stepRow}>
                          <View style={styles.stepNum}>
                            <Text style={styles.stepNumText}>{si + 1}</Text>
                          </View>
                          <Text style={styles.stepText}>{step.text}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Footer note */}
          <Text style={styles.footerNote}>
            Your CSV contains only transaction dates, amounts, and descriptions — no account numbers or card numbers. Slo N Ready never stores sensitive bank data.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  hero: {
    alignItems: 'center',
    gap:        spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  heroText: {
    fontFamily: font.bold,
    fontSize:   16,
    color:      colors.text,
    textAlign:  'center',
    lineHeight: 22,
  },
  heroSub: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textSecondary,
    textAlign:  'center',
    lineHeight: 18,
    paddingHorizontal: spacing.sm,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border,
    overflow:        'hidden',
  },

  bankRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   14,
    gap:            spacing.sm,
  },
  bankRowBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  bankIcon:      { fontSize: 20, width: 28, textAlign: 'center' },
  bankName:      { fontFamily: font.semiBold, fontSize: 15, color: colors.text, flex: 1 },
  chevron:       { fontSize: 10, color: colors.textTertiary },

  stepsWrap: {
    backgroundColor:  colors.surfaceAlt,
    borderTopWidth:   1,
    borderTopColor:   colors.separator,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    gap:              spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing.sm,
  },
  stepNum: {
    width:           24,
    height:          24,
    borderRadius:    12,
    backgroundColor: colors.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       1,
    flexShrink:      0,
  },
  stepNumText: {
    fontFamily: font.bold,
    fontSize:   12,
    color:      colors.primary,
  },
  stepText: {
    fontFamily: font.regular,
    fontSize:   14,
    color:      colors.text,
    lineHeight: 20,
    flex:       1,
  },

  footerNote: {
    fontFamily:  font.regular,
    fontSize:    12,
    color:       colors.textTertiary,
    textAlign:   'center',
    lineHeight:  17,
    paddingHorizontal: spacing.md,
  },
});

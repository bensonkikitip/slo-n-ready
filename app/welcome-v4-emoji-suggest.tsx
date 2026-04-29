/**
 * Emoji suggestion screen — accessed from the welcome-v4 sheet.
 * Shows existing categories alongside Rachey's emoji guesses.
 * User can accept, override, or skip each suggestion.
 * Saving applies the emoji updates in one pass.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { getAllCategories, updateCategory } from '../src/db/queries';
import { suggestEmojisForCategories } from '../src/domain/emoji-suggestions';
import { CATEGORY_EMOJIS } from '../src/domain/category-emojis';
import { colors, font, spacing, radius } from '../src/theme';
import { Sloth } from '../src/components/Sloth';

interface SuggestionRow {
  id:         string;
  name:       string;
  current:    string | null;  // emoji already in DB (may be null)
  suggestion: string | null;  // Rachey's guess
  selected:   string | null;  // what the user has chosen
  expanded:   boolean;        // emoji picker open
}

export default function WelcomeV4EmojiSuggestScreen() {
  const router = useRouter();
  const [rows,    setRows]    = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    (async () => {
      const cats = await getAllCategories();
      const suggestions = suggestEmojisForCategories(cats);
      setRows(suggestions.map(s => ({
        id:         s.id,
        name:       s.name,
        current:    cats.find(c => c.id === s.id)?.emoji ?? null,
        suggestion: s.suggestion,
        selected:   s.suggestion,  // default: accept the suggestion
        expanded:   false,
      })));
      setLoading(false);
    })();
  }, []);

  function toggle(id: string) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, expanded: !r.expanded } : { ...r, expanded: false },
    ));
  }

  function selectEmoji(id: string, emoji: string | null) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, selected: emoji, expanded: false } : r,
    ));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const changed = rows.filter(r => r.selected !== r.current);
      await Promise.all(changed.map(r => updateCategory(r.id, { emoji: r.selected })));
      router.back();
    } catch {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
        <SafeAreaView style={styles.container}>
          <View style={styles.center}>
            <Text style={styles.emptyText}>No categories yet — add some first!</Text>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
              <Text style={styles.ghostBtnText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Sloth sloth="dreaming" size={100} />
            <Text style={styles.headline}>Here's what I'd suggest for your categories.</Text>
            <Text style={styles.subline}>Tap any row to pick a different emoji, or remove it entirely.</Text>
          </View>

          <View style={styles.card}>
            {rows.map((row, i) => (
              <View key={row.id}>
                <TouchableOpacity
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  onPress={() => toggle(row.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.emojiPreview}>
                    {row.selected
                      ? <Text style={styles.emojiGlyph}>{row.selected}</Text>
                      : <Text style={styles.emojiNone}>—</Text>
                    }
                  </View>
                  <Text style={styles.rowName}>{row.name}</Text>
                  <Text style={styles.rowChevron}>{row.expanded ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {row.expanded && (
                  <View style={styles.pickerWrap}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.emojiRow}
                    >
                      {/* None option */}
                      <TouchableOpacity
                        style={[styles.chip, row.selected === null && styles.chipSelected]}
                        onPress={() => selectEmoji(row.id, null)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText, row.selected === null && styles.chipTextSelected]}>None</Text>
                      </TouchableOpacity>
                      {CATEGORY_EMOJIS.map(e => (
                        <TouchableOpacity
                          key={e}
                          style={[styles.chip, row.selected === e && styles.chipSelected]}
                          onPress={() => selectEmoji(row.id, e)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.chipEmoji}>{e}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, saving && styles.btnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              {saving ? 'Saving…' : 'Save emojis'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={styles.ghostBtnText}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content:   { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  headline: {
    fontFamily: font.bold, fontSize: 18, color: colors.text,
    textAlign: 'center', lineHeight: 26,
  },
  subline: {
    fontFamily: font.regular, fontSize: 13, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 18,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border,
    overflow:        'hidden',
    marginTop:       spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 14,
    gap: spacing.sm,
  },
  rowBorder:   { borderTopWidth: 1, borderTopColor: colors.separator },
  emojiPreview:{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  emojiGlyph:  { fontSize: 22 },
  emojiNone:   { fontSize: 16, color: colors.textTertiary },
  rowName:     { fontFamily: font.semiBold, fontSize: 15, color: colors.text, flex: 1 },
  rowChevron:  { fontSize: 10, color: colors.textTertiary },

  pickerWrap: {
    backgroundColor: colors.surfaceAlt,
    borderTopWidth: 1, borderTopColor: colors.separator,
    paddingVertical: spacing.sm,
  },
  emojiRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
  chip: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 44,
  },
  chipSelected:    { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:        { fontFamily: font.semiBold, fontSize: 12, color: colors.textSecondary },
  chipTextSelected:{ color: colors.primary },
  chipEmoji:       { fontSize: 20 },

  emptyText: {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', marginBottom: spacing.lg,
  },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 16, alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled:    { opacity: 0.4 },
  primaryBtnText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
  ghostBtn:       { paddingVertical: 14, alignItems: 'center' },
  ghostBtnText:   { fontFamily: font.semiBold, fontSize: 15, color: colors.textSecondary },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { radius, font } from '../theme';

interface Props {
  name:   string;
  color:  string;
  emoji?: string | null;
}

export function CategoryBadge({ name, color, emoji }: Props) {
  return (
    <View style={[styles.pill, { backgroundColor: color + '33' }]}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={[styles.text, { color }]}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius:      radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
  },
  emoji: { fontSize: 11 },
  text: {
    fontFamily: font.semiBold,
    fontSize:   11,
  },
});

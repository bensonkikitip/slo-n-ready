import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sloth } from './Sloth';
import { pickRacheyLine, RacheyMoment } from '../domain/rachey-quotes';
import { colors, font, spacing, radius } from '../theme';

interface Props {
  moment: RacheyMoment;
  onDismiss: () => void;
}

export function RacheyBanner({ moment, onDismiss }: Props) {
  // Lock the pose + line on mount so it doesn't re-randomize on re-render
  const [{ pose, line }] = useState(() => pickRacheyLine(moment));

  return (
    <View style={styles.banner}>
      <Sloth sloth={pose} size={52} />
      <Text style={styles.line}>{line}</Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={12} style={styles.dismissBtn}>
        <Text style={styles.dismiss}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   colors.primaryLight,
    borderRadius:      radius.lg,
    marginHorizontal:  spacing.md,
    marginTop:         spacing.md,
    paddingVertical:   spacing.sm,
    paddingLeft:       spacing.sm,
    paddingRight:      spacing.md,
    gap:               spacing.sm,
  },
  line: {
    flex:       1,
    fontFamily: font.regular,
    fontSize:   14,
    color:      colors.text,
    lineHeight: 20,
  },
  dismissBtn: {
    padding: 4,
  },
  dismiss: {
    fontSize:   22,
    color:      colors.textSecondary,
    lineHeight: 24,
  },
});

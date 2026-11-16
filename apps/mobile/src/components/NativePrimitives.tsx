import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { DESIGN_TOKENS } from '@bharat-makaan/config';

const palette = DESIGN_TOKENS.colors.light;

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function NativeCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function NativeButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg =
    variant === 'primary'
      ? palette.primary
      : variant === 'danger'
        ? palette.danger
        : palette.surface;
  const fg = variant === 'outline' ? palette.foreground : '#FFFFFF';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'outline' ? palette.border : bg,
          opacity: disabled || loading ? 0.55 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function NativeInput({
  label,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string }) {
  return (
    <View style={styles.inputGroup}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={palette.mutedForeground}
        style={styles.input}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function NativeStatusPill({ status }: { status: string }) {
  const inv =
    DESIGN_TOKENS.colors.inventoryStatus[
      status as keyof typeof DESIGN_TOKENS.colors.inventoryStatus
    ];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: inv?.bg ?? palette.surfaceMuted,
          borderColor: inv?.border ?? palette.border,
        },
      ]}
    >
      <Text style={[styles.pillText, { color: inv?.text ?? palette.foreground }]}>
        {status.replace(/_/g, ' ')}
      </Text>
    </View>
  );
}

export function NativeEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.emptyDesc}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: 12 }}>
          <NativeButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: palette.foreground,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: palette.mutedForeground,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    marginBottom: 10,
  },
  button: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.foreground,
    marginBottom: 4,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderColor: palette.input,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    fontSize: 13,
    color: palette.foreground,
  },
  errorText: {
    marginTop: 3,
    fontSize: 11,
    color: palette.danger,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginVertical: 12,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.foreground,
    textAlign: 'center',
  },
  emptyDesc: {
    marginTop: 6,
    fontSize: 12,
    color: palette.mutedForeground,
    textAlign: 'center',
  },
});

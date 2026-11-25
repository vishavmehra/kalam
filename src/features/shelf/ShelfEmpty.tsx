import { Link, router } from 'expo-router';
import { ChevronRight, ClipboardCheck, Flame, type LucideIcon, Plus, Ruler, Wallet } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { Button, Text, useBreakpoint, useKalamTheme, webData } from '@/design';
import { SketchStatic } from '@/features/landing/SketchStatic';

/** Starter ideas (docs/03 §4.4). Selecting one pre-fills Create; it never creates an app by itself. */
const IDEAS: Array<{ icon: LucideIcon; title: string; prompt: string }> = [
  { icon: Wallet, title: 'A personal expense tracker', prompt: 'Track my daily expenses with amount, category and date, and show what I spent this month.' },
  { icon: Ruler, title: 'A customer measurement book', prompt: 'A measurement book for my tailoring customers: name, phone, chest, waist, length and notes.' },
  { icon: Flame, title: 'A daily habit counter', prompt: 'Count my daily habits like glasses of water and walks, and start fresh every morning.' },
  { icon: ClipboardCheck, title: 'An attendance register', prompt: 'An attendance register for my class: student name, date, and present or absent, with a count for each student.' },
];

export function ShelfEmpty() {
  const theme = useKalamTheme();
  const c = theme.colors;
  const { isDesktop, isPhone } = useBreakpoint();
  return (
    <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 56 : 24, alignItems: isDesktop ? 'center' : 'stretch', paddingTop: isPhone ? 8 : 16 }}>
      <View style={{ flex: isDesktop ? 6 : undefined, gap: 24, maxWidth: 620 }}>
        <View style={{ gap: 8 }}>
          <Text variant="h2">Nothing on your shelf yet</Text>
          <Text variant="bodyLarge" tone="secondary">
            Apps you make live here and keep working without internet. Describe one in your own words, or start
            from an idea and change it to fit.
          </Text>
        </View>
        <Button label="Create your first app" icon={Plus} size="lg" onPress={() => router.push(routes.create)} fullWidth={isPhone} />
        <View style={{ gap: 4 }}>
          <Text variant="bodySmall" weight="medium" tone="secondary" style={{ marginBottom: 4 }}>Or start from an idea</Text>
          {IDEAS.map(({ icon: Icon, title, prompt }) => (
            <Link key={title} href={routes.createWithPrompt(prompt)} asChild>
              <Pressable
                role="link"
                accessibilityLabel={`${title}. Opens Create with this idea filled in.`}
                {...webData({ kPress: '', kHover: 'surface' })}
                android_ripple={{ color: c.surfaceAlt }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  minHeight: theme.touchTarget + 16, paddingVertical: 10, paddingHorizontal: 12, marginHorizontal: -12,
                  borderRadius: theme.radius.md,
                }}
              >
                <View style={{ width: 40, height: 40, borderRadius: theme.radius.md, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={20} color={c.text} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="semibold">{title}</Text>
                  <Text variant="bodySmall" tone="secondary" numberOfLines={1}>{prompt}</Text>
                </View>
                <ChevronRight size={18} color={c.textMuted} />
              </Pressable>
            </Link>
          ))}
        </View>
      </View>
      <View style={{ flex: isDesktop ? 5 : undefined, alignItems: 'center' }}>
        <SketchStatic height={isDesktop ? 440 : 300} label="Example: a pen sketch of an expense app, and the finished app on a phone." />
      </View>
    </View>
  );
}

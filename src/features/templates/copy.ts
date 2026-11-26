/**
 * Every string of the template gallery, starter packs, clone sheet and restore confirmation. The words live in
 * the i18n catalogue (keys `templates.*`); this keeps the shapes the screens already read. Getters and functions,
 * so a language switch shows on the next render. Plain words, no em dashes, no exclamation marks. The sentences of
 * cloning, restoring and the packs themselves live beside their logic in src/core/clone and src/core/starter-packs.
 */
import type { SuggestedMode, ThemePreset } from '@/core/spec/schema';
import { t } from '@/i18n/active';

export const copy = {
  page: {
    get title() { return t('templates.page.title'); },
    get intro() { return t('templates.page.intro'); },
    get packsTitle() { return t('templates.page.packsTitle'); },
    get packsIntro() { return t('templates.page.packsIntro'); },
    get galleryTitle() { return t('templates.page.galleryTitle'); },
  },
  search: {
    get label() { return t('templates.search.label'); },
    get placeholder() { return t('templates.search.placeholder'); },
    get categoryLabel() { return t('templates.search.categoryLabel'); },
    results: (n: number): string => t('templates.search.results', { count: n }),
    get emptyTitle() { return t('templates.search.emptyTitle'); },
    get emptyBody() { return t('templates.search.emptyBody'); },
  },
  card: {
    open: (title: string): string => t('templates.card.open', { title }),
    get openHint() { return t('templates.card.openHint'); },
    madeBy: (author: string): string => t('templates.card.madeBy', { author }),
  },
  preview: {
    get exampleBadge() { return t('templates.preview.exampleBadge'); },
    get exampleNote() { return t('templates.preview.exampleNote'); },
    regionLabel: (title: string): string => t('templates.preview.regionLabel', { title }),
    get firstScreen() { return t('templates.preview.firstScreen'); },
    get otherScreens() { return t('templates.preview.otherScreens'); },
    get fieldsOn() { return t('templates.preview.fieldsOn'); },
    more: (n: number): string => t('templates.preview.more', { n }),
    get emptyList() { return t('templates.preview.emptyList'); },
    get goodToKnow() { return t('templates.preview.goodToKnow'); },
    get offline() { return t('templates.preview.offline'); },
    get noAi() { return t('templates.preview.noAi'); },
    get nameLabel() { return t('templates.preview.nameLabel'); },
    get nameHelper() { return t('templates.preview.nameHelper'); },
    get lookLabel() { return t('templates.preview.lookLabel'); },
    get use() { return t('templates.preview.use'); },
    get using() { return t('templates.preview.using'); },
    get close() { return t('templates.preview.close'); },
    added: (name: string): string => t('templates.preview.added', { name }),
    get failed() { return t('templates.preview.failed'); },
  },
  looks: {
    get calm_green() { return t('templates.looks.calm_green'); },
    get warm_paper() { return t('templates.looks.warm_paper'); },
    get ocean_blue() { return t('templates.looks.ocean_blue'); },
    get soft_lavender() { return t('templates.looks.soft_lavender'); },
    get minimal_neutral() { return t('templates.looks.minimal_neutral'); },
    get high_contrast() { return t('templates.looks.high_contrast'); },
  } satisfies Record<ThemePreset, string>,
  packs: {
    open: (title: string): string => t('templates.packs.open', { title }),
    get openHint() { return t('templates.packs.openHint'); },
    get whoFor() { return t('templates.packs.whoFor'); },
    get howToStart() { return t('templates.packs.howToStart'); },
    get tips() { return t('templates.packs.tips'); },
    get inPack() { return t('templates.packs.inPack'); },
    get close() { return t('templates.packs.close'); },
    status: {
      get new() { return t('templates.packs.status.new'); },
      get have() { return t('templates.packs.status.have'); },
    },
    modes: {
      get large() { return t('templates.packs.modes.large'); },
      get highContrast() { return t('templates.packs.modes.highContrast'); },
      get simple() { return t('templates.packs.modes.simple'); },
      get readAloud() { return t('templates.packs.modes.readAloud'); },
    } satisfies Record<SuggestedMode, string>,
    modesLine: (labels: readonly string[]): string => {
      const list = labels.length > 1
        ? t('templates.packs.listAnd', { rest: labels.slice(0, -1).join(', '), last: labels[labels.length - 1] ?? '' })
        : (labels[0] ?? '');
      return t('templates.packs.modesLine', { list });
    },
  },
  shelf: {
    get label() { return t('templates.shelf.label'); },
    archive: (n: number): string => t('templates.shelf.archive', { n }),
    get backToShelf() { return t('templates.shelf.backToShelf'); },
    get archived() { return t('templates.shelf.archived'); },
    get unarchived() { return t('templates.shelf.unarchived'); },
    get archiveFailed() { return t('templates.shelf.archiveFailed'); },
    get emptyArchive() { return t('templates.shelf.emptyArchive'); },
  },
  clone: {
    get open() { return t('templates.clone.open'); },
    get openHint() { return t('templates.clone.openHint'); },
    get cancel() { return t('templates.clone.cancel'); },
  },
  entry: {
    get open() { return t('templates.entry.open'); },
    get title() { return t('templates.entry.title'); },
    get intro() { return t('templates.entry.intro'); },
    get json() { return t('templates.entry.json'); },
    get csv() { return t('templates.entry.csv'); },
    get text() { return t('templates.entry.text'); },
    get pictures() { return t('templates.entry.pictures'); },
    get saved() { return t('templates.entry.saved'); },
    get notSaved() { return t('templates.entry.notSaved'); },
    get copied() { return t('templates.entry.copied'); },
    get failed() { return t('templates.entry.failed'); },
    get close() { return t('templates.entry.close'); },
  },
  restore: {
    get changesHeading() { return t('templates.restore.changesHeading'); },
    more: (n: number): string => t('templates.restore.more', { count: n }),
    get showDetail() { return t('templates.restore.showDetail'); },
    get hideDetail() { return t('templates.restore.hideDetail'); },
    get before() { return t('templates.restore.before'); },
    get after() { return t('templates.restore.after'); },
    get entriesHeading() { return t('templates.restore.entriesHeading'); },
    get problemsHeading() { return t('templates.restore.problemsHeading'); },
    get ok() { return t('templates.restore.ok'); },
  },
};

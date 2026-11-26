/**
 * Deterministic complexity classifier (docs/07 §3, CP3). No model call: keyword signals for
 * entities, relationships, workflows, roles, reports, conditional rules, multimodal input and
 * template fit decide simple / medium / complex, with plain-English reasons for observability.
 *
 * ponytail: lexicon heuristics, benchmarked in tests/fixtures/requests/classifier-cases.json.
 * Escalate genuinely ambiguous cases to Nano/cloud classification if the benchmark drops < 90%.
 */
import type { ComplexityLevel, DrawingSummary, NormalizedInput, TaskClassification, TemplateId } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { getTemplate, matchTemplates } from '../templates';

const STRONG_TEMPLATE = 0.7;

/** Distinct kinds of records. `tx` = transactional records that link to other parties. */
const ENTITIES: ReadonlyArray<{ name: string; re: RegExp; tx?: boolean }> = [
  { name: 'customers', re: /\b(?:customers?|clients?|grahak|buyers?)\b|ग्राहक/ },
  { name: 'orders', re: /\b(?:orders?|bookings?)\b/, tx: true },
  { name: 'products', re: /\b(?:products?|inventory|stock|items? in stock|maal)\b/ },
  { name: 'payments', re: /\b(?:payments?|invoices?|receipts?|udhaa?r|credit|dues|installments?)\b|उधार/, tx: true },
  { name: 'employees', re: /\b(?:employees?|staff|workers?|karmachari|labou?rers?)\b/ },
  { name: 'suppliers', re: /\b(?:suppliers?|vendors?|wholesalers?|distributors?)\b/ },
  { name: 'students', re: /\b(?:students?|pupils?|trainees?)\b/ },
  { name: 'teachers', re: /\b(?:teachers?|tutors?|trainers?)\b/ },
  { name: 'patients', re: /\b(?:patients?)\b|मरीज/ },
  { name: 'doctors', re: /\b(?:doctors?|clinicians?)\b/ },
  { name: 'appointments', re: /\b(?:appointments?|consultations?)\b/, tx: true },
  { name: 'attendance', re: /\b(?:attendance|haa?ziri|hajiri)\b/ },
  { name: 'classes', re: /\b(?:classes|courses?|subjects?|batches)\b/ },
  { name: 'projects', re: /\b(?:projects?|tickets?)\b/ },
  { name: 'purchases', re: /\b(?:purchases?|purchase orders?|sales|stock movements?|incoming stock|outgoing stock)\b/, tx: true },
  { name: 'members', re: /\b(?:members?|memberships?|subscribers?)\b/ },
  { name: 'deliveries', re: /\b(?:deliveries|shipments?|dispatches)\b/, tx: true },
  { name: 'salaries', re: /\b(?:salar(?:y|ies)|payroll|wages)\b/, tx: true },
  { name: 'leads', re: /\b(?:leads?|deals?|prospects?)\b/ },
  { name: 'fees', re: /\b(?:fees?|tuition(?! (?:class|classes|centre|center)))\b/, tx: true },
];

const SIGNALS = {
  relationship: /\b(?:each|every|per)\s+(?:customer|client|student|employee|patient|product|member|order|supplier|item)\b|\bbelongs? to\b|\blinked (?:to|with)\b|\brelated to\b|\b(?:order|purchase|payment|visit|medical) history\b|\bhistory of\b|\btheir (?:orders|payments|history|visits|marks)\b|\bfor each\b|\bassign(?:ed)? to\b|\bconnect(?:ed)? to\b|\bbalance (?:of|for|per) each\b|\bhar (?:customer|grahak|student|member|employee)\b|\balag (?:record|hisaab|khata|balance)\b/,
  workflow: /\bworkflows?\b|\bapprov(?:al|e|ed|es)\b|\bstatus (?:changes|updates|flow)\b|\bstages?\b|\bpipeline\b|\bescalat|\bmulti[- ]step\b|\bstep[- ]by[- ]step\b|\bthen (?:it|the|send|move|mark)\b|\bafter (?:approval|payment|delivery|confirmation)\b|\b(?:pending|in progress|completed|delivered|dispatched) (?:and|,|→|->)/,
  roles: /\broles?\b|\badmins?\b|\bpermissions?\b|\blog ?ins?\b|\bsign ?ins?\b|\baccess (?:control|levels?|rights)\b|\bonly (?:the )?(?:managers?|admins?|owners?|teachers?)\b|\b(?:managers?|owners?|staff) (?:can|should) (?:see|edit|approve)\b|\bmulti[- ]user\b|\bdifferent users\b|\buser accounts?\b/,
  reports: /\breports?\b|\bdashboards?\b|\banalytics\b|\bcharts?\b|\bgraphs?\b|\binsights?\b|\bprofit\b|\bp ?& ?l\b|\bgst returns?\b|\bmonthly summary\b/,
  heavyReports: /\bdashboards\b|\b(?:extensive|detailed|multiple|advanced|many) (?:reports|reporting|analytics)\b|\breporting\b/,
  conditional: /\bif\b|\bunless\b|\botherwise\b|\bautomatically\b|\bauto[- ](?:calculate|apply|assign|update)\b|\balert (?:me )?when\b|\bwhen\b[^.]{0,40}\b(?:then|automatically|alert|notify|warn|should)\b|\brules?\b|\bconditions?\b|\bagar\b|\bjab\b[^.]{0,30}\btab\b|\bdiscount (?:if|when|above)\b/,
  integrations: /\bsms\b|\bwhatsapp\b|\bsend (?:an? )?(?:email|message|notification)s?\b|\bpush notifications?\b|\bpayment gateway\b|\bupi\b|\brazorpay\b|\bstripe\b|\bsync(?:hroni[sz]e)? (?:with|to)\b|\bapi\b|\bintegrat|\bbarcode\b|\bqr code\b|\bgps\b|\blive location\b/,
  system: /\bmanagement\b|\bmanage (?:my )?(?:orders|customers|stock|staff|clinic|school|shop|business)\b|\bsystem\b|\berp\b|\bcrm\b|\bpos\b|\bpoint of sale\b|\bbilling software\b/,
  bigSystem: /\berp\b|\bcrm\b|\bmulti[- ](?:branch|location|store|entity|role)\b|\bend[- ]to[- ]end\b|\bcomplete (?:business|school|clinic|hospital) (?:management|system)\b/,
  multiScreen: /\bmulti[- ]screen\b|\b(?:multiple|several|many) (?:screens|pages|tabs)\b/,
  appWords: /\bapps?\b|\bapplication\b|\btracker\b|\btrack\b|\bregister\b|\blist\b|\bbook\b|\bform\b|\bmanage\b|\brecord\b|\blog\b|\bcalculator\b|\bcounter\b|\bconvert(?:er)?\b|\bbanao\b|\bbana do\b|\bchahiye\b|\bkeep\b|\bsave\b|\bnote\b|\bsystem\b|ऐप|बनाओ/,
  vague: /^(?:please\s+)?(?:make|build|create|give me|i want|i need)?\s*(?:me\s+)?(?:an?|my|some)?\s*(?:app|application|something|tool|ek app|app banao|kuch banao)?\s*(?:please|for me|banao|bana do)?$/,
};

const STRUCTURAL_EDIT =
  /\badd (?:a |an |another )?(?:new )?(?:screen|page|section|collection|table|form|report|list|tab)\b|\bnew (?:screen|page|section|collection|field)\b|\bremove (?:the )?(?:screen|page|collection)\b|\badd (?:a |an )?(?:new )?field\b|\bworkflow\b|\blink\b|\brestructure\b|\bsplit\b|\bmerge\b|\balso track\b|\btrack (?:also|more)\b|\bnaya (?:page|screen|field)\b/;
const COSMETIC_EDIT =
  /\bcolou?r\b|\btheme\b|\bdark\b|\bbigger\b|\blarger\b|\bsmaller\b|\bfont\b|\btext size\b|\brename\b|\bcall it\b|\bname\b|\blabel\b|\btitle\b|\bhindi\b|\benglish\b|\blanguage\b|\bround(?:ed)? corners\b|\bradius\b|\bgreen\b|\bblue\b|\bred\b|\bpurple\b/;

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const templateCounts = new Map<TemplateId, { screens: number; collections: number; actions: number }>();
function countsForTemplate(id: TemplateId): { screens: number; collections: number; actions: number } {
  const cached = templateCounts.get(id);
  if (cached) return cached;
  const t = getTemplate(id);
  const spec = t?.build(t.defaults, { appId: 'app_estimate', now: 0, lang: 'en' });
  const counts = spec ? countsOf(spec) : { screens: 1, collections: 1, actions: 1 };
  templateCounts.set(id, counts);
  return counts;
}
function countsOf(spec: KalamSpec): { screens: number; collections: number; actions: number } {
  return { screens: spec.screens.length, collections: Object.keys(spec.collections).length, actions: Object.keys(spec.actions).length };
}

const RANK: Record<ComplexityLevel, number> = { simple: 0, medium: 1, complex: 2 };
const higher = (a: ComplexityLevel, b: ComplexityLevel): ComplexityLevel => (RANK[b] > RANK[a] ? b : a);

/**
 * Points say how much is asked for; `hard` says whether any of it is a genuinely heavy kind (roles, workflows,
 * a whole business system, extensive dashboards, many screens, four or more record kinds, a very long brief).
 * Links between records plus ordinary reports are a medium app (docs/07 §3.1): they reach "complex" only with a hard
 * signal or a very high score.
 */
const levelFor = (a: Pick<TextAnalysis, 'points' | 'hard'>): ComplexityLevel =>
  a.points <= 1 ? 'simple' : a.points >= 8 || (a.points >= 5 && a.hard) ? 'complex' : 'medium';

/**
 * The one other level a close call could be, or undefined when the score is clear (docs/07 §3.4). Only the
 * small-model tie-break uses it, and only upward: one point short of medium, or the medium/complex edge. A complex
 * request always has a heavy signal, so it is never second-guessed downward.
 */
function alternativeFor(a: Pick<TextAnalysis, 'points'>, level: ComplexityLevel): ComplexityLevel | undefined {
  if (level === 'simple') return a.points === 1 ? 'medium' : undefined;
  return level === 'medium' && a.points >= 4 ? 'complex' : undefined;
}

/**
 * Size of a Drawing Studio sketch from its structure alone (docs/07 §3.2: screens, actions, size). The words on
 * a sketch are labels, not requirements, so they never raise the level.
 * ponytail: thresholds fitted to tests/evaluation/golden/sketches.json, so its 25/25 is a fitted score, not
 * evidence. On sketches-heldout.json (written afterwards, never used to tune) it gets 7/12: 7/8 clear cases, 0/4
 * ambiguous, every miss one level too high (a contact book's list and form buttons read as two actions). Two pages
 * with one button (a form and its list) stay simple; a second button is a second action. Replace with an estimate
 * from the compiled app, and add a fresh held-out set, before quoting sketch accuracy as a product claim.
 */
function drawingLevel(d: DrawingSummary): ComplexityLevel {
  if (d.pageCount >= 5 || d.elements.length > 60) return 'complex';
  if (d.pageCount >= 3) return 'medium';
  if (d.pageCount === 2) return d.elements.filter((e) => e.kind === 'stamp:bigButton').length >= 2 ? 'medium' : 'simple';
  return d.elements.length > 14 ? 'medium' : 'simple';
}
const GENERIC_KEYWORD = /^(notes?|log|logs|list|lists|tracker|track|app|record|records|diary|journal)$/i;
const round2 = (n: number) => Math.round(n * 100) / 100;
const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

interface TextAnalysis {
  points: number;
  reasons: string[];
  entities: string[];
  reports: boolean;
  roles: boolean;
  workflow: boolean;
  /** At least one heavy signal, see levelFor. */
  hard: boolean;
  explicitScreens?: number;
}

function analyzeText(raw: string): TextAnalysis {
  const t = raw.toLowerCase();
  const reasons: string[] = [];
  let points = 0;

  const found = ENTITIES.filter((e) => e.re.test(t));
  const entities = found.map((e) => e.name);
  if (found.length >= 2) {
    points += found.length - 1;
    reasons.push(`Mentions ${found.length} kinds of records (${list(entities)}).`);
  }
  const tx = found.filter((e) => e.tx);
  if (tx.length) {
    points += tx.length;
    reasons.push(`Records transactions (${list(tx.map((e) => e.name))}) that usually link to other records.`);
  }
  const workflow = SIGNALS.workflow.test(t);
  const roles = SIGNALS.roles.test(t);
  const reports = SIGNALS.reports.test(t);
  if (SIGNALS.relationship.test(t)) { points += 2; reasons.push('Records are linked to each other (for example a per-customer history).'); }
  if (workflow) { points += 2; reasons.push('Describes a multi-step workflow, statuses or approvals.'); }
  if (roles) { points += 3; reasons.push('Asks for user roles, logins or permissions. Kalam apps have one user, so this needs careful planning.'); }
  if (reports) {
    const heavy = SIGNALS.heavyReports.test(t);
    points += heavy ? 3 : 2;
    reasons.push(heavy ? 'Asks for extensive reports or dashboards.' : 'Asks for reports or summaries beyond simple totals.');
  }
  if (SIGNALS.conditional.test(t)) { points += 1; reasons.push('Has conditional rules (if / when / automatically).'); }
  if (SIGNALS.integrations.test(t)) {
    points += 1;
    reasons.push('Mentions things Kalam apps cannot do offline (messages, payments, sync or scanning); the closest offline version must be planned.');
  }
  if (SIGNALS.bigSystem.test(t)) { points += 5; reasons.push('Describes a full business system (CRM / ERP / multi-branch).'); }
  else if (SIGNALS.system.test(t)) { points += 1; reasons.push('Sounds like a management system rather than a single list.'); }

  let explicitScreens: number | undefined;
  const sm = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:screens|pages|tabs|sections)\b/.exec(t);
  if (sm?.[1]) explicitScreens = Number(sm[1]) || NUMBER_WORDS[sm[1]];
  if (explicitScreens && explicitScreens >= 4) {
    points += explicitScreens >= 6 ? 2 : 1;
    reasons.push(`Asks for ${explicitScreens} screens.`);
  } else if (SIGNALS.multiScreen.test(t)) { points += 2; reasons.push('Asks for several screens.'); }

  const words = t.split(/\s+/).filter(Boolean).length;
  if (words > 120) { points += 2; reasons.push(`Long, detailed request (${words} words).`); }
  else if (words > 60) { points += 1; reasons.push(`Detailed request (${words} words).`); }

  const hard = workflow || roles || SIGNALS.bigSystem.test(t) || (reports && SIGNALS.heavyReports.test(t))
    || SIGNALS.multiScreen.test(t) || (explicitScreens ?? 0) >= 4 || found.length >= 4 || words > 120;
  return { points, reasons, entities, reports, roles, workflow, hard, explicitScreens };
}

function estimate(a: TextAnalysis): { screens: number; collections: number; actions: number } {
  const collections = Math.min(10, Math.max(1, a.entities.length));
  const screens = Math.min(8, a.explicitScreens ?? 1 + collections * 2 + (a.reports ? 1 : 0) + (a.roles ? 1 : 0));
  const actions = Math.min(60, collections * 4 + (a.workflow ? 3 : 0));
  return { screens, collections, actions };
}

function classifyEdit(text: string, spec: KalamSpec): TaskClassification {
  const t = text.toLowerCase();
  const a = analyzeText(text);
  const base = countsOf(spec);
  const structural = STRUCTURAL_EDIT.test(t) || a.points >= 2;
  const complexity: ComplexityLevel = levelFor(a) === 'complex' ? 'complex' : structural ? 'medium' : 'simple';
  const reasons = [`Changes the existing app "${spec.name}".`];
  if (complexity === 'simple') {
    reasons.push(COSMETIC_EDIT.test(t)
      ? 'Looks like a small change (theme, name, labels or language) that can be applied as a patch.'
      : 'Looks like a small change; a patch should be enough.');
  } else {
    reasons.push('Changes the app structure (screens, records or fields), which needs cloud reasoning.', ...a.reasons);
  }
  const vague = t.trim().split(/\s+/).length < 2;
  if (vague) reasons.push('The change request is very short; please say what to change.');
  return {
    taskType: 'modify_app',
    complexity,
    estimatedScreens: Math.min(8, base.screens + (/\b(?:screen|page|tab)\b/.test(t) && structural ? 1 : 0)),
    estimatedCollections: Math.min(10, base.collections + (/\b(?:collection|table)\b/.test(t) && structural ? 1 : 0)),
    estimatedActions: base.actions,
    requiresMultimodalReasoning: false,
    requiresCloudReasoning: complexity !== 'simple',
    confidence: vague ? 0.3 : complexity === 'simple' ? (COSMETIC_EDIT.test(t) ? 0.85 : 0.6) : 0.75,
    method: 'deterministic',
    reasons,
  };
}

/** Classifies a normalised creation/edit request without any model call (docs/07 §3.4). */
export function classifyRequest(input: NormalizedInput): TaskClassification {
  const text = [input.text, input.audioTranscript, input.video?.summary, ...(input.drawing?.texts ?? [])]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join('\n')
    .trim();

  if (input.existingSpec) return classifyEdit(text, input.existingSpec);

  // Frames are samples of one clip and a drawing's page images repeat its pages: neither is a separate image.
  const photos = input.images.filter((i) => i.source !== 'video_frame').length;
  const hasSketch = photos > 0 || !!input.drawing;
  const hasVideo = !!input.video || input.modalities.includes('video');
  const untranscribedAudio = input.modalities.includes('audio') && !input.audioTranscript;
  const multimodal = hasSketch || hasVideo || untranscribedAudio || input.images.length > 0;

  const a = analyzeText(text);
  const reasons: string[] = [];
  if (input.audioTranscript) reasons.push('Voice note was transcribed and is treated as text.');

  if (multimodal) {
    const pages = input.drawing?.pageCount ?? 0;
    const est = estimate(a);
    const screens = Math.min(8, Math.max(est.screens, pages, photos, 1));
    // The level comes from what is asked for, not from the input type: needing vision does not make an app harder.
    // A Studio drawing has a known structure, so a small sketch stays simple. A photo, clip or recording hides its
    // structure until the cloud model reads it, so those start at medium. The drawing's own labels never count.
    const said = [input.text, input.audioTranscript, input.video?.summary].filter((s): s is string => !!s?.trim()).join('\n');
    const spoken = analyzeText(said);
    const unseen = photos > 0 || hasVideo || untranscribedAudio || input.images.length > 0;
    let level: ComplexityLevel = input.drawing ? drawingLevel(input.drawing) : 'simple';
    if (unseen) level = higher(level, 'medium');
    if (photos > 4) level = 'complex';
    if (said) level = higher(level, input.drawing ? higher('medium', levelFor(spoken)) : levelFor(spoken));
    reasons.push(
      hasSketch
        ? 'Includes a sketch or photo of an app; reading its layout needs cloud vision.'
        : hasVideo
          ? 'Includes a video; understanding it needs cloud multimodal reasoning.'
          : 'Includes audio that has not been transcribed; it needs cloud multimodal reasoning.',
    );
    if (input.drawing && !unseen) {
      reasons.push(level === 'simple'
        ? `The sketch is small (${pages} page${pages === 1 ? '' : 's'}), so the app should be simple.`
        : 'The sketch is large or comes with extra instructions, so the app is more than simple.');
    }
    // A sketch's own labels are not requirements, so they are not offered as reasons for its level.
    if (said || !input.drawing) reasons.push(...a.reasons);
    return {
      taskType: hasSketch ? 'interpret_sketch' : 'create_app',
      complexity: level,
      estimatedScreens: screens,
      estimatedCollections: est.collections,
      estimatedActions: Math.max(est.actions, screens * 2),
      requiresMultimodalReasoning: true,
      requiresCloudReasoning: true,
      confidence: 0.8,
      method: 'deterministic',
      reasons,
    };
  }

  const top = matchTemplates(text)[0];
  const words = text.split(/\s+/).filter(Boolean).length;
  // A long request that matched only a generic word ("notes", "log") is about something else (QA 2026-11-26: a plant
  // log became the Notes template). Treat it as no template so the structure is generated and nothing is dropped.
  const onlyGeneric = !!top && words > 8 && top.matchedKeywords.every((k) => GENERIC_KEYWORD.test(k));
  const strong = top && top.score >= STRONG_TEMPLATE && !onlyGeneric ? top : undefined;
  const t = text.toLowerCase();
  const looksLikeApp = !!top || a.entities.length > 0 || a.points > 0 || SIGNALS.appWords.test(t);
  const vague = !text || (!strong && (words < 3 || SIGNALS.vague.test(t.replace(/[.!?]/g, '').trim())));

  if (vague || !looksLikeApp) {
    reasons.push(vague
      ? 'The request is too short or vague to know what app to build; ask what it should track or calculate.'
      : 'This does not clearly describe an app; ask what it should track or calculate.');
    return {
      taskType: 'create_app', complexity: 'simple', estimatedScreens: 1, estimatedCollections: 0, estimatedActions: 0,
      requiresMultimodalReasoning: false, requiresCloudReasoning: false, confidence: 0.3, method: 'deterministic', reasons,
    };
  }

  const complexity = levelFor(a);
  if (strong) {
    const title = getTemplate(strong.templateId)?.title ?? strong.templateId;
    reasons.push(`Matches the ${title} template (${list(strong.matchedKeywords.slice(0, 3).map((k) => `"${k}"`))}).`);
  }
  if (complexity === 'simple' && strong) {
    const c = countsForTemplate(strong.templateId);
    reasons.push('Simple enough to build from a template on this device. No cloud call needed.', ...a.reasons);
    return {
      taskType: 'create_app', complexity, estimatedScreens: c.screens, estimatedCollections: c.collections,
      estimatedActions: c.actions, requiresMultimodalReasoning: false, requiresCloudReasoning: false,
      matchingTemplate: strong.templateId, confidence: round2(Math.min(0.95, 0.6 + 0.35 * strong.score)),
      method: 'deterministic', reasons,
    };
  }

  const est = estimate(a);
  if (complexity === 'simple') {
    reasons.push('Looks simple, but no ready-made template fits, so the app structure has to be generated.', ...a.reasons);
  } else {
    if (strong) reasons.push(`Needs more than the template offers, so it is a ${complexity} app.`);
    reasons.push(...a.reasons);
  }
  return {
    taskType: 'create_app',
    complexity,
    estimatedScreens: est.screens,
    estimatedCollections: est.collections,
    estimatedActions: est.actions,
    requiresMultimodalReasoning: false,
    requiresCloudReasoning: true,
    ...(alternativeFor(a, complexity) ? { alternative: alternativeFor(a, complexity) } : {}),
    confidence: complexity === 'simple' ? 0.55 : complexity === 'medium' ? 0.7 : round2(Math.min(0.92, 0.7 + 0.03 * a.points)),
    method: 'deterministic',
    reasons,
  };
}

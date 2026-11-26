/**
 * Case sets for the per-task local-ready benchmark (docs/07 §6.7, §20.5; scripts/local-ready.mjs). Each case is the REAL request
 * the app would send: the services are run against a recording stand-in for the orchestrator, which keeps the request and
 * answers nothing, so no prompt is written twice and the benchmark cannot drift from the app. The judge sees the answer after the
 * same parser the app uses.
 *
 * Inputs are invented short sentences (no one's data). Where a case needs the person's own words to be judged, the expected words
 * are listed beside it, so a wrong answer is wrong for a reason a person can read.
 */
import { readFileSync } from 'node:fs';
import type { BenchCase, Verdict } from '@/core/ai/local-bench';
import type { LocalTask } from '@/core/ai/local-ready';
import { irToSpec } from '@/core/compiler/convert';
import { compilerIRSchema } from '@/core/compiler/ir';
import type { AIOrchestrator, StructuredRequest } from '@/core/contracts';
import type { KalamAIBlock, KalamSpec } from '@/core/spec/schema';
import { createAIBlockService } from '@/core/tasks/ai-block-service';
import { createVoiceService } from '@/core/tasks/voice-service';

/** A stand-in orchestrator that records the request of one run and fails it. Only `run` and `status` are used. */
function recorder() {
  const taken: StructuredRequest<unknown>[] = [];
  const ai = {
    run: async (req: StructuredRequest<unknown>) => {
      taken.push(req);
      return { success: false, provider: 'none', source: 'on_device', latencyMs: 0, fallbackUsed: false, errorCode: 'provider_error' };
    },
    status: async () => ({ onDevice: { platform: 'web', apiExposed: true, availability: 'available', warm: true }, cloudConfigured: true, online: true, specialistConfigured: false }),
    recordDeterministic: async () => {},
    prepareOnDevice: async () => ({ platform: 'web', apiExposed: true, availability: 'available' }),
    warmUpOnDevice: async () => ({ platform: 'web', apiExposed: true, availability: 'available', warm: true }),
  } as unknown as AIOrchestrator;
  return { ai, last: () => taken.at(-1), reset: () => { taken.length = 0; } };
}

const tailorIR = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const tailor = irToSpec(tailorIR, { appId: 'app_tailor01', now: 1 });

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const has = (text: string, words: readonly string[]) => words.some((w) => norm(text).includes(norm(w)));
const SPELLED: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', ten: '10', fifteen: '15', twenty: '20', forty: '40', first: '1', fifth: '5', twelfth: '12' };
/** Digits in a text, and number words as digits ("ten percent" holds 10), so turning a word into a digit is not counted as invented. */
const numbersIn = (s: string): string[] => [
  // "12,000" and "12000" are the same number.
  ...(s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')),
  ...norm(s).split(' ').flatMap((w) => (SPELLED[w] ? [SPELLED[w]] : [])),
];

// ─── voice_action ───────────────────────────────────────────────────────────────────────────────
interface VoiceCase { id: string; screen: string; said: string; action: string | null; fields?: Record<string, string | number> }
/** Spoken commands none of the app's own phrases match, so the model has to choose (the app tries its own phrases first). */
const VOICE: VoiceCase[] = [
  { id: 'v01', screen: 'new_order', said: 'put this one in the book', action: 'save_order' },
  { id: 'v02', screen: 'new_order', said: 'I am finished with this entry, keep it', action: 'save_order' },
  { id: 'v03', screen: 'new_order', said: 'store the stitching job for Meena', action: 'save_order', fields: { customer: 'Meena' } },
  { id: 'v04', screen: 'home', said: 'take me to the page where I add a new tailoring job', action: 'go_new_order' },
  { id: 'v05', screen: 'home', said: 'I want to start a fresh stitching job', action: 'go_new_order' },
  { id: 'v06', screen: 'home', said: 'show me everyone I stitch for', action: 'go_customers' },
  { id: 'v07', screen: 'home', said: 'bring up the list of people', action: 'go_customers' },
  { id: 'v08', screen: 'customers', said: 'go back to the main page', action: 'go_home' },
  { id: 'v09', screen: 'customers', said: 'I met someone new, let me write them down', action: 'go_new_customer' },
  { id: 'v10', screen: 'home', said: 'mujhe naya kaam shuru karna hai', action: 'go_new_order' },
  { id: 'v11', screen: 'home', said: 'saare grahakon ki list dikhao', action: 'go_customers' },
  { id: 'v12', screen: 'new_order', said: 'isko likh lo Raju ke naam', action: 'save_order', fields: { customer: 'Raju' } },
  { id: 'v13', screen: 'customers', said: 'wapas pehle page par chalo', action: 'go_home' },
  { id: 'v14', screen: 'order_detail', said: 'this job is cancelled, throw it away', action: 'delete_order' },
  { id: 'v15', screen: 'order_detail', said: 'remove this stitching job completely', action: 'delete_order' },
  { id: 'v16', screen: 'order_detail', said: 'I changed the delivery, save the changes', action: 'update_order' },
  { id: 'v17', screen: 'new_customer', said: 'keep this person in my contacts', action: 'saveCustomer' },
  { id: 'v18', screen: 'new_order', said: 'garment is a kurta and chest is forty two, store it', action: 'save_order', fields: { garment: 'Kurta' } },
  { id: 'v19', screen: 'home', said: 'what is the weather like today', action: null },
  { id: 'v20', screen: 'home', said: 'tell me a joke', action: null },
  { id: 'v21', screen: 'new_order', said: 'play some music', action: null },
  { id: 'v22', screen: 'customers', said: 'how many days until Diwali', action: null },
  { id: 'v23', screen: 'order_detail', said: 'this one is wrong, scrap it', action: 'delete_order' },
  { id: 'v24', screen: 'home', said: 'open the page where I see my regular people', action: 'go_customers' },
  { id: 'v25', screen: 'new_order', said: 'log this one for Anita, a kurta', action: 'save_order', fields: { customer: 'Anita' } },
  { id: 'v26', screen: 'home', said: 'start writing down a new person I stitch for', action: 'go_new_customer' },
  { id: 'v27', screen: 'customers', said: 'I need to enter a brand new client', action: 'go_new_customer' },
  { id: 'v28', screen: 'home', said: 'what is two plus two', action: null },
];

async function voiceCases(): Promise<Array<BenchCase<unknown>>> {
  const out: Array<BenchCase<unknown>> = [];
  for (const c of VOICE) {
    const rec = recorder();
    // Deterministic phrase matching runs first inside the service; a case it answers never reaches the model and is not a model case.
    await createVoiceService({ ai: rec.ai }).interpret(tailor, c.screen, c.said);
    const request = rec.last();
    if (!request) continue;
    const judge = (o: unknown): Verdict => {
      const r = o as { action: string | null; fields: Record<string, unknown> };
      const said = norm(c.said);
      const madeUp = Object.entries(r.fields ?? {}).some(([, v]) => typeof v === 'string' && !said.includes(norm(v)));
      if (madeUp || (c.action === null && r.action !== null)) return 'invented';
      if (r.action !== c.action) return 'wrong';
      const want = Object.entries(c.fields ?? {});
      const got = r.fields ?? {};
      return want.every(([k, v]) => norm(String(got[k] ?? '')) === norm(String(v))) ? 'right' : 'wrong';
    };
    out.push({ id: c.id, request: request as StructuredRequest<unknown>, judge });
  }
  return out;
}

// ─── summarize and translate (AI steps) ────────────────────────────────────────────────────────
const block = <K extends KalamAIBlock['kind']>(b: Extract<KalamAIBlock, { kind: K }>): KalamSpec => ({
  ...tailor, aiBlocks: { step: b as KalamAIBlock },
});

async function blockRequest(spec: KalamSpec, text: string): Promise<StructuredRequest<unknown> | undefined> {
  const rec = recorder();
  await createAIBlockService({ ai: rec.ai }).run({
    appId: spec.id, blockId: 'step', block: spec.aiBlocks.step!, spec, formValues: { notes: text },
  });
  return rec.last();
}

/** Notes a person might keep in an order book, each with words a good summary keeps. */
const NOTES: Array<[id: string, note: string, keep: string[]]> = [
  ['s01', 'Raju came by on Monday and wants the blue kurta stitched by Friday. He paid 500 rupees in advance and will pay the rest on delivery.', ['raju', 'blue', 'friday', 'kurta']],
  ['s02', 'Meena asked for two blouses in red silk. The sleeves should be short and the delivery is for the wedding on the 12th.', ['meena', 'blouse', 'red', 'wedding']],
  ['s03', 'The shop will be closed on Sunday for a family function. Orders due that day move to Tuesday morning.', ['sunday', 'closed', 'tuesday']],
  ['s04', 'Customer wants the trousers shortened by two inches and the waist taken in. He will come for a trial on Thursday evening.', ['trousers', 'waist', 'thursday']],
  ['s05', 'We ran out of white thread and buttons. Ask the supplier to bring 20 buttons and 5 reels of thread before the weekend.', ['thread', 'buttons', 'supplier']],
  ['s06', 'Sunita paid the full amount for the green saree blouse today. Please mark her order as paid and give her the receipt.', ['sunita', 'paid', 'blouse']],
  ['s07', 'The new helper starts on the first of next month. He should learn buttonholes first and then simple hems.', ['helper', 'buttonholes', 'hems']],
  ['s08', 'A school asked for 40 uniforms in grey and white. The price is 450 each and they need them in three weeks.', ['uniforms', '40', 'three weeks']],
  ['s09', 'Anil said the sherwani was too tight at the shoulders. We will loosen it and he will pick it up Saturday.', ['anil', 'sherwani', 'saturday']],
  ['s10', 'The machine near the window is making a loud noise. Call the mechanic and do not use it until it is fixed.', ['machine', 'mechanic']],
  ['s11', 'Priya wants a lehenga with gold work on the border. She will bring her own fabric on Wednesday.', ['priya', 'lehenga', 'wednesday']],
  ['s12', 'Rent for the shop is due on the fifth. Keep 12000 aside from this week sales and pay on time.', ['rent', '12000']],
  ['s13', 'Two customers complained about late delivery this week. Next week call each one a day before the due date.', ['late', 'delivery', 'call']],
  ['s14', 'Farid left his coat for a new lining. The old lining was torn at the back, and he wants a black one.', ['farid', 'coat', 'lining', 'black']],
  ['s15', 'We got a bulk order for 15 kurtas from the temple committee. They want them in saffron cotton by the festival.', ['kurtas', 'saffron', 'festival']],
  ['s16', 'Reminder to take measurements of the twins again. They have grown a lot since the last order in June.', ['twins', 'measurements']],
  ['s17', 'The delivery boy will start at 9. Hand him the packed orders in the order of the route list pinned on the wall.', ['delivery', 'route']],
  ['s18', 'Kavita changed her mind and wants cream instead of pink. The fabric is already cut so ask if she accepts a small charge.', ['kavita', 'cream', 'charge']],
  ['s19', 'Discount of ten percent for customers who bring two or more orders together. Put the notice near the counter.', ['discount', 'ten percent', 'notice']],
  ['s20', 'Iron all finished pieces before packing them. Wrap each set in paper and write the customer name on it.', ['iron', 'wrap', 'name']],
];

async function summarizeCases(): Promise<Array<BenchCase<unknown>>> {
  const spec = block({ kind: 'summarise', prompt: 'Summarise the note.', verified: 'onDevice', inputField: 'notes', outputField: 'notes', maxWords: 25 });
  const out: Array<BenchCase<unknown>> = [];
  for (const [id, note, keep] of NOTES) {
    const request = await blockRequest(spec, note);
    if (!request) continue;
    const judge = (o: unknown): Verdict => {
      const summary = String((o as Record<string, unknown>).notes ?? '');
      // A number in the summary that the note does not have (as digits or as a word) is made up.
      const had = numbersIn(note);
      if (numbersIn(summary).some((n) => !had.includes(n))) return 'invented';
      return has(summary, keep.slice(0, 2)) && norm(summary).split(' ').length <= 25 && norm(summary).length < norm(note).length ? 'right' : 'wrong';
    };
    out.push({ id, request, judge });
  }
  return out;
}

/** English notes to Spanish (keywords) or Japanese (script and numbers kept). Chrome's Prompt API speaks English, Spanish and Japanese. */
const TRANSLATE: Array<[id: string, to: 'es' | 'ja', text: string, expect: string[]]> = [
  ['t01', 'es', 'Buy milk and bread tomorrow morning.', ['leche']],
  ['t02', 'es', 'The order is ready for pickup.', ['pedido', 'orden']],
  ['t03', 'es', 'Please call the customer before delivery.', ['cliente', 'llam']],
  ['t04', 'es', 'The shop is closed on Sunday.', ['domingo']],
  ['t05', 'es', 'Pay the rent on the fifth of the month.', ['alquiler', 'renta']],
  ['t06', 'es', 'The blue shirt needs a new button.', ['camisa', 'boton']],
  ['t07', 'es', 'We are out of white thread.', ['hilo']],
  ['t08', 'es', 'Thank you for your order.', ['gracias']],
  ['t09', 'es', 'The meeting is at ten in the morning.', ['reunion', 'diez']],
  ['t10', 'es', 'Add two kilos of rice to the list.', ['arroz']],
  ['t11', 'es', 'Your payment was received today.', ['pago']],
  ['t12', 'es', 'Deliver the package to the front door.', ['paquete', 'puerta']],
  ['t13', 'ja', 'The order is ready.', ['注文']],
  ['t14', 'ja', 'Thank you very much.', ['ありがとう']],
  ['t15', 'ja', 'The shop is closed today.', ['店', '閉']],
  ['t16', 'ja', 'Please pay 500 yen at the counter.', ['500']],
  ['t17', 'ja', 'Buy 3 apples tomorrow.', ['3', 'りんご', 'リンゴ']],
  ['t18', 'ja', 'The delivery arrives on Friday.', ['金曜', '配達', '届']],
  ['t19', 'ja', 'Call me after lunch.', ['電話', '昼']],
  ['t20', 'ja', 'The meeting starts at 10.', ['10', '会議']],
];

async function translateCases(): Promise<Array<BenchCase<unknown>>> {
  const out: Array<BenchCase<unknown>> = [];
  for (const [id, to, text, expect] of TRANSLATE) {
    const spec = block({ kind: 'translate', prompt: 'Translate the note.', verified: 'onDevice', inputField: 'notes', outputField: 'notes', targetLang: to });
    const request = await blockRequest(spec, text);
    if (!request) continue;
    // The device model is told which languages to expect, as the app does for this task (prompt-io.ts).
    (request as { languages?: readonly string[] }).languages = ['en', to];
    const judge = (o: unknown): Verdict => {
      const t = String((o as Record<string, unknown>).notes ?? '');
      if (norm(t) === norm(text)) return 'wrong'; // left in English
      if (numbersIn(t).some((n) => !numbersIn(text).includes(n))) return 'invented'; // a number the sentence does not have
      return has(t, expect) ? 'right' : 'wrong';
    };
    out.push({ id, request, judge });
  }
  return out;
}

const BUILDERS: Partial<Record<LocalTask, () => Array<BenchCase<unknown>> | Promise<Array<BenchCase<unknown>>>>> = {
  voice_action: voiceCases,
  summarize: summarizeCases,
  translate: translateCases,
};

/** Tasks that have a case set here. `classify` has its own, built from the labelled request sets (scripts/local-ready.mjs). */
export const LOCAL_CASE_TASKS = Object.keys(BUILDERS) as LocalTask[];

export async function buildCases(task: LocalTask): Promise<Array<BenchCase<unknown>>> {
  const build = BUILDERS[task];
  if (!build) throw new Error(`No case set for "${task}".`);
  return build();
}

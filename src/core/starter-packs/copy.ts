/**
 * Every sentence of the starter packs (docs/14 §20): who each pack is for and the short walk through it that a new
 * person reads before opening their first app. Plain words, no em dashes, no exclamation marks. The health pack says
 * plainly what it is not (docs/14 §20.2).
 */
export type PackId = 'retail_kirana' | 'tailoring' | 'education' | 'clinics' | 'home';

export interface PackCopy {
  title: string;
  tagline: string;
  /** Who the pack is for (docs/14 §20.4: every pack has a defined target user). */
  audience: string;
  welcome: string;
  steps: Array<{ title: string; body: string }>;
  tips: string[];
  /** A plain warning shown before the pack is installed. */
  notice?: string;
}

const OFFLINE = 'Every app works with no signal, and what you write stays on this phone.';
const LARGE = 'If the text is hard to read, turn on Large mode in Settings. Every app follows it.';
const VOICE = 'You can say an entry out loud in English or Hindi instead of typing it, where your phone supports it.';

export const PACK_COPY: Record<PackId, PackCopy> = {
  retail_kirana: {
    title: 'Kirana and Retail',
    tagline: 'Credit, sales, stock and suppliers for a small shop.',
    audience: 'Shop owners who run a kirana store or a small counter and keep their accounts in a notebook.',
    welcome: `Five apps for the day of a shop. ${OFFLINE}`,
    steps: [
      { title: 'Add the customers who buy on credit', body: 'Open Kirana Credit Book and add your regular customers. Each one gets a page with what they owe you.' },
      { title: 'Write each sale', body: 'Open Daily Sales and add a sale with how it was paid. Today, this week and this month add up on their own.' },
      { title: 'List what is on your shelf', body: 'Open Inventory Manager and add your main items with a reorder level. Items that run low are listed first.' },
      { title: 'Note your suppliers', body: 'Open Supplier List and add phone numbers, visit days and what you owe each supplier.' },
    ],
    tips: [LARGE, VOICE, 'Use GST Calculator at the counter when a customer asks for a bill with tax.'],
  },
  tailoring: {
    title: 'Tailoring',
    tagline: 'Measurements, orders, deliveries and payments for a tailor.',
    audience: 'Tailors and boutique owners who take measurements and orders from customers and deliver on a date.',
    welcome: `Four apps that follow an order from the first fitting to the last payment. ${OFFLINE}`,
    steps: [
      { title: 'Write down the measurements', body: 'Open Tailor Book and add a customer with their measurements in inches. Open it again at the next order.' },
      { title: 'Take the order', body: 'Open Tailor Order Book and add what was ordered, the delivery date, the price and the advance you took.' },
      { title: 'Keep track of deliveries', body: 'Open Delivery Tracker and tick each delivery when it goes out. It can remind you the day before.' },
      { title: 'Note every payment', body: 'Open Payment Ledger to write money received and money paid, so you can see the month at a glance.' },
    ],
    tips: [LARGE, VOICE, 'Make a copy of any app from the shelf if you work from two shops.'],
  },
  education: {
    title: 'Tutors and Teachers',
    tagline: 'Students, attendance, fees, homework and marks.',
    audience: 'Home tutors, coaching class owners and teachers who look after a small group of students.',
    welcome: `Five apps for a small class. ${OFFLINE}`,
    steps: [
      { title: 'Add your students', body: 'Open Student Register and add each student with their class, parent and phone number.' },
      { title: 'Mark attendance', body: 'Open Attendance Register, add your students once, then open a student and mark them present or absent each day.' },
      { title: 'Track the fees', body: 'Open Fee Tracker and add what each student owes for the month. The list of pending fees is always one tap away.' },
      { title: 'Set homework and note marks', body: 'Use Homework Tracker for what is due and Student Progress Tracker for test marks and averages.' },
    ],
    tips: [LARGE, VOICE, 'Keep each class in its own copy of an app if you teach more than one batch.'],
  },
  clinics: {
    title: 'Clinics',
    tagline: 'Appointments, visits and follow-ups for a small clinic.',
    audience: 'Small clinics and practitioners who want a simple book for appointments, visits and who to call back.',
    welcome: `Three apps for the front desk of a small clinic. ${OFFLINE}`,
    steps: [
      { title: 'Book appointments', body: 'Open Appointment Tracker and add a name, a date and a time. Today’s appointments are listed first.' },
      { title: 'Log each visit', body: 'Open Visit Register to write who came, why, any short note you want to keep and a fee if you take one.' },
      { title: 'Remember who to call back', body: 'Open Follow-up List and add the date. Tick a person off once you have checked in. It can remind you the day before.' },
    ],
    tips: [LARGE, VOICE, 'Keep notes short. These apps are a simple book, not a place for full case histories.'],
    notice:
      'These apps keep only what you type, on this phone. They give no medical advice and are not a medical record system. Before you keep real patient details, check the privacy rules that apply to you.',
  },
  home: {
    title: 'Home',
    tagline: 'Budget, groceries, medicines, bills and daily tasks.',
    audience: 'Families and individuals who want to run a household without a stack of notes and messages.',
    welcome: `Five small apps for a home. ${OFFLINE}`,
    steps: [
      { title: 'Start the budget', body: 'Open Household Budget and add this month’s income, then add what you spend. It shows what is left.' },
      { title: 'Make the grocery list', body: 'Open Grocery List and add what to buy. Tick it off in the shop.' },
      { title: 'Never miss a bill', body: 'Open Bill Reminders and add each bill with its due date. Tick it when it is paid.' },
      { title: 'Keep medicines on track', body: 'Open Medicine Tracker, add the medicines you take and mark each dose. It records what you enter and gives no medical advice.' },
    ],
    tips: [LARGE, VOICE, 'Daily Task List is for anything else that needs doing today.'],
  },
};

export const PACK_UI = {
  installAll: (n: number): string => (n === 1 ? 'Add this app' : `Add all ${n} apps`),
  installed: 'On your shelf',
  alreadyInstalled: 'Already on your shelf',
  adding: 'Adding apps',
  doneAll: (n: number): string => (n === 1 ? '1 app added to your shelf' : `${n} apps added to your shelf`),
  doneSome: (added: number, skipped: number): string =>
    `${added === 1 ? '1 app' : `${added} apps`} added. ${skipped === 1 ? '1 was' : `${skipped} were`} already on your shelf.`,
  nothingNew: 'Every app in this pack is already on your shelf.',
  failed: (n: number): string => (n === 1 ? '1 app could not be added. Try again.' : `${n} apps could not be added. Try again.`),
  appsIn: (n: number): string => (n === 1 ? '1 app' : `${n} apps`),
} as const;

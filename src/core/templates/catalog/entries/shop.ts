/** Shop and trade apps: credit book, daily sales, suppliers, tailor orders, deliveries, payments, follow-ups. */
import type { CatalogEntry } from '../types';
import { fld, type TableAppDef } from '../builder';
import { AUTHOR, row, rupees, tableEntry } from './helpers';

const WEEKDAYS = ['Any day', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const kirana: TableAppDef = {
  id: 'kirana_credit_book',
  name: 'Kirana Credit Book',
  description: 'Who owes you, how much, and what they have paid back. Each customer has their own page.',
  glyph: 'notebook', theme: 'warm_paper', currency: 'INR', author: AUTHOR,
  tags: ['credit', 'udhaar', 'khata', 'shop'],
  accessibility: {
    summary: 'A credit book for a shop. It shows what each customer owes and lets you add credit or a payment in a few taps.',
    suggestedModes: ['large'],
  },
  stats: [
    { id: 'still_to_collect', label: 'Still to collect', ...rupees, expr: "sum(filter(entries, kind == 'Credit given').amount) - sum(filter(entries, kind == 'Payment received').amount)" },
    { id: 'credit_given', label: 'Credit given', ...rupees, expr: "sum(filter(entries, kind == 'Credit given').amount)" },
    { id: 'payments_received', label: 'Payments received', ...rupees, expr: "sum(filter(entries, kind == 'Payment received').amount)" },
    { id: 'customer_count', label: 'Customers', format: 'integer', secondary: true, expr: 'count(customers)' },
  ],
  tables: [
    {
      id: 'customers', label: 'Customers', noun: 'customer', addLabel: 'Add customer',
      fields: { name: fld.text('Name', { required: true }), phone: fld.text('Phone'), note: fld.text('Note', { multiline: true }) },
      primary: 'name', secondary: 'phone', sort: { field: 'name', direction: 'asc' },
      stats: [
        { id: 'customer_owes', label: 'Owes you now', ...rupees, expr: "sum(filter(entries, customer == selected && kind == 'Credit given').amount) - sum(filter(entries, customer == selected && kind == 'Payment received').amount)" },
        { id: 'customer_entry_count', label: 'Entries', format: 'integer', secondary: true, expr: 'count(filter(entries, customer == selected))' },
      ],
      deleteConfirm: 'Delete this customer? Remove their entries first. This cannot be undone.',
      voice: { add: ['naya customer', 'नया ग्राहक'] },
    },
    {
      id: 'entries', label: 'Entries', noun: 'entry', addLabel: 'New entry',
      fields: {
        customer: fld.link('Customer', 'customers', 'name'),
        kind: fld.pick('Type', ['Credit given', 'Payment received'], { required: true, defaultValue: 'Credit given' }),
        amount: fld.num('Amount', { required: true, unit: '₹', decimals: 2 }),
        date: fld.date('Date', { required: true, today: true }),
        note: fld.text('Note'),
      },
      primary: 'customer', secondary: 'amount', sort: { field: 'date', direction: 'desc' },
      lists: [{ label: 'Recent entries', limit: 30 }],
      under: { primary: 'kind', secondary: 'amount', label: 'Entries' },
      voice: { add: ['naya udhaar', 'udhaar likho', 'नया उधार'] },
    },
  ],
};

const sales: TableAppDef = {
  id: 'daily_sales',
  name: 'Daily Sales',
  description: 'Write each sale as it happens. See today, this week and this month at a glance.',
  glyph: 'shopping_cart', theme: 'calm_green', currency: 'INR', author: AUTHOR,
  tags: ['sales', 'shop', 'bikri'],
  accessibility: { summary: 'A sales book. Add each sale with its amount and how it was paid, and see the totals for today, this week and this month.', suggestedModes: ['large'] },
  stats: [
    { id: 'sales_today', label: 'Sold today', ...rupees, expr: 'sum(filter(sales, date == today).amount)' },
    { id: 'sales_week', label: 'This week', ...rupees, expr: 'sum(filter(sales, week(date) == week(today)).amount)' },
    { id: 'sales_month', label: 'This month', ...rupees, expr: 'sum(filter(sales, month(date) == month(today)).amount)' },
    { id: 'bills_today', label: 'Sales today', format: 'integer', secondary: true, expr: 'count(filter(sales, date == today))' },
    { id: 'cash_today', label: 'Cash today', ...rupees, secondary: true, expr: "sum(filter(sales, date == today && mode == 'Cash').amount)" },
    { id: 'upi_today', label: 'UPI today', ...rupees, secondary: true, expr: "sum(filter(sales, date == today && mode == 'UPI').amount)" },
  ],
  extras: [
    { id: 'sales_chart', type: 'chart', label: 'Sales, last 7 days', chart: 'bar', source: 'sales', metric: 'sum', valueField: 'amount', period: 'day', dateField: 'date', range: { last: 7, unit: 'day' } },
  ],
  tables: [{
    id: 'sales', label: 'Sales', noun: 'sale', addLabel: 'Add sale',
    fields: {
      amount: fld.num('Amount', { required: true, unit: '₹', decimals: 2 }),
      mode: fld.pick('Paid by', ['Cash', 'UPI', 'Card', 'On credit'], { required: true, defaultValue: 'Cash' }),
      date: fld.date('Date', { required: true, today: true }),
      note: fld.text('What was sold'),
    },
    primary: 'mode', secondary: 'amount', sort: { field: 'date', direction: 'desc' },
    lists: [{ label: 'Latest sales', limit: 40 }],
    voice: { add: ['naya bill', 'bikri likho', 'नई बिक्री'] },
  }],
};

const suppliers: TableAppDef = {
  id: 'supplier_list',
  name: 'Supplier List',
  description: 'Your suppliers, their numbers, what they bring, which day they visit and what you owe them.',
  glyph: 'package', theme: 'minimal_neutral', currency: 'INR', author: AUTHOR,
  tags: ['suppliers', 'shop', 'vendors'],
  accessibility: { summary: 'A list of suppliers with phone numbers, visit days and the amount owed to each.', suggestedModes: [] },
  stats: [
    { id: 'supplier_count', label: 'Suppliers', format: 'integer', expr: 'count(suppliers)' },
    { id: 'owed_total', label: 'You owe in total', ...rupees, expr: 'sum(suppliers.owed)' },
  ],
  tables: [{
    id: 'suppliers', label: 'Suppliers', noun: 'supplier', addLabel: 'Add supplier',
    fields: {
      name: fld.text('Name', { required: true }),
      phone: fld.text('Phone'),
      supplies: fld.text('What they supply'),
      visit_day: fld.pick('Visit day', WEEKDAYS, { defaultValue: 'Any day' }),
      owed: fld.num('You owe them', { unit: '₹', decimals: 2 }),
      note: fld.text('Note', { multiline: true }),
    },
    primary: 'name', secondary: 'supplies', sort: { field: 'name', direction: 'asc' },
    lists: [{ label: 'You owe money to', filter: 'owed > 0', emptyText: 'You owe nobody right now.' }, { label: 'All suppliers' }],
    voice: { add: ['naya supplier', 'नया सप्लायर'] },
  }],
};

const tailorOrders: TableAppDef = {
  id: 'tailor_order_book',
  name: 'Tailor Order Book',
  description: 'Orders from first fitting to delivery: what was ordered, when it is due and the balance still to collect.',
  glyph: 'scissors', theme: 'warm_paper', currency: 'INR', author: AUTHOR,
  tags: ['tailor', 'orders', 'darzi'],
  accessibility: { summary: 'An order book for a tailor. Each order has a delivery date, a stage and the advance taken.', suggestedModes: ['large'] },
  stats: [
    { id: 'open_orders', label: 'Open orders', format: 'integer', expr: "count(filter(orders, stage != 'Delivered'))" },
    { id: 'ready_orders', label: 'Ready for pickup', format: 'integer', expr: "count(filter(orders, stage == 'Ready'))" },
    { id: 'due_this_week', label: 'Due this week', format: 'integer', expr: "count(filter(orders, stage != 'Delivered' && week(delivery) == week(today)))" },
    { id: 'balance_to_collect', label: 'Balance on open orders', ...rupees, expr: "sum(filter(orders, stage != 'Delivered').total) - sum(filter(orders, stage != 'Delivered').advance)" },
  ],
  tables: [{
    id: 'orders', label: 'Orders', noun: 'order', addLabel: 'New order',
    fields: {
      customer: fld.text('Customer', { required: true }),
      phone: fld.text('Phone'),
      garment: fld.pick('Garment', ['Shirt', 'Trouser', 'Kurta', 'Blouse', 'Suit', 'Other'], { required: true, defaultValue: 'Shirt' }),
      ordered: fld.date('Ordered on', { today: true }),
      delivery: fld.date('Delivery date', { required: true }),
      total: fld.num('Total price', { unit: '₹', decimals: 2 }),
      advance: fld.num('Advance taken', { unit: '₹', decimals: 2 }),
      stage: fld.pick('Stage', ['Received', 'Cutting', 'Stitching', 'Ready', 'Delivered'], { required: true, defaultValue: 'Received' }),
      note: fld.text('Note', { multiline: true }),
    },
    primary: 'customer', secondary: 'delivery',
    lists: [
      { label: 'Open orders', filter: "stage != 'Delivered'", sort: { field: 'delivery', direction: 'asc' }, emptyText: 'No open orders. Tap “New order” to add one.' },
      { label: 'Delivered', filter: "stage == 'Delivered'", sort: { field: 'delivery', direction: 'desc' }, limit: 20 },
    ],
    setTo: { field: 'stage', value: 'Delivered', label: 'Mark delivered', feedback: 'Marked as delivered' },
    voice: { add: ['naya order', 'नया ऑर्डर'] },
  }],
};

const deliveries: TableAppDef = {
  id: 'delivery_tracker',
  name: 'Delivery Tracker',
  description: 'What has to go out and when. Tick it off when it is delivered, and get a reminder the day before.',
  glyph: 'package', theme: 'ocean_blue', author: AUTHOR,
  tags: ['delivery', 'tailor', 'orders'],
  accessibility: { summary: 'A delivery list. Tick an item when it has been delivered. It can remind you the day before.', suggestedModes: ['large'] },
  stats: [
    { id: 'due_today', label: 'Due today', format: 'integer', expr: 'count(filter(deliveries, due == today && delivered == false))' },
    { id: 'overdue', label: 'Overdue', format: 'integer', expr: 'count(filter(deliveries, due < today && delivered == false))' },
    { id: 'delivered_month', label: 'Delivered this month', format: 'integer', secondary: true, expr: 'count(filter(deliveries, delivered == true && month(due) == month(today)))' },
  ],
  extras: [
    { id: 'delivery_reminder', type: 'reminder', label: 'Remind me the day before', source: 'deliveries', dateField: 'due', leadDays: 1, time: '09:00', doneField: 'delivered', titleField: 'what', message: 'Deliver {title} tomorrow' },
  ],
  tables: [{
    id: 'deliveries', label: 'Deliveries', noun: 'delivery', addLabel: 'Add delivery',
    fields: {
      what: fld.text('What is being delivered', { required: true }),
      customer: fld.text('Customer'),
      due: fld.date('Due on', { required: true, today: true }),
      delivered: fld.yes('Delivered'),
      delivered_on: fld.date('Delivered on'),
      note: fld.text('Note', { multiline: true }),
    },
    primary: 'what', secondary: 'due',
    lists: [
      { label: 'To deliver', filter: 'delivered == false', sort: { field: 'due', direction: 'asc' }, toggleField: 'delivered', emptyText: 'Nothing waiting to go out.' },
      { label: 'Delivered', filter: 'delivered == true', sort: { field: 'due', direction: 'desc' }, limit: 20, toggleField: 'delivered' },
    ],
    setTo: { field: 'delivered', value: true, label: 'Mark delivered', feedback: 'Marked as delivered' },
    voice: { add: ['new delivery', 'नई डिलीवरी'] },
  }],
};

const ledger: TableAppDef = {
  id: 'payment_ledger',
  name: 'Payment Ledger',
  description: 'Money received and money paid, with how it was paid. See the month at a glance.',
  glyph: 'wallet', theme: 'calm_green', currency: 'INR', author: AUTHOR,
  tags: ['payments', 'ledger', 'money'],
  accessibility: { summary: 'A ledger of payments received and paid, with monthly totals.', suggestedModes: [] },
  stats: [
    { id: 'received_month', label: 'Received this month', ...rupees, expr: "sum(filter(payments, direction == 'Received' && month(date) == month(today)).amount)" },
    { id: 'paid_month', label: 'Paid this month', ...rupees, expr: "sum(filter(payments, direction == 'Paid' && month(date) == month(today)).amount)" },
    { id: 'net_month', label: 'Left this month', ...rupees, expr: "sum(filter(payments, direction == 'Received' && month(date) == month(today)).amount) - sum(filter(payments, direction == 'Paid' && month(date) == month(today)).amount)" },
    { id: 'net_all', label: 'Left in total', ...rupees, secondary: true, expr: "sum(filter(payments, direction == 'Received').amount) - sum(filter(payments, direction == 'Paid').amount)" },
  ],
  tables: [{
    id: 'payments', label: 'Payments', noun: 'payment', addLabel: 'Add payment',
    fields: {
      party: fld.text('Who', { required: true }),
      direction: fld.pick('Received or paid', ['Received', 'Paid'], { required: true, defaultValue: 'Received' }),
      amount: fld.num('Amount', { required: true, unit: '₹', decimals: 2 }),
      mode: fld.pick('Paid by', ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'], { defaultValue: 'Cash' }),
      date: fld.date('Date', { required: true, today: true }),
      note: fld.text('Note'),
    },
    primary: 'party', secondary: 'amount', sort: { field: 'date', direction: 'desc' },
    lists: [{ label: 'Latest payments', limit: 40 }],
    voice: { add: ['naya payment', 'नया भुगतान'] },
  }],
};

const followUps: TableAppDef = {
  id: 'customer_followup_book',
  name: 'Customer Follow-up Book',
  description: 'Who to call back and when. See everyone who is due today and what happened last time.',
  glyph: 'users', theme: 'ocean_blue', author: AUTHOR,
  tags: ['customers', 'follow up', 'leads'],
  accessibility: { summary: 'A follow-up book. It lists the customers you should contact today and keeps notes from each conversation.', suggestedModes: [] },
  stats: [
    { id: 'follow_now', label: 'Follow up now', format: 'integer', expr: "count(filter(followups, next <= today && stage != 'Won' && stage != 'Lost'))" },
    { id: 'open_leads', label: 'Still open', format: 'integer', expr: "count(filter(followups, stage != 'Won' && stage != 'Lost'))" },
    { id: 'won_month', label: 'Won this month', format: 'integer', secondary: true, expr: "count(filter(followups, stage == 'Won' && month(last_contact) == month(today)))" },
  ],
  tables: [{
    id: 'followups', label: 'Customers', noun: 'customer', addLabel: 'Add customer',
    fields: {
      name: fld.text('Name', { required: true }),
      phone: fld.text('Phone'),
      topic: fld.text('About'),
      last_contact: fld.date('Last spoke on', { today: true }),
      next: fld.date('Follow up on', { required: true, today: true }),
      stage: fld.pick('Stage', ['New', 'In talks', 'Won', 'Lost'], { required: true, defaultValue: 'New' }),
      note: fld.text('Note', { multiline: true }),
    },
    primary: 'name', secondary: 'next',
    lists: [
      { label: 'Follow up now', filter: "next <= today && stage != 'Won' && stage != 'Lost'", sort: { field: 'next', direction: 'asc' }, emptyText: 'Nobody is waiting for a call.' },
      { label: 'Everyone', sort: { field: 'next', direction: 'asc' } },
    ],
    setTo: { field: 'stage', value: 'Won', label: 'Mark as won', feedback: 'Marked as won' },
    voice: { add: ['new lead', 'naya customer', 'नया ग्राहक'] },
  }],
};

export const SHOP_ENTRIES: CatalogEntry[] = [
  tableEntry(kirana, {
    category: 'shop',
    keywords: ['kirana', 'credit', 'udhaar', 'udhar', 'khata', 'ledger', 'customers owe', 'dukaan', 'उधार', 'खाता'],
    records: {
      customers: [
        row({ name: 'Ramesh Kumar', phone: '98xxxxxx01' }, 'ramesh'),
        row({ name: 'Sunita Devi', phone: '98xxxxxx02' }, 'sunita'),
        row({ name: 'Anil Traders', phone: '98xxxxxx03', note: 'Pays on the first of the month' }, 'anil'),
      ],
      entries: [
        row({ customer: '>ramesh', kind: 'Credit given', amount: 850, date: '~-9', note: 'Rice and oil' }),
        row({ customer: '>sunita', kind: 'Credit given', amount: 420, date: '~-7', note: 'Groceries' }),
        row({ customer: '>ramesh', kind: 'Payment received', amount: 300, date: '~-5' }),
        row({ customer: '>anil', kind: 'Credit given', amount: 2400, date: '~-4', note: 'Monthly supplies' }),
        row({ customer: '>sunita', kind: 'Payment received', amount: 420, date: '~-2', note: 'Cleared' }),
        row({ customer: '>ramesh', kind: 'Credit given', amount: 160, date: '~0' }),
      ],
    },
  }),
  tableEntry(sales, {
    category: 'shop',
    keywords: ['sales', 'daily sales', 'bikri', 'bill', 'shop', 'takings', 'बिक्री'],
    records: {
      sales: [
        row({ amount: 640, mode: 'Cash', date: '~-6', note: 'Grocery' }), row({ amount: 1250, mode: 'UPI', date: '~-5' }),
        row({ amount: 310, mode: 'Cash', date: '~-4' }), row({ amount: 980, mode: 'Card', date: '~-3' }),
        row({ amount: 1520, mode: 'UPI', date: '~-2' }), row({ amount: 430, mode: 'Cash', date: '~-1' }),
        row({ amount: 760, mode: 'Cash', date: '~0' }), row({ amount: 1180, mode: 'UPI', date: '~0' }),
        row({ amount: 220, mode: 'On credit', date: '~0', note: 'For Ramesh' }),
      ],
    },
  }),
  tableEntry(suppliers, {
    category: 'shop',
    keywords: ['supplier', 'suppliers', 'vendor', 'wholesaler', 'distributor', 'dealer', 'सप्लायर'],
    records: {
      suppliers: [
        row({ name: 'Gupta Wholesale', phone: '98xxxxxx11', supplies: 'Rice, flour, pulses', visit_day: 'Monday', owed: 5400 }),
        row({ name: 'Fresh Dairy', phone: '98xxxxxx12', supplies: 'Milk and curd', visit_day: 'Any day', owed: 0 }),
        row({ name: 'City Snacks', phone: '98xxxxxx13', supplies: 'Biscuits, chips', visit_day: 'Thursday', owed: 1850 }),
      ],
    },
  }),
  tableEntry(tailorOrders, {
    category: 'shop',
    keywords: ['tailor', 'tailoring', 'darzi', 'order book', 'stitching', 'orders', 'boutique', 'दर्जी'],
    records: {
      orders: [
        row({ customer: 'Meena Joshi', phone: '98xxxxxx21', garment: 'Blouse', ordered: '~-8', delivery: '~+2', total: 600, advance: 200, stage: 'Stitching' }),
        row({ customer: 'Rahul Sharma', phone: '98xxxxxx22', garment: 'Suit', ordered: '~-12', delivery: '~+5', total: 4500, advance: 1500, stage: 'Cutting' }),
        row({ customer: 'Farah Khan', phone: '98xxxxxx23', garment: 'Kurta', ordered: '~-10', delivery: '~0', total: 900, advance: 900, stage: 'Ready' }),
        row({ customer: 'Dinesh Patel', phone: '98xxxxxx24', garment: 'Shirt', ordered: '~-15', delivery: '~-3', total: 700, advance: 700, stage: 'Delivered' }),
      ],
    },
  }),
  tableEntry(deliveries, {
    category: 'shop',
    keywords: ['delivery', 'deliveries', 'pickup', 'dispatch', 'deliver', 'delivery date', 'डिलीवरी'],
    records: {
      deliveries: [
        row({ what: 'Blouse for Meena', customer: 'Meena Joshi', due: '~+2', delivered: false }),
        row({ what: 'Kurta for Farah', customer: 'Farah Khan', due: '~0', delivered: false }),
        row({ what: 'Suit for Rahul', customer: 'Rahul Sharma', due: '~-1', delivered: false, note: 'Waiting for buttons' }),
        row({ what: 'Shirt for Dinesh', customer: 'Dinesh Patel', due: '~-3', delivered: true, delivered_on: '~-3' }),
      ],
    },
  }),
  tableEntry(ledger, {
    category: 'shop',
    keywords: ['payment', 'payments', 'ledger', 'received', 'paid', 'bhugtan', 'cash book', 'भुगतान'],
    records: {
      payments: [
        row({ party: 'Meena Joshi', direction: 'Received', amount: 200, mode: 'UPI', date: '^0' }),
        row({ party: 'Cloth Merchant', direction: 'Paid', amount: 3200, mode: 'Bank transfer', date: '^1' }),
        row({ party: 'Farah Khan', direction: 'Received', amount: 900, mode: 'Cash', date: '^2' }),
        row({ party: 'Shop rent', direction: 'Paid', amount: 5000, mode: 'UPI', date: '^3' }),
        row({ party: 'Rahul Sharma', direction: 'Received', amount: 1500, mode: 'UPI', date: '~0' }),
      ],
    },
  }),
  tableEntry(followUps, {
    category: 'work',
    keywords: ['follow up', 'follow-up', 'customers', 'leads', 'callback', 'sales leads', 'crm', 'customer follow up'],
    records: {
      followups: [
        row({ name: 'Sanjay Mehta', phone: '98xxxxxx31', topic: 'Bulk order quote', last_contact: '~-6', next: '~0', stage: 'In talks' }),
        row({ name: 'Pooja Nair', phone: '98xxxxxx32', topic: 'Delivery question', last_contact: '~-3', next: '~+2', stage: 'New' }),
        row({ name: 'Imran Qureshi', phone: '98xxxxxx33', topic: 'Price list', last_contact: '~-10', next: '~-2', stage: 'In talks' }),
        row({ name: 'Leela Rao', phone: '98xxxxxx34', topic: 'Repeat order', last_contact: '~-1', next: '~+14', stage: 'Won' }),
      ],
    },
  }),
];

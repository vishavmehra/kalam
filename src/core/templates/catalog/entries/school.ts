/** School and tutoring apps: attendance, student register, fees, homework, marks. */
import type { CatalogEntry } from '../types';
import { fld, type TableAppDef } from '../builder';
import { AUTHOR, row, rupees, tableEntry } from './helpers';

const attendance: TableAppDef = {
  id: 'attendance_register',
  name: 'Attendance Register',
  description: 'Mark each student present, absent, late or on leave. See today at a glance and each student’s attendance.',
  glyph: 'clipboard', theme: 'ocean_blue', author: AUTHOR,
  tags: ['attendance', 'school', 'students', 'hazri'],
  accessibility: { summary: 'An attendance register. Open a student, mark them present or absent for the day, and see their attendance rate.', suggestedModes: ['large'] },
  stats: [
    { id: 'present_today', label: 'Present today', format: 'integer', expr: "count(filter(attendance, date == today && status == 'Present'))" },
    { id: 'absent_today', label: 'Absent today', format: 'integer', expr: "count(filter(attendance, date == today && status == 'Absent'))" },
    { id: 'marked_today', label: 'Marked today', format: 'integer', secondary: true, expr: 'count(filter(attendance, date == today))' },
    { id: 'overall_rate', label: 'Attendance overall', format: 'percent', expr: "(count(filter(attendance, status == 'Present')) + count(filter(attendance, status == 'Late'))) / count(attendance)" },
    { id: 'student_count', label: 'Students', format: 'integer', secondary: true, expr: 'count(students)' },
  ],
  tables: [
    {
      id: 'students', label: 'Students', noun: 'student', addLabel: 'Add student',
      fields: { name: fld.text('Name', { required: true }), roll: fld.text('Roll number'), class: fld.text('Class') },
      primary: 'name', secondary: 'roll', sort: { field: 'name', direction: 'asc' },
      stats: [
        { id: 'student_present', label: 'Days present', format: 'integer', expr: "count(filter(attendance, student == selected && (status == 'Present' || status == 'Late')))" },
        { id: 'student_absent', label: 'Days absent', format: 'integer', expr: "count(filter(attendance, student == selected && status == 'Absent'))" },
        { id: 'student_rate', label: 'Attendance', format: 'percent', expr: "count(filter(attendance, student == selected && (status == 'Present' || status == 'Late'))) / count(filter(attendance, student == selected))" },
      ],
      deleteConfirm: 'Delete this student and all of their attendance? This cannot be undone.',
      voice: { add: ['naya student', 'नया विद्यार्थी'] },
    },
    {
      id: 'attendance', label: 'Attendance', noun: 'attendance', addLabel: 'Mark attendance',
      fields: {
        student: fld.link('Student', 'students', 'name', { onDelete: 'cascade' }),
        date: fld.date('Date', { required: true, today: true }),
        status: fld.pick('Status', ['Present', 'Absent', 'Late', 'Leave'], { required: true, defaultValue: 'Present' }),
        note: fld.text('Note'),
      },
      primary: 'student', secondary: 'status', sort: { field: 'date', direction: 'desc' },
      lists: [{ label: 'Marked today', filter: 'date == today', emptyText: 'Nobody is marked today yet.' }],
      under: { primary: 'status', secondary: 'date', label: 'Attendance' },
      voice: { add: ['mark attendance', 'hazri lagao', 'हाज़िरी लगाओ'] },
    },
  ],
};

const register: TableAppDef = {
  id: 'student_register',
  name: 'Student Register',
  description: 'Every student with their class, guardian and phone number, in one list.',
  glyph: 'graduation_cap', theme: 'calm_green', author: AUTHOR,
  tags: ['students', 'tutor', 'register'],
  accessibility: { summary: 'A register of students with class, guardian and phone number.', suggestedModes: [] },
  stats: [{ id: 'student_total', label: 'Students', format: 'integer', expr: 'count(students)' }],
  tables: [{
    id: 'students', label: 'Students', noun: 'student', addLabel: 'Add student',
    fields: {
      name: fld.text('Name', { required: true }),
      class: fld.text('Class or batch'),
      subject: fld.text('Subjects'),
      guardian: fld.text('Parent or guardian'),
      phone: fld.text('Phone'),
      joined: fld.date('Joined on', { today: true }),
      note: fld.text('Note', { multiline: true }),
    },
    primary: 'name', secondary: 'class', sort: { field: 'name', direction: 'asc' },
    voice: { add: ['naya student', 'नया विद्यार्थी'] },
  }],
};

const fees: TableAppDef = {
  id: 'fee_tracker',
  name: 'Fee Tracker',
  description: 'Fees due, fees paid and who still owes. A list of pending fees is always one tap away.',
  glyph: 'wallet', theme: 'warm_paper', currency: 'INR', author: AUTHOR,
  tags: ['fees', 'tutor', 'school'],
  accessibility: { summary: 'A fee tracker. It shows what is due this month, what has been collected and which students still owe fees.', suggestedModes: [] },
  stats: [
    { id: 'due_month', label: 'Due this month', ...rupees, expr: 'sum(filter(fees, month(for_month) == month(today)).due)' },
    { id: 'collected_month', label: 'Collected this month', ...rupees, expr: 'sum(filter(fees, month(for_month) == month(today)).paid)' },
    { id: 'pending_total', label: 'Still pending in total', ...rupees, expr: 'sum(fees.due) - sum(fees.paid)' },
  ],
  tables: [{
    id: 'fees', label: 'Fees', noun: 'fee', addLabel: 'Add fee',
    fields: {
      student: fld.text('Student', { required: true }),
      for_month: fld.date('Fee for the month of', { required: true, today: true }),
      due: fld.num('Fee due', { required: true, unit: '₹', decimals: 2 }),
      paid: fld.num('Paid so far', { unit: '₹', decimals: 2, defaultValue: 0 }),
      paid_on: fld.date('Last paid on'),
      note: fld.text('Note'),
    },
    primary: 'student', secondary: 'due', sort: { field: 'for_month', direction: 'desc' },
    lists: [{ label: 'Still to pay', filter: 'paid < due', emptyText: 'Every fee is paid.' }, { label: 'All fees', limit: 40 }],
    voice: { add: ['fee entry', 'naya fee', 'फीस जोड़ो'] },
  }],
};

const homework: TableAppDef = {
  id: 'homework_tracker',
  name: 'Homework Tracker',
  description: 'Homework by subject with a due date. Tick it off when it is done and get a reminder the day before.',
  glyph: 'book', theme: 'soft_lavender', author: AUTHOR,
  tags: ['homework', 'school', 'students'],
  accessibility: { summary: 'A homework list. Each item has a subject and a due date, and you tick it off when it is done.', suggestedModes: [] },
  stats: [
    { id: 'due_today', label: 'Due today', format: 'integer', expr: 'count(filter(homework, due == today && done == false))' },
    { id: 'overdue', label: 'Overdue', format: 'integer', expr: 'count(filter(homework, due < today && done == false))' },
    { id: 'open_total', label: 'Still to do', format: 'integer', secondary: true, expr: 'count(filter(homework, done == false))' },
  ],
  extras: [
    { id: 'homework_reminder', type: 'reminder', label: 'Remind me the day before', source: 'homework', dateField: 'due', leadDays: 1, time: '18:00', doneField: 'done', titleField: 'title', message: 'Homework due tomorrow: {title}' },
  ],
  tables: [{
    id: 'homework', label: 'Homework', noun: 'homework', addLabel: 'Add homework',
    fields: {
      subject: fld.text('Subject', { required: true }),
      title: fld.text('What to do', { required: true }),
      class: fld.text('Class or student'),
      due: fld.date('Due on', { required: true, today: true }),
      done: fld.yes('Done'),
    },
    primary: 'title', secondary: 'due',
    lists: [
      { label: 'To do', filter: 'done == false', sort: { field: 'due', direction: 'asc' }, toggleField: 'done', emptyText: 'No homework waiting.' },
      { label: 'Done', filter: 'done == true', sort: { field: 'due', direction: 'desc' }, limit: 20, toggleField: 'done' },
    ],
    setTo: { field: 'done', value: true, label: 'Mark done', feedback: 'Marked as done' },
    voice: { add: ['add homework', 'naya homework', 'नया होमवर्क'] },
  }],
};

const progress: TableAppDef = {
  id: 'student_progress',
  name: 'Student Progress Tracker',
  description: 'Test marks for each student, with their average and the class average.',
  glyph: 'graduation_cap', theme: 'calm_green', author: AUTHOR,
  tags: ['marks', 'students', 'progress'],
  accessibility: { summary: 'A marks book. Open a student to see their tests and their average, or see the class average on the first page.', suggestedModes: [] },
  stats: [
    { id: 'class_average', label: 'Class average', format: 'percent', expr: 'sum(marks.score) / sum(marks.out_of)' },
    { id: 'tests_recorded', label: 'Tests recorded', format: 'integer', expr: 'count(marks)' },
    { id: 'low_scores', label: 'Scores below 40 percent', format: 'integer', secondary: true, expr: 'count(filter(marks, score / out_of < 0.4))' },
    { id: 'student_total', label: 'Students', format: 'integer', secondary: true, expr: 'count(students)' },
  ],
  tables: [
    {
      id: 'students', label: 'Students', noun: 'student', addLabel: 'Add student',
      fields: { name: fld.text('Name', { required: true }), class: fld.text('Class') },
      primary: 'name', secondary: 'class', sort: { field: 'name', direction: 'asc' },
      stats: [
        { id: 'student_average', label: 'Average', format: 'percent', expr: 'sum(filter(marks, student == selected).score) / sum(filter(marks, student == selected).out_of)' },
        { id: 'student_tests', label: 'Tests taken', format: 'integer', secondary: true, expr: 'count(filter(marks, student == selected))' },
      ],
      deleteConfirm: 'Delete this student and all of their marks? This cannot be undone.',
      voice: { add: ['naya student', 'नया विद्यार्थी'] },
    },
    {
      id: 'marks', label: 'Marks', noun: 'mark', addLabel: 'Add marks',
      fields: {
        student: fld.link('Student', 'students', 'name', { onDelete: 'cascade' }),
        subject: fld.text('Subject', { required: true }),
        test: fld.text('Test'),
        date: fld.date('Date', { today: true }),
        score: fld.num('Marks scored', { required: true, decimals: 1 }),
        out_of: fld.num('Out of', { required: true, decimals: 1, defaultValue: 100 }),
      },
      primary: 'student', secondary: 'score', sort: { field: 'date', direction: 'desc' },
      lists: [{ label: 'Latest marks', limit: 30 }],
      under: { primary: 'subject', secondary: 'score', label: 'Marks' },
      voice: { add: ['add marks', 'marks likho', 'अंक जोड़ो'] },
    },
  ],
};

export const SCHOOL_ENTRIES: CatalogEntry[] = [
  tableEntry(attendance, {
    category: 'school',
    keywords: ['attendance', 'register', 'class', 'present', 'absent', 'students', 'roll call', 'hazri', 'हाज़िरी', 'उपस्थिति'],
    records: {
      students: [
        row({ name: 'Aarav Singh', roll: '1', class: '6A' }, 'aarav'),
        row({ name: 'Diya Patel', roll: '2', class: '6A' }, 'diya'),
        row({ name: 'Kabir Shah', roll: '3', class: '6A' }, 'kabir'),
        row({ name: 'Zoya Ali', roll: '4', class: '6A' }, 'zoya'),
      ],
      attendance: [
        row({ student: '>aarav', date: '~-2', status: 'Present' }), row({ student: '>diya', date: '~-2', status: 'Present' }),
        row({ student: '>kabir', date: '~-2', status: 'Absent', note: 'Fever' }), row({ student: '>zoya', date: '~-2', status: 'Present' }),
        row({ student: '>aarav', date: '~-1', status: 'Late' }), row({ student: '>diya', date: '~-1', status: 'Present' }),
        row({ student: '>kabir', date: '~-1', status: 'Present' }), row({ student: '>zoya', date: '~-1', status: 'Leave' }),
        row({ student: '>aarav', date: '~0', status: 'Present' }), row({ student: '>diya', date: '~0', status: 'Absent' }),
        row({ student: '>kabir', date: '~0', status: 'Present' }),
      ],
    },
  }),
  tableEntry(register, {
    category: 'school',
    keywords: ['student', 'students', 'register', 'tutor', 'tuition', 'class list', 'batch', 'विद्यार्थी'],
    records: {
      students: [
        row({ name: 'Aarav Singh', class: '6A', subject: 'Maths, Science', guardian: 'Mr Singh', phone: '98xxxxxx41', joined: '~-60' }),
        row({ name: 'Diya Patel', class: '7B', subject: 'English', guardian: 'Mrs Patel', phone: '98xxxxxx42', joined: '~-45' }),
        row({ name: 'Kabir Shah', class: '6A', subject: 'Maths', guardian: 'Mr Shah', phone: '98xxxxxx43', joined: '~-20' }),
      ],
    },
  }),
  tableEntry(fees, {
    category: 'school',
    keywords: ['fee', 'fees', 'tuition fee', 'school fees', 'pending fees', 'tutor', 'collection', 'फीस'],
    records: {
      fees: [
        row({ student: 'Aarav Singh', for_month: '~-35', due: 1500, paid: 1500, paid_on: '~-30' }),
        row({ student: 'Aarav Singh', for_month: '~0', due: 1500, paid: 0 }),
        row({ student: 'Diya Patel', for_month: '~0', due: 1200, paid: 600, paid_on: '~-2', note: 'Rest next week' }),
        row({ student: 'Kabir Shah', for_month: '~0', due: 1500, paid: 1500, paid_on: '~-4' }),
      ],
    },
  }),
  tableEntry(homework, {
    category: 'school',
    keywords: ['homework', 'assignment', 'assignments', 'school work', 'study', 'due date', 'होमवर्क'],
    records: {
      homework: [
        row({ subject: 'Maths', title: 'Exercise 4.2, questions 1 to 10', class: '6A', due: '~+1', done: false }),
        row({ subject: 'Science', title: 'Draw and label a plant cell', class: '6A', due: '~-1', done: false }),
        row({ subject: 'English', title: 'Write a page about your best friend', class: '6A', due: '~+3', done: false }),
        row({ subject: 'Hindi', title: 'Learn the poem', class: '6A', due: '~-2', done: true }),
      ],
    },
  }),
  tableEntry(progress, {
    category: 'school',
    keywords: ['progress', 'marks', 'grades', 'results', 'test', 'scores', 'report card', 'student progress', 'अंक'],
    records: {
      students: [row({ name: 'Aarav Singh', class: '6A' }, 'aarav'), row({ name: 'Diya Patel', class: '6A' }, 'diya'), row({ name: 'Kabir Shah', class: '6A' }, 'kabir')],
      marks: [
        row({ student: '>aarav', subject: 'Maths', test: 'Unit test 1', date: '~-20', score: 42, out_of: 50 }),
        row({ student: '>aarav', subject: 'Science', test: 'Unit test 1', date: '~-19', score: 35, out_of: 50 }),
        row({ student: '>diya', subject: 'Maths', test: 'Unit test 1', date: '~-20', score: 46, out_of: 50 }),
        row({ student: '>diya', subject: 'Science', test: 'Unit test 1', date: '~-19', score: 44, out_of: 50 }),
        row({ student: '>kabir', subject: 'Maths', test: 'Unit test 1', date: '~-20', score: 18, out_of: 50 }),
        row({ student: '>kabir', subject: 'Science', test: 'Unit test 1', date: '~-19', score: 29, out_of: 50 }),
      ],
    },
  }),
];

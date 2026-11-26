/**
 * Which shelf category each gallery template belongs to. Kept apart from the gallery so the shelf can sort apps without
 * loading all 30 templates and their made-up entries; a test keeps the two in step.
 */
import type { CatalogCategory } from './types';

export const TEMPLATE_CATEGORY: Readonly<Record<string, CatalogCategory>> = {
  gst_calculator: 'shop', tailor_book: 'shop', inventory_manager: 'shop',
  kirana_credit_book: 'shop', daily_sales: 'shop', supplier_list: 'shop',
  tailor_order_book: 'shop', delivery_tracker: 'shop', payment_ledger: 'shop',
  customer_records: 'work', daily_task_list: 'work', visitor_register: 'work', customer_followup_book: 'work',
  grocery_list: 'home', bill_reminders: 'home', household_budget: 'home',
  medicine_reminders: 'health', medicine_tracker: 'health', appointment_tracker: 'health', visit_register: 'health', followup_list: 'health',
  attendance_register: 'school', student_register: 'school', fee_tracker: 'school', homework_tracker: 'school', student_progress: 'school',
  expense_tracker: 'personal', habit_tracker: 'personal', notes: 'personal', mala_counter: 'personal',
};

/** The category of a template id, or undefined for one this build does not know (an id read from a stored app). */
export const categoryOfTemplate = (id: string): CatalogCategory | undefined =>
  Object.prototype.hasOwnProperty.call(TEMPLATE_CATEGORY, id) ? TEMPLATE_CATEGORY[id] : undefined;

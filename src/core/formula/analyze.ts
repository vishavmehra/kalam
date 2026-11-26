/**
 * Scope-aware formula checks and dependency extraction (docs/05 §8.5 steps 3–4, §8.6).
 */
import type { FormulaDependencies, FormulaScope } from '../contracts';
import {
  compileFormula, isFilterCall, isIdent, type Bin, type Call, type Cond, type Ident, type Member, type Node, type Un,
} from './parse';

const AGGREGATES = new Set(['sum', 'avg', 'min', 'max']);
const has = (list: readonly string[] | undefined, v: string): boolean => !!list && list.includes(v);
const ownKey = (obj: object, k: string): boolean => Object.prototype.hasOwnProperty.call(obj, k);

/** Validates a formula against the names available to it. Empty array = valid. */
export function validateFormula(src: string, scope: FormulaScope): string[] {
  const compiled = compileFormula(src);
  if (!compiled.ok) return compiled.errors;
  const errors: string[] = [];

  /** Field ids of the collection a filter()/identifier resolves to, or undefined (error pushed). */
  const collectionFields = (node: Node, record: readonly string[] | undefined): readonly string[] | undefined => {
    if (isIdent(node)) {
      if (!has(record, node.name) && ownKey(scope.collections, node.name)) return scope.collections[node.name];
      errors.push(`"${node.name}" is not a collection`);
      return undefined;
    }
    if (isFilterCall(node)) return checkFilter(node, record);
    errors.push('Expected a collection');
    return undefined;
  };

  const checkFilter = (call: Call, record: readonly string[] | undefined): readonly string[] | undefined => {
    const [source, predicate] = call.arguments;
    if (!source || !predicate) return undefined;
    const fields = collectionFields(source, record);
    if (fields) visit(predicate, fields);
    return fields;
  };

  const visitMember = (m: Member, record: readonly string[] | undefined): void => {
    const prop = (m.property as Ident).name;
    if (isIdent(m.object)) {
      const obj = m.object.name;
      if (obj === 'form') {
        if (!has(scope.formFields, prop)) errors.push(`Unknown form field "form.${prop}"`);
        return;
      }
      if (obj === 'state') {
        if (!has(scope.stateKeys, prop)) errors.push(`Unknown counter or state value "state.${prop}"`);
        return;
      }
      if (!has(record, obj) && ownKey(scope.collections, obj)) {
        if (!scope.collections[obj]?.includes(prop)) errors.push(`"${obj}" has no field "${prop}"`);
        return;
      }
      errors.push(`"${obj}.${prop}" is not allowed because "${obj}" is not a collection`);
      return;
    }
    if (isFilterCall(m.object)) {
      const fields = checkFilter(m.object, record);
      if (fields && !fields.includes(prop)) errors.push(`Filtered records have no field "${prop}"`);
    }
  };

  const visit = (node: Node, record: readonly string[] | undefined): void => {
    switch (node.type) {
      case 'Identifier': {
        const { name } = node as Ident;
        if (name === 'today' || name === 'now') return;
        if (has(record, name) || ownKey(scope.collections, name)) return;
        if (name === 'selected') return; // id of the entry opened from a list
        if (record && name === 'id') return; // the entry's own id: filter(customers, id == selected) is the opened customer

        if (name === 'form' || name === 'state') { errors.push(`Use ${name}.<name>, not "${name}" on its own`); return; }
        errors.push(record ? `Unknown name "${name}" (not a field of these records)` : `Unknown name "${name}"`);
        return;
      }
      case 'MemberExpression': visitMember(node as Member, record); return;
      case 'CallExpression': {
        const c = node as Call;
        const fn = (c.callee as Ident).name;
        if (fn === 'filter') { checkFilter(c, record); return; }
        if (AGGREGATES.has(fn)) {
          for (const a of c.arguments) {
            const recordsArg = isFilterCall(a) || (isIdent(a) && !has(record, a.name) && ownKey(scope.collections, a.name));
            if (recordsArg) errors.push(`${fn}() needs a field, for example ${fn}(${isIdent(a) ? a.name : 'items'}.amount)`);
          }
        }
        for (const a of c.arguments) visit(a, record);
        return;
      }
      case 'BinaryExpression': {
        const b = node as Bin;
        visit(b.left, record); visit(b.right, record);
        return;
      }
      case 'UnaryExpression': visit((node as Un).argument, record); return;
      case 'ConditionalExpression': {
        const t = node as Cond;
        visit(t.test, record); visit(t.consequent, record); visit(t.alternate, record);
        return;
      }
      default: return; // Literal
    }
  };

  visit(compiled.ast, scope.recordFields);
  return [...new Set(errors)];
}

/**
 * Names a formula reads, for cache invalidation. Bare identifiers inside filter() predicates are
 * record fields and are skipped; top-level bare identifiers are reported as collections (for list
 * predicates this over-approximates, which is safe for invalidation).
 */
export function formulaDependencies(src: string): FormulaDependencies {
  const deps = { collections: new Set<string>(), form: new Set<string>(), state: new Set<string>() };
  const compiled = compileFormula(src);
  if (!compiled.ok) return { collections: [], form: [], state: [] };

  const visit = (node: Node, inPredicate: boolean): void => {
    switch (node.type) {
      case 'Identifier': {
        const { name } = node as Ident;
        if (!inPredicate && name !== 'today' && name !== 'now' && name !== 'selected') deps.collections.add(name);
        return;
      }
      case 'MemberExpression': {
        const m = node as Member;
        const prop = (m.property as Ident).name;
        if (isIdent(m.object)) {
          const obj = m.object.name;
          if (obj === 'form') deps.form.add(prop);
          else if (obj === 'state') deps.state.add(prop);
          else deps.collections.add(obj);
        } else visit(m.object, inPredicate);
        return;
      }
      case 'CallExpression': {
        const c = node as Call;
        if (isIdent(c.callee) && c.callee.name === 'filter') {
          const [source, predicate] = c.arguments;
          if (source) {
            if (isIdent(source)) deps.collections.add(source.name);
            else visit(source, inPredicate);
          }
          if (predicate) visit(predicate, true);
          return;
        }
        for (const a of c.arguments) visit(a, inPredicate);
        return;
      }
      case 'BinaryExpression': {
        const b = node as Bin;
        visit(b.left, inPredicate); visit(b.right, inPredicate);
        return;
      }
      case 'UnaryExpression': visit((node as Un).argument, inPredicate); return;
      case 'ConditionalExpression': {
        const t = node as Cond;
        visit(t.test, inPredicate); visit(t.consequent, inPredicate); visit(t.alternate, inPredicate);
        return;
      }
      default: return;
    }
  };
  visit(compiled.ast, false);
  const sorted = (s: Set<string>) => [...s].sort();
  return { collections: sorted(deps.collections), form: sorted(deps.form), state: sorted(deps.state) };
}

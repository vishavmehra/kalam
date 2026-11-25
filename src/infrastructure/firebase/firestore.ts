/**
 * Cloud Firestore for Kalam Bazaar only (docs/04 §15.7). Uses the separate named database `kalam`:
 * the Firebase project is shared, and Kalam never reads or writes the `(default)` database.
 * App records are never stored here.
 */
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { getFirebaseApp } from './app';

export const KALAM_DATABASE_ID = 'kalam';

let db: Firestore | undefined;

export function getKalamFirestore(): Firestore | undefined {
  if (db) return db;
  const app = getFirebaseApp();
  if (!app) return undefined;
  try {
    db = initializeFirestore(app, {}, KALAM_DATABASE_ID);
  } catch {
    db = getFirestore(app, KALAM_DATABASE_ID); // already initialised (fast refresh)
  }
  return db;
}

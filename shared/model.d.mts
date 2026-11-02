// Types for shared/model.mjs.

export interface Lane {
  id: string;
  name: string;
  colour: number;
}

export interface Item {
  id: string;
  lane: string;
  name: string;
  start: number;
  end: number;
  kind: 'bar' | 'ms';
  colour: number | null;
  note: string;
}

export interface Doc {
  name: string;
  lanes: Lane[];
  items: Item[];
}

export type Op =
  | { op: 'name'; name: string }
  | { op: 'lane+'; lane: Lane; at: number | null; items?: Item[] }
  | { op: 'lane'; id: string; set: Partial<Pick<Lane, 'name' | 'colour'>> }
  | { op: 'lane-'; id: string }
  | { op: 'order'; ids: string[] }
  | { op: 'item+'; item: Item }
  | { op: 'item'; id: string; set: Partial<Omit<Item, 'id'>> }
  | { op: 'item-'; id: string };

export const LIMITS: { items: number; lanes: number; bytes: number; name: number; note: number; batch: number };
export const COLOURS: number;
export const MIN_DAY: number;
export const MAX_DAY: number;
export function cleanLane(raw: unknown): Lane | null;
export function cleanItem(raw: unknown): Item | null;
export function cleanDoc(raw: unknown): Doc | null;
export function cleanOp(raw: unknown): Op | null;
export function apply(doc: Doc, op: Op): boolean;
export function inverse(doc: Doc, ops: Op[]): Op[];
export function fits(doc: Doc): boolean;

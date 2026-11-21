// The two halves of an undoable row removal, spelled once (DESIGN.md P1).
//
// Every list field in the editor — options, items, accepted answers, bullets
// — removes a row the same way and puts it back the same way: at the index
// it had, into the list AS IT NOW IS, so an edit made inside the undo window
// survives the undo (slides/types.ts `Removal`).

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, j) => j !== index);
}

export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const next = [...list];
  next.splice(Math.min(index, next.length), 0, item);
  return next;
}

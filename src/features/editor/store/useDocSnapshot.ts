import { computed, type ComputedRef } from 'vue'
import type { SceneDocument } from '../domain/types'
import { useEditorStore } from './editorStore'

/**
 * A reactive snapshot of a piece of the non-reactive document.
 *
 * Encapsulates the two rules every doc reader must follow: subscribe to
 * `revision` (mutations never trigger through `doc` itself), and hand out a
 * fresh copy (a same-reference result would not notify dependents even though
 * its fields changed). The clone also guarantees the selector cannot leak a
 * live reference into the doc — and would throw right here if anything
 * non-cloneable ever snuck into it.
 */
export function useDocSnapshot<T>(
  select: (doc: SceneDocument) => T | null | undefined,
): ComputedRef<T | null> {
  const editor = useEditorStore()
  return computed(() => {
    void editor.revision
    if (!editor.doc) return null
    return structuredClone(select(editor.doc) ?? null)
  })
}

import { describe, expect, it } from 'vitest'
import type { Command } from '../../domain/commands'
import { History } from '../history'

// minimal command operating on a counter document for isolated history tests
interface Counter {
  value: number
}

function inc(by: number): Command {
  return {
    label: 'inc',
    do: (doc) => {
      const counter = doc as unknown as Counter
      counter.value += by
    },
    undo: (doc) => {
      const counter = doc as unknown as Counter
      counter.value -= by
    },
  }
}

describe('History', () => {
  it('applies, undoes and redoes commands', () => {
    const doc = { value: 0 } as unknown as Parameters<Command['do']>[0]
    const counter = doc as unknown as Counter
    const history = new History()

    history.apply(doc, inc(5))
    expect(counter.value).toBe(5)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)

    history.undo(doc)
    expect(counter.value).toBe(0)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)

    history.redo(doc)
    expect(counter.value).toBe(5)
  })

  it('clears the redo branch when a new command is applied', () => {
    const doc = { value: 0 } as unknown as Parameters<Command['do']>[0]
    const counter = doc as unknown as Counter
    const history = new History()

    history.apply(doc, inc(1))
    history.apply(doc, inc(1))
    history.undo(doc)
    expect(history.canRedo).toBe(true)

    history.apply(doc, inc(10))
    expect(history.canRedo).toBe(false)
    expect(counter.value).toBe(11)
  })

  it('is a no-op to undo/redo past the ends', () => {
    const doc = { value: 0 } as unknown as Parameters<Command['do']>[0]
    const counter = doc as unknown as Counter
    const history = new History()

    history.undo(doc)
    history.redo(doc)
    expect(counter.value).toBe(0)
  })
})

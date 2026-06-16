import type { Command } from '../domain/commands'
import type { SceneDocument } from '../domain/types'

/**
 * Undo/redo stacks. Pure and doc-agnostic: the document is passed in on each
 * call, so it can be unit-tested without the store. Applying a new command
 * clears the redo branch.
 */
export class History {
  private past: Command[] = []
  private future: Command[] = []

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  apply(doc: SceneDocument, command: Command): void {
    command.do(doc)
    this.past.push(command)
    this.future = []
  }

  undo(doc: SceneDocument): void {
    const command = this.past.pop()
    if (!command) return
    command.undo(doc)
    this.future.push(command)
  }

  redo(doc: SceneDocument): void {
    const command = this.future.pop()
    if (!command) return
    command.do(doc)
    this.past.push(command)
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}

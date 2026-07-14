import { describe, expect, it } from 'vitest'
import { type CameraPose, recallCamera, rememberCamera } from '../cameraMemory'

const pose: CameraPose = { position: [1, 2, 3], target: [4, 5, 6] }

describe('cameraMemory', () => {
  it('has nothing to recall before a pose is stored', () => {
    expect(recallCamera('never-visited')).toBeNull()
  })

  it('gives the pose back to the project it was stored for', () => {
    rememberCamera('p1', pose)
    expect(recallCamera('p1')).toEqual(pose)
  })

  it('does not hand one project the pose of another', () => {
    rememberCamera('p1', pose)
    expect(recallCamera('p2')).toBeNull()
  })

  it('keeps only the latest pose for a project', () => {
    rememberCamera('p1', pose)
    const moved: CameraPose = { position: [9, 9, 9], target: [0, 0, 0] }
    rememberCamera('p1', moved)
    expect(recallCamera('p1')).toEqual(moved)
  })
})

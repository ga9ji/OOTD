import { describe, expect, it } from 'vitest'
import { PLAYER_LOOKS, RIVAL_LOOKS } from '../kokiHuntLooks'
import { act, createBattle, HUNTS } from '../kokiHunt'
import { makeBlade, makeHanger, makeScarf, photoActor, posePlayer, poseRival } from '../../components/kokiHuntModels3d'
import cutouts from '../../data/cutouts.json'

describe('outfit photo actors', () => {
  it.each([...PLAYER_LOOKS, ...Object.values(RIVAL_LOOKS)])('anchors equipment to the hand in OOTD #$no', look => {
    const size = cutouts.sprites[look.key as keyof typeof cutouts.sprites]
    const image = { naturalWidth: size.w, naturalHeight: size.h } as HTMLImageElement
    const actor = photoActor(look, image, 2, makeBlade())
    const [left, top, width, height] = look.crop
    expect(actor.photo.material.map?.image).toBe(image)
    expect(left + width).toBeLessThanOrEqual(size.w)
    expect(top + height).toBeLessThanOrEqual(size.h)
    expect(actor.prop.position.x).toBeCloseTo((look.hand[0] - left - width / 2) * 2 / height)
    expect(actor.prop.position.y).toBeCloseTo((top + height - look.hand[1]) * 2 / height)
    const grip = actor.prop.position.clone()
    const battle = act(createBattle(HUNTS[0]), 'heavy', { x: 0, y: 0 })
    posePlayer(actor, battle, 0, 0)
    const ready = actor.prop.quaternion.clone()
    posePlayer(actor, { ...battle, playerTimer: .02 }, 0, 0)
    expect(actor.prop.quaternion.angleTo(ready)).toBeGreaterThan(1)
    expect(actor.prop.position.equals(grip)).toBe(true)
  })

  it.each(HUNTS)('moves the rival’s accessory through the $id attack', hunt => {
    const look = RIVAL_LOOKS[hunt.id]
    const size = cutouts.sprites[look.key as keyof typeof cutouts.sprites]
    const prop = hunt.id === 'cinder' ? makeHanger() : makeScarf()
    const actor = photoActor(look, { naturalWidth: size.w, naturalHeight: size.h } as HTMLImageElement, 2.7, prop)
    const battle = createBattle(hunt)
    poseRival(actor, { ...battle, phase: 'windup' })
    const raised = prop.quaternion.clone()
    poseRival(actor, { ...battle, phase: 'strike', phaseTimer: .13 })
    expect(prop.quaternion.angleTo(raised)).toBeGreaterThan(.5)
    expect(actor.photo.geometry.type).toBe('PlaneGeometry')
  })
})

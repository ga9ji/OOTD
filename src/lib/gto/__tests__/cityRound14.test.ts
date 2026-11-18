// Grand Theft Outfit [部品: city] 第14ラウンドの決まりごとの確かめ。
// center-gai_08/09/11/12（センター街の中から駅向き）: 通りの抜けの右、65m 先の角のガラスの棟の上に駅直上の塔が立ち、桃色の棟（136690959）が画面の右半分を占める。
import { describe, expect, it } from 'vitest'
import { ART, FACE_DECOS, facePanels, PINK_STAIR } from '../mapFacade'
import { photoStandpoint, photoTurn } from '../mapPhoto'
import { EAST_TOWER } from '../mapEast'
import { blockStyleOf, streetProps } from '../map'
import { world } from './helpers'

const building = (id: number) => {
  const b = world.map.buildings.find((x) => x.id === id)
  if (!b) throw new Error(`building ${id} が地図に無い`)
  return b
}
const bearing = (x: number, z: number, px: number, pz: number) => ((Math.atan2(px - x, -(pz - z)) * 180) / Math.PI + 360) % 360
const bearings = (x: number, z: number, pts: number[]) => Array.from({ length: pts.length / 2 }, (_, i) => bearing(x, z, pts[i * 2], pts[i * 2 + 1]))
const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2

describe('gto city 第14ラウンド: センター街の中から駅向き（center-gai_11）', () => {
  // 批評役のクエリ（緯度経度から起こした位置と、110〜115 度の向き）
  const raw: [number, number] = [-151.4, -90.7]
  const stand = photoStandpoint(raw[0], raw[1], 115)

  const span = (id: number) => {
    const v = bearings(stand.x, stand.z, building(id).pts)
    return [Math.min(...v), Math.max(...v)]
  }

  it('立ち位置は桃色の棟（136690959）の手前、西の路地との交差点の東。靴屋の角の棟まで 55〜75m 離れる', () => {
    expect(world.insideBuilding(stand.x, stand.z)).toBe(false)
    const corner = building(136690970)
    const d = Math.min(...Array.from({ length: corner.pts.length / 2 }, (_, i) => Math.hypot(corner.pts[i * 2] - stand.x, corner.pts[i * 2 + 1] - stand.z)))
    expect(d).toBeGreaterThan(55)
    expect(d).toBeLessThan(75)
  })

  it('向きは写っている物の方角へ回す: 左から、通りの抜け・靴屋の棟と塔・桃色の棟・灰色の棟の順に並ぶ', () => {
    for (const given of [110, 115]) {
      const heading = given + photoTurn(raw[0], raw[1], given)
      const tower = mid(bearings(stand.x, stand.z, building(617560918).pts))
      const [, cornerRight] = span(136690970)
      const [pinkLeft, pinkRight] = span(136690959)
      const [greyLeft] = span(136690944)
      // 塔は画面の中央の近く（08/09/11/12 の 4 枚で、中央の左 9 度〜右 7 度にばらつく。第16ラウンドで 09 に合わせて中央へ寄せた）、靴屋の棟の右の端は塔の方角の近く
      expect(Math.abs(heading - tower)).toBeLessThan(6)
      expect(Math.abs(cornerRight - tower)).toBeLessThan(8)
      // 桃色の棟は画面の中央の近くから始まって右へ 20 度以上、灰色の棟は右端（中央から 20〜34 度）から
      expect(Math.abs(pinkLeft - heading)).toBeLessThan(8)
      expect(pinkRight - heading).toBeGreaterThan(20)
      expect(greyLeft - heading).toBeGreaterThan(18)
      expect(greyLeft - heading).toBeLessThan(34)
      // 通りの抜け（次の横道との交差点）は中央より左 8〜30 度
      const axis = bearing(stand.x, stand.z, -122.2, -77.7)
      expect(heading - axis).toBeGreaterThan(8)
      expect(heading - axis).toBeLessThan(30)
    }
  })

  it('離れた所・逆向き（通りの奥向き）の指定は回さない', () => {
    expect(photoTurn(raw[0], raw[1], 290)).toBe(0)
    expect(photoTurn(-125, -80, 122)).toBe(0)
  })

  it('桃色の棟は地図の建物のまま（足した正面は無い）。通りの面にガラスの窓割り、路地の面に大型ビジョンと外階段', () => {
    expect(world.map.buildings.some((b) => b.id === 9100000002)).toBe(false)
    expect(world.map.buildings.some((b) => b.id === 136690967)).toBe(true)
    const pink = building(136690959)
    expect(blockStyleOf(pink)?.lit).toBe(true)
    const panels = facePanels(pink)
    const glass = panels.filter((p) => p.kind === 'board' && p.ref === ART.pinkGlass)
    expect(glass.length).toBe(1)
    // 通りの面（北向き）
    expect(glass[0].nz).toBeLessThan(-0.8)
    const vision = panels.filter((p) => p.kind === 'screen')
    expect(vision.length).toBe(1)
    // 路地の面（西向き）で、立ち位置のほうを向く
    expect(vision[0].nx).toBeLessThan(-0.8)
    expect(vision[0].nx * (stand.x - vision[0].ax) + vision[0].nz * (stand.z - vision[0].az)).toBeGreaterThan(0)
    expect(vision[0].y1).toBeLessThan(13)
    expect(PINK_STAIR.building).toBe(136690959)
    expect(PINK_STAIR.t0).toBeGreaterThan(vision.length ? 0.5 : 0)
  })

  it('立ち位置の 7〜14m 先、画面の中央より左に行灯の街灯が 1 本立つ', () => {
    const heading = 110 + photoTurn(raw[0], raw[1], 110)
    const lamps = streetProps(world).filter((p) => p.kind === 'lamp-center' && Math.hypot(p.x - stand.x, p.z - stand.z) < 14)
    const left = lamps.filter((p) => {
      const off = heading - bearing(stand.x, stand.z, p.x, p.z)
      return off > 5 && off < 25 && Math.hypot(p.x - stand.x, p.z - stand.z) > 7
    })
    expect(left.length).toBe(1)
  })

  it('角のガラスの棟には桃色の広告面を載せない（桃色は右の棟だけ）', () => {
    const refs = (FACE_DECOS[136690970] ?? []).flatMap((d) => d.panels).filter((p) => p.kind === 'board').map((p) => p.ref)
    expect(refs).not.toContain(ART.pinkPop)
    expect(refs).toContain(ART.blackBand)
  })

  it('塔の手前の棟は、センター街の側の上の階が白い外壁（北の面は段の高さまで、その上は西の面。第16ラウンドで上の階を南西の側だけにした）', () => {
    const b = building(114755219)
    const north = facePanels(b).filter((p) => p.kind === 'color' && p.nz < -0.9)
    expect(north.length).toBeGreaterThan(0)
    const west = facePanels(b).filter((p) => p.kind === 'color' && p.nx < -0.9)
    expect(Math.max(...west.map((p) => p.y1))).toBeGreaterThan(b.h - 2)
  })

  it('塔のガラスの壁には、白い横の帯が何本も入る（遠くからでも無地の箱に見えない）', () => {
    expect(EAST_TOWER.bands.length).toBeGreaterThanOrEqual(5)
    for (const y of EAST_TOWER.bands) {
      expect(y).toBeGreaterThan(60)
      expect(y).toBeLessThan(building(617560918).h - 6)
    }
  })
})

// Grand Theft Outfit: 撮影用の URL クエリ。同じクエリなら同じ絵になるようにする。
// 入口: parseLaunch(query, world)
//   ?gtoShot=<スポットのキー>            地図の主要スポットに立ち、通りの先を見る
//   ?gtoShot=<緯度>,<経度>,<向き(度)>    緯度経度と向きを直接指定（&lat= &lon= &heading= でも可）
//   &time=day|dusk|night  &quality=high|mobile  &hud=0|1  &seed=N
//   &mode=foot|drive      指定すると「遊んでいる画面」（背後カメラ）。無ければ現地写真と同じ目の高さの固定カメラ
//   &demo=<シナリオ名>    決まった入力を自動再生（demo.ts の DEMOS）
//   &eye=1.6 &pitch=4 &fov=60   固定カメラの目の高さ m・見上げる角度（度）・縦の画角（度）
import { DEMOS, type DemoScenario } from './demo'
import { fromLatLon } from './map'
import { photoStandpoint, photoTurn } from './mapPhoto'
import { DEG, headingOf } from './math'
import type { GtoWorld, PlayMode, TimeOfDay } from './types'

export interface PhotoCamera {
  x: number
  z: number
  /** 向き（ラジアン） */
  heading: number
  /** 地表からの目の高さ m */
  eye: number
  /** 見上げる角度（ラジアン、上が＋） */
  pitch: number
  fov: number
}

export interface Launch {
  /** 始める場所と向き（指定が無ければ null → 既定の出発点） */
  start: { x: number; z: number; heading: number } | null
  /** 固定カメラ（現地写真との見比べ用）。null なら背後カメラで遊ぶ画面 */
  photo: PhotoCamera | null
  time: TimeOfDay
  quality: string | null
  hud: boolean
  seed: number
  mode: PlayMode
  demo: DemoScenario | null
  demoName: string | null
  /** 題名の画面を飛ばして、すぐ動かすか（撮影のとき） */
  autostart: boolean
}

/**
 * 通りの向きを持たないスポット（交差点・ビル・高架）を、どこから見るか。
 * 現地写真（refs/shibuya）の立ち位置と向きに合わせてある。
 * [立つ場所 x, z, 見上げる角度（度）, 向き（度。省くとスポットの方を向く）, 縦の画角（度。省くと 58）]
 */
/** 遊ぶ画面とデモでは使わない立ち位置（写真の立ち位置が車道の外にあるスポット。そのときは元の通りの上から始める） */
const PHOTO_ONLY = new Set(['miyamasuzaka-bottom'])
const VIEWPOINTS: Record<string, [x: number, z: number, pitchDeg: number, headingDeg?: number, fovDeg?: number]> = {
  // ハチ公側の角から、ガラスの角ビルとセンター街の入口を見る（scramble_08）
  scramble: [11, 13, 7, 318],
  // 交差点の南西側から、道の先の円筒を見る（109_14）
  'dogenzaka-bottom': [-30, 4, 6, 262],
  // 交差点の北西の角から、入口のゲートを見る（center-gai_01）
  'center-gai-bottom': [-21, -15, 9, 316],
  // ガードの 30m 東の車道の南寄りから、JR の鉄桁ガードの全幅と桁の上の電車、その上に立つ塔を見る（viaduct_10）。
  // 北の歩道からだと右半分が店の壁になるので、通りの真ん中寄りに立つ
  'viaduct-jr': [112, 5, 15, 260, 50],
  // 東口の広場から、宮益坂下の正面を塞ぐ雑居ビルの街区と屋上の広告塔を見る（miyamasuzaka_02）
  'miyamasuzaka-bottom': [129.8, 10, 12, 50, 50],
  // 宮益坂下の交差点とガードの間の北の歩道の縁から南（miyamasuzaka_06/07）。道路の上を東西にまたぐ銀座線の橋（ガラスの筒）が
  // 塔の足元を左端から横切り、その真上に塔と大型ビジョン、右の端に、奥へ南北に伸びる JR の高架と電車、その上の工事中の白い躯体。
  // 高架の目の前まで寄ると高架が主役になって西向きに見えるので、橋が正面に来る所から見る（mapPhoto.ts の EAST_SOUTH_STAND と同じ所）
  'viaduct-ginza': [128, -9, 15, 185, 50],
  // 交差点の北側から、駅舎越しに高層棟の並びを見上げる（scramble_21）
  'tower-scramble-square': [-12, -18, 20, 131, 48],
  'tower-hikarie': [150, -20, 28],
  // 南東の通りの奥から、雑居ビルの谷間の突き当たりに白い外壁の塔の全身を見上げる（towers_02 と同じ向き。足元からだと壁だけが写る）
  'tower-stream': [335, 338, 32, 305, 50],
  'tower-fukuras': [52.8, 284.1, 24, 314],
  // 南の線路沿いの道から見上げる
  'tower-sakura-stage': [61.5, 464.1, 25, 13, 54],
  // 南西の坂道の下から、雑居ビルの谷間の突き当たりに塔の全身を見上げる（高架の裏にも手前の壁にも隠れない所）
  'tower-cerulean': [-191, 443.4, 24, 44, 50],
  // 通りの入口寄りの直線から駅のほうを見る（center-gai_08/11/12）。突き当たりに入口のゲートの裏、その真上にいちばん高い塔
  'center-gai-top': [-60, -58, 18, 133],
  'mark-city': [-10, 20, 22],
  // 文化村通りと道玄坂の分岐の手前から（109_02）
  'bldg-109': [-95, -6, 16],
  'bldg-magnet': [-8, 12, 14],
  // 北の交差点の向かいから、ガラスの足元・暗い切れ込みを挟んで折り重なる白い面・奥の高層棟まで全身を見る（20m 手前の歩道からだと壁だけが写る）
  'bldg-parco': [-112, -345, 22, 200, 50],
  // 明治通りの東の歩道から、通り沿いに続く低層棟を見る（miyashita-park_04）
  'miyashita-park': [170, -300, 10, 300, 58],
}

const num = (v: string | null, fallback: number) => {
  const n = v == null || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 立つ場所が建物の中なら、いちばん近い道の上へ寄せる */
function onStreet(world: GtoWorld, x: number, z: number) {
  if (!world.insideBuilding(x, z)) return { x, z }
  const road = world.nearestRoad(x, z, false, 120)
  if (road && !world.insideBuilding(road.x, road.z)) return { x: road.x, z: road.z }
  const out = world.resolveCircle(x, z, 1.5)
  return { x: out.x, z: out.z }
}

/**
 * 緯度経度で指定した立ち位置（現地写真の推定位置）が建物の中や壁の目の前なら、向きはそのままで、
 * いちばん近い通りの上（歩行者の通りを含む）へ寄せる。寄せても壁なら車道へ。見通しがあれば動かさない
 */
export function clearOfWalls(world: GtoWorld, x: number, z: number, heading: number, reach = 14): { x: number; z: number } {
  const open = (px: number, pz: number) => !world.insideBuilding(px, pz) && world.segmentClear(px, pz, px + Math.sin(heading) * reach, pz - Math.cos(heading) * reach) >= 1
  if (open(x, z)) return { x, z }
  for (const driveOnly of [false, true]) {
    const road = world.nearestRoad(x, z, driveOnly, 60)
    if (road && open(road.x, road.z)) return { x: road.x, z: road.z }
  }
  // 近い通りも壁向きなら、周りを輪に探して、通りの上で見通しのあるいちばん近い点へ
  for (let r = 4; r <= 48; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      const px = x + Math.sin(a) * r
      const pz = z - Math.cos(a) * r
      const road = world.nearestRoad(px, pz, false, 3)
      if (road && open(px, pz)) return { x: px, z: pz }
    }
  }
  return onStreet(world, x, z)
}

export function parseLaunch(query: URLSearchParams, world: GtoWorld): Launch {
  const shot = query.get('gtoShot')
  const demoName = query.get('demo')
  const demo = demoName && DEMOS[demoName] ? DEMOS[demoName] : null
  const modeParam = query.get('mode')
  const time = query.get('time')
  const eye = num(query.get('eye'), 1.6)
  const fov = num(query.get('fov'), 58)

  let start: Launch['start'] = null
  let pitch = num(query.get('pitch'), 3) * DEG
  // スポットごとに決めた画角（URL の fov= があればそちらを使う）
  let viewFov: number | null = null
  const spotKey = shot ?? demo?.spot ?? null
  const latLon = shot?.split(',').map(Number)
  if (latLon && latLon.length >= 2 && latLon.every(Number.isFinite)) {
    const raw = fromLatLon(world.map, latLon[0], latLon[1])
    // 写真の推定位置が通り 1 本ぶん外れている所は、起こし直した立ち位置へ移す（mapPhoto.ts）
    const given = latLon[2] ?? num(query.get('heading'), 0)
    const shotTime = time === 'dusk' || time === 'night' ? time : 'day'
    const p = photoStandpoint(raw.x, raw.z, given, pitch / DEG, shotTime)
    // 写真の向きの推定が写っている物の方角とずれている所は、起こし直した向きへ回す（mapPhoto.ts の turn）
    const turned = given + photoTurn(raw.x, raw.z, given, pitch / DEG, shotTime)
    start = { ...clearOfWalls(world, p.x, p.z, turned * DEG), heading: turned * DEG }
  } else if (query.has('lat') && query.has('lon')) {
    const p = fromLatLon(world.map, num(query.get('lat'), 0), num(query.get('lon'), 0))
    start = { ...p, heading: num(query.get('heading'), 0) * DEG }
  } else if (spotKey) {
    const spot = world.spot(spotKey)
    if (spot) {
      const photoOnly = PHOTO_ONLY.has(spot.key) && (!shot || modeParam === 'foot' || modeParam === 'drive' || demo != null)
      const view = photoOnly ? undefined : VIEWPOINTS[spot.key]
      if (spot.heading != null && !view) {
        // 範囲の外にあるスポット（坂の上など）は、範囲の内側へ寄せる
        const road = world.nearestRoad(spot.x, spot.z, false, 200)
        const p = onStreet(world, road && road.dist > 2 ? road.x : spot.x, road && road.dist > 2 ? road.z : spot.z)
        start = { ...p, heading: num(query.get('heading'), spot.heading) * DEG }
      } else {
        let from = onStreet(world, view?.[0] ?? spot.x + 40, view?.[1] ?? spot.z + 40)
        // 目の前が壁なら、いちばん近い車道の上まで下がる
        const aim = view?.[3] != null ? view[3] * DEG : headingOf(spot.x - from.x, spot.z - from.z)
        if (world.segmentClear(from.x, from.z, from.x + Math.sin(aim) * 14, from.z - Math.cos(aim) * 14) < 1) {
          const road = world.nearestRoad(from.x, from.z, true, 120)
          if (road) from = { x: road.x, z: road.z }
        }
        start = { ...from, heading: query.has('heading') ? num(query.get('heading'), 0) * DEG : view?.[3] != null ? view[3] * DEG : headingOf(spot.x - from.x, spot.z - from.z) }
        if (!query.has('pitch')) pitch = (view?.[2] ?? 8) * DEG
        if (!query.has('fov') && view?.[4] != null) viewFov = view[4]
      }
    }
  }

  const playing = modeParam === 'foot' || modeParam === 'drive' || demo != null
  const mode: PlayMode = modeParam === 'drive' || modeParam === 'foot' ? modeParam : (demo?.mode ?? 'foot')
  const photo = shot && start && !playing ? { x: start.x, z: start.z, heading: start.heading, eye, pitch, fov: viewFov ?? fov } : null
  return {
    start,
    photo,
    time: time === 'dusk' || time === 'night' ? time : 'day',
    quality: query.get('quality'),
    hud: query.has('hud') ? query.get('hud') !== '0' : photo == null,
    seed: Math.floor(num(query.get('seed'), 1)),
    mode,
    demo,
    demoName: demo ? demoName : null,
    autostart: shot != null || demo != null || modeParam != null,
  }
}

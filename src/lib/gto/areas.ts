// Grand Theft Outfit [部品: areas] エリア（渋谷・新宿）ごとの決まりごとの表。
// 入口: AREAS（表）/ AREA_IDS（並び順）/ areaDef(world か id) / isAreaId(v)
// 契約: エリアどうしは地続きではない。行き来は読み込みの画面を挟み、世界（map.ts の loadAreaWorld）と描画を作り直す。
//       ここに置くのは、地図の座標に直接ひもづく「場所」の決まりだけ（出発地点・題名の画面のカメラ・工事のクレーン）。
//       依頼は missionData.ts、建物の形や外装は map*.ts の各部品が、エリアを見て出し分ける。
//       地名（name）は画面に出してよい実名。t() を通して出す。
import type { AreaId, GtoWorld } from './types'

/** 題名の画面のカメラの弧（lib/gto/titleCamera.ts が読む） */
export interface TitleCameraSpec {
  /** 見る先（弧の中心）の場所。省くと原点 */
  cx?: number
  cz?: number
  /** 中心からの水平距離 m と、高さ m */
  radius: number
  height: number
  /** 弧の中心の方角（度。中心から見てカメラのある向き。南 0・東 90・北 180・西 270）と、左右へ振れる幅（度） */
  mid: number
  swing: number
  /** 往復の速さ（ラジアン/秒） */
  rate: number
  /** 見る先の高さ m と、縦の画角（度） */
  lookY: number
  fov: number
}

export interface CraneSpec {
  x: number
  z: number
  /** マストの高さ m */
  h: number
  /** ジブの向き（度、北 0・時計回り） */
  heading: number
}

export interface AreaDef {
  id: AreaId
  /** 画面に出す地名 */
  name: string
  /** 既定の出発点（捕まったあともここからやり直す）。heading はラジアン */
  spawn: { x: number; z: number; heading: number }
  title: TitleCameraSpec
  /** 工事のクレーン。建物の上なら屋上から立つ */
  cranes: readonly CraneSpec[]
  /**
   * 原点がスクランブル交差点の広場か（渋谷だけ）。true のとき、原点のまわりを標示のない広場として扱う
   * （濃いアスファルトの円・幅の広い横断歩道・広場の光・街具を立てない円）。
   */
  scramble: boolean
  /**
   * 現地写真と突き合わせて作り込んだ渋谷だけの部品（駅の工事現場・東口のバス乗り場・109 前の分岐・写真の立ち位置の空き）を
   * 置くか。これらは地図ではなく固定の座標に置くので、ほかのエリアでは出さない。
   */
  shibuyaSet: boolean
}

export const AREAS: Record<AreaId, AreaDef> = {
  shibuya: {
    id: 'shibuya',
    name: '渋谷',
    // 駅前の広場。交差点のほうを向いて立つ
    spawn: { x: 26, z: 32, heading: -0.75 },
    // 交差点の西北西の空から、交差点とその奥の駅の高層棟を見下ろす（1 往復は約 57 秒）
    title: { radius: 150, height: 78, mid: 248, swing: 20, rate: 0.11, lookY: 14, fov: 50 },
    // 駅の建て替え工事のクレーン
    cranes: [
      { x: 86, z: 118, h: 58, heading: 40 },
      { x: 72, z: 158, h: 66, heading: 300 },
      { x: 104, z: 150, h: 50, heading: 160 },
      { x: 58, z: 96, h: 44, heading: 230 },
    ],
    scramble: true,
    shibuyaSet: true,
  },
  shinjuku: {
    id: 'shinjuku',
    name: '新宿',
    // 東口の駅前広場。新宿通りの交差点のほうを向いて立つ
    spawn: { x: -30, z: 22, heading: 0.9 },
    // 弧は、新宿の地図を焼いてから、建物に当たらない所へ決める（いまは渋谷と同じ形の仮の弧）
    title: { radius: 150, height: 78, mid: 248, swing: 20, rate: 0.11, lookY: 14, fov: 50 },
    cranes: [],
    scramble: false,
    shibuyaSet: false,
  },
}

/** エリアの並び順（行き先を選ぶ画面に出す順） */
export const AREA_IDS: readonly AreaId[] = ['shibuya', 'shinjuku']

export const isAreaId = (v: unknown): v is AreaId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(AREAS, v)

/** 世界（か id）から、そのエリアの決まりごとを引く。エリアの分からない世界（テスト用の小さな地図など）は渋谷として扱う */
export const areaDef = (of: Pick<GtoWorld, 'area'> | AreaId): AreaDef => AREAS[typeof of === 'string' ? of : of.area] ?? AREAS.shibuya

// Grand Theft Outfit [部品: city] 壁面いっぱいの看板・大型ビジョンと、広場の解体現場の決まりごと。three/DOM なし。
// 入口: FACE_DECOS / UPPER_FACE_DECOS / PINK_STAIR / facePanels(b, decos?) / pickEdge(pts, near) / WEST_SITE
// 契約: 現地写真（109_04〜13、scramble_03/20/21/23、dogenzaka_01/07）で場所を決めている面を、位置・大きさ・色だけ起こす。
//       絵柄・店名・映像はすべて架空（板の絵は renderCityBoards / renderCityAds、映像は renderCityTextures）。
//       高さは建物の足元（b.y）からの m。t は辺の中の割合で、外から壁を見て左が 0・右が 1。
import type { Flat, MapBuilding } from './types'

export type FacePanelKind = 'screen' | 'board' | 'color'

export interface FacePanelSpec {
  t0: number
  t1: number
  y0: number
  y1: number
  kind: FacePanelKind
  /** screen: 映像の絵の番号（0..3）／ board: 板の絵の番号（renderCityBoards の並び）／ color: 色 */
  ref: number
  /** 壁からさらに手前へ出す量 m（ほかの面の手前に重ねるとき）。省くと 0 */
  out?: number
}

export interface FaceDeco {
  /** 載せる辺を選ぶ点（辺の中点がここにいちばん近い辺） */
  near: [x: number, z: number]
  panels: FacePanelSpec[]
}

export interface Edge {
  /** 外から見て左の端 */
  ax: number
  az: number
  /** 外から見て右の端 */
  bx: number
  bz: number
  /** 外向きの法線 */
  nx: number
  nz: number
  len: number
}

export interface FacePanel extends Edge {
  y0: number
  y1: number
  kind: FacePanelKind
  ref: number
  /** 壁からさらに手前へ出す量 m */
  out: number
}

/** 板の絵の番号（renderCityBoards のテクスチャの並び。0..7 屋上の広告塔、8..19 壁の広告面、20.. この部品の大看板） */
export const ART = {
  wallRedWhite: 9,
  wallYellow: 10,
  wallBlue: 11,
  wallBlueFigure: 12,
  wallPinkFigure: 13,
  wallBlackPink: 14,
  wallTealFigure: 16,
  wallWhiteBlue: 18,
  /** 赤地に白い太字と数字の横長の大看板 */
  bigRed: 20,
  /** 白地に赤い丸印が 2 つ */
  twinCircles: 21,
  /** 緑地に人物の大写し */
  greenFigure: 22,
  /** 濃い灰色に白い斜めの光の線 */
  slashLines: 23,
  /** 黒地に白い太字の横長の帯（角のガラスの棟に巻く） */
  blackBand: 24,
  /** 暗い格子の枠に、赤と黄の丸い提灯を並べた面 */
  lanterns: 25,
  /** 桃色の地の大型の広告面 */
  pinkPop: 26,
  /** 木目の黄色い地に墨の太字の店先の帯 */
  woodShop: 27,
  /** 白地に赤い太字の横長の帯（屋上の量販店の看板。店名は架空） */
  redCrown: 30,
  /** 桃色の枠のガラスの窓割りに、階ごとの青い帯の看板（センター街の桃色の棟の通りの面。店名は架空） */
  pinkGlass: 32,
  /** 中から白く灯るガラスの外壁（センター街の突き当たりの角の棟） */
  litGlass: 33,
  /** 灰色の縦のリブの壁に白い印（109 の向かいの棟の下半分。印は架空） */
  ribWall: 35,
  /** 色とりどりの小さな切り抜きを敷き詰めた寄せ絵に、赤い太字を縦に積んだ縦長の広告面（交差点の南西の角の棟の道玄坂の面。字は架空） */
  collage: 36,
} as const

const C = { orange: 0xf08a24, white: 0xf2f2ee, blue: 0x1f4fb0, red: 0xd5281f, black: 0x17181c }

const STRIPE_RED = 0xc7402e

/**
 * センター街の突き当たりの角の棟の、帯の看板から屋上までのガラスの面（center-gai_09: 夜は中から白く灯り、通りの奥を塞ぐ明るい面になる。
 * その真上に駅の塔がかぶさるのが、駅へ戻る向きの決め手）
 */
export const CORNER_GLASS: FacePanelSpec = { t0: 0, t1: 1, y0: 7.9, y1: 19, kind: 'board', ref: ART.litGlass }

/** 階ごとの色の帯（count 本、下端 y0 から pitch m ごと、太さ h m） */
const stripes = (count: number, y0: number, pitch: number, h: number, color: number): FacePanelSpec[] =>
  Array.from({ length: count }, (_, k) => ({ t0: 0, t1: 1, y0: y0 + k * pitch, y1: y0 + k * pitch + h, kind: 'color' as const, ref: color }))

/** 階ごとの店の看板の帯（色を順に替える。幅も 1 枚ごとに少し変える） */
const SIGN_STACK = [0x1fa3a0, 0xf2c230, 0xd5281f, 0xf2f2ee, 0x1f4fb0, 0xe9742b, 0xf2f2ee, 0x2e9a4c, 0xd5281f]
const signStack = (count: number, y0: number, pitch: number, h: number): FacePanelSpec[] =>
  Array.from({ length: count }, (_, k) => ({ t0: k % 3 === 1 ? 0.12 : 0.04, t1: k % 3 === 2 ? 0.86 : 0.96, y0: y0 + k * pitch, y1: y0 + k * pitch + h, kind: 'color' as const, ref: SIGN_STACK[k % SIGN_STACK.length] }))

/** 角の面の、階ごとの店の看板の帯（面の幅いっぱい。1 枚おきに右の端を少し詰める）。外壁が明るいので、白い帯は使わない */
const CORNER_SIGN_COLORS = [0xd5281f, 0xf2c230, 0x1f4fb0, 0xe9742b, 0x2e9a4c, 0xd5281f, 0x1fa3a0]
const cornerSigns = (count: number, y0: number, pitch: number, h: number): FacePanelSpec[] =>
  Array.from({ length: count }, (_, k) => ({ t0: 0.03, t1: k % 2 === 0 ? 0.97 : 0.9, y0: y0 + k * pitch, y1: y0 + k * pitch + h, kind: 'color' as const, ref: CORNER_SIGN_COLORS[k % CORNER_SIGN_COLORS.length] }))

/** 裏の白い外壁と外階段（t 0.52〜0.76 の列に、灰色の踊り場を 3.4m ごと）。面は重ねず、帯を並べて埋める */
const backStair = (y0: number, y1: number): FacePanelSpec[] => {
  const out: FacePanelSpec[] = [
    { t0: 0, t1: 0.52, y0, y1, kind: 'color', ref: C.white },
    { t0: 0.76, t1: 1, y0, y1, kind: 'color', ref: C.white },
  ]
  for (let y = y0; y < y1; y += 3.4) {
    const landing = Math.min(y + 1.1, y1)
    out.push({ t0: 0.52, t1: 0.76, y0: y, y1: landing, kind: 'color', ref: 0x7f868c })
    if (landing < y1) out.push({ t0: 0.52, t1: 0.76, y0: landing, y1: Math.min(y + 3.4, y1), kind: 'color', ref: 0xd9dcdc })
  }
  return out
}

/**
 * 建物ごとの壁面の決めごと。
 * 道玄坂の南（109_10/13）: 東から、白い棟（OSM 116710254。2 段 2 列の広告と丸い赤い印、屋上に赤い字の看板）・
 * 黒い棟（136587748。足元に橙の帯、頂部に大型ビジョン）・低い棟の赤い大看板（136587824）。その真後ろが背後のホテル棟の壁。文化村通りの北（109_04〜08）: 濃い灰色に白い斜めの線の棟、その右に緑の縦長の広告、左奥の屋上寄りに青い縦長のビジョン。
 * 交差点の北東の棟（scramble_20/21）: 西の面の南寄りに赤い大型ビジョン、北寄りに赤白の広告。
 */
export const FACE_DECOS: Record<number, FaceDeco[]> = {
  // 白い棟（109_10/13 の左〜中央）。北の面に 2 段 2 列の広告、足元に白地に丸印の帯、西の角に赤い縦の帯、屋上に赤い字の量販店の看板
  116710254: [
    {
      near: [-93, 10.5],
      panels: [
        { t0: 0.07, t1: 0.47, y0: 22.5, y1: 33.2, kind: 'board', ref: ART.wallBlue },
        { t0: 0.5, t1: 0.9, y0: 22.5, y1: 33.2, kind: 'board', ref: ART.wallBlueFigure },
        { t0: 0.07, t1: 0.47, y0: 11.6, y1: 21.6, kind: 'board', ref: ART.wallTealFigure },
        { t0: 0.5, t1: 0.9, y0: 11.6, y1: 21.6, kind: 'board', ref: ART.wallYellow },
        { t0: 0.05, t1: 0.92, y0: 6.6, y1: 10.6, kind: 'board', ref: ART.twinCircles },
        { t0: 0.93, t1: 1, y0: 9, y1: 31, kind: 'color', ref: C.red },
        { t0: 0, t1: 1, y0: 35.4, y1: 38.9, kind: 'board', ref: ART.redCrown },
      ],
    },
  ],
  // 黒い棟（白い棟の西隣。109_10 の中央）: 足元に橙の帯。大型ビジョンは屋上に載る（mapVista.ts の ROOF_SCREENS）
  136587748: [{ near: [-104, 12.5], panels: [{ t0: 0.03, t1: 0.97, y0: 4.4, y1: 8.4, kind: 'color', ref: C.orange }] }],
  // 赤い大看板（109_10 の画面の右 3 分の 1、109_13 の中央）。黒い棟の西隣の低い棟の、北の面いっぱいに 1 枚。真後ろにホテル棟の壁が立つ
  136587824: [{ near: [-116, 16], panels: [{ t0: 0.02, t1: 0.98, y0: 3.4, y1: 11.7, kind: 'board', ref: ART.bigRed }] }],
  // 文化村通りの北の棟（109_07 の中央）。左から: 縦のリブの灰色の壁（足元に映像の小窓と白いロゴの板、上の階は暗い窓の列が 2 筋）、
  // テナントの袖看板の列、濃い灰色に白い斜めの光の線の細い面（中ほどに白い縦長の板）
  60739633: [
    {
      near: [-119, -30],
      panels: [
        // 第16ラウンドの練習判定 2 回目（109_08）: 下半分（店先の上から 5 階の床まで）は濃い灰色の縦のリブの壁 1 枚で、右寄りに白い印、
        // 左寄りに映像の小窓。その上は明るい灰色の壁に暗い窓の列
        { t0: 0.07, t1: 0.25, y0: 17.4, y1: 27.8, kind: 'color', ref: 0x2b2e33 },
        { t0: 0.31, t1: 0.5, y0: 17.4, y1: 27.8, kind: 'color', ref: 0x2b2e33 },
        { t0: 0, t1: 0.555, y0: 3.6, y1: 15.6, kind: 'board', ref: ART.ribWall },
        { t0: 0.06, t1: 0.2, y0: 5.4, y1: 12, kind: 'screen', ref: 1, out: 0.12 },
        ...[0xf2f2ee, 0x17181c, 0xf2f2ee, 0xd5281f, 0xf2f2ee, 0x17181c, 0xf2f2ee].map((ref, k) => ({ t0: 0.565, t1: 0.625, y0: 5.4 + k * 2.5, y1: 7.5 + k * 2.5, kind: 'color' as const, ref })),
        { t0: 0.64, t1: 0.9, y0: 3.6, y1: 29.6, kind: 'board', ref: ART.slashLines },
        { t0: 0.78, t1: 0.835, y0: 13, y1: 27, kind: 'color', ref: C.white, out: 0.08 },
        { t0: 0.9, t1: 1, y0: 3.6, y1: 29.6, kind: 'color', ref: 0x26282c },
      ],
    },
  ],
  136690945: [{ near: [-105.3, -25], panels: [{ t0: 0.04, t1: 0.96, y0: 8.5, y1: 22.6, kind: 'board', ref: ART.greenFigure }] }],
  // 白い円筒状の棟（109_07 の中央左）。右の角に青い縦長のビジョン（白い字の帯 3 本。字は描かない）、左に階ごとの窓の看板
  136690946: [
    {
      near: [-143.7, -41.5],
      panels: [
        { t0: 0.68, t1: 0.96, y0: 9.5, y1: 29.5, kind: 'color', ref: 0x2437e0 },
        { t0: 0.73, t1: 0.91, y0: 20.6, y1: 21.7, kind: 'color', ref: C.white, out: 0.08 },
        { t0: 0.71, t1: 0.93, y0: 18.6, y1: 19.7, kind: 'color', ref: C.white, out: 0.08 },
        { t0: 0.75, t1: 0.89, y0: 16.6, y1: 17.7, kind: 'color', ref: C.white, out: 0.08 },
        { t0: 0.7, t1: 0.94, y0: 4.2, y1: 8.2, kind: 'screen', ref: 0 },
        ...[0xf2f2ee, 0x17181c, 0xd5281f, 0xf2f2ee, 0x17181c, 0xf2f2ee].map((ref, k) => ({ t0: 0.5, t1: 0.63, y0: 7.2 + k * 3.4, y1: 8.9 + k * 3.4, kind: 'color' as const, ref })),
      ],
    },
  ],
  // 交差点の北西、ゲートの左の街区（scramble_08/23、scramble_13 の右）。南の面と隅切りに、色面のはっきりした縦長・横長の板
  136690966: [
    {
      near: [-59.2, -23.9],
      panels: [
        { t0: 0.03, t1: 0.17, y0: 7.5, y1: 21, kind: 'board', ref: ART.wallBlue },
        { t0: 0.82, t1: 0.92, y0: 6.5, y1: 22, kind: 'board', ref: ART.wallRedWhite },
      ],
    },
    {
      near: [-42, -28.3],
      panels: [
        { t0: 0.06, t1: 0.94, y0: 7.5, y1: 17.5, kind: 'board', ref: ART.wallBlackPink },
        { t0: 0.06, t1: 0.94, y0: 18.6, y1: 23, kind: 'board', ref: ART.wallWhiteBlue },
      ],
    },
    // センター街の中の Y 字路の角（center-gai_15 の右手前）。北西の隅切りと通りに面した面の上の階に提灯の格子、足元に木目の店先の帯
    {
      near: [-67.6, -57.35],
      panels: [
        { t0: 0, t1: 1, y0: 12.5, y1: 20.5, kind: 'board', ref: ART.lanterns },
        { t0: 0, t1: 1, y0: 3.4, y1: 6.2, kind: 'board', ref: ART.woodShop },
      ],
    },
    {
      near: [-52.2, -44.5],
      panels: [
        { t0: 0.8, t1: 1, y0: 12.5, y1: 20.5, kind: 'board', ref: ART.lanterns },
        { t0: 0.72, t1: 1, y0: 3.4, y1: 6.2, kind: 'board', ref: ART.woodShop },
      ],
    },
    {
      near: [-71.5, -39.7],
      panels: [
        { t0: 0, t1: 0.2, y0: 12.5, y1: 20.5, kind: 'board', ref: ART.lanterns },
        { t0: 0, t1: 0.3, y0: 3.4, y1: 6.2, kind: 'board', ref: ART.woodShop },
      ],
    },
  ],
  // 交差点の南西の角の棟（dogenzaka_01 の中央、scramble_13・109_14 の左）。道玄坂に面した北の面と西の面は、階ごとに赤い帯が入り、
  // 北の面の東寄りに縦に長い赤い看板。交差点の側（東の面）は人物と赤白の板
  // 第17ラウンド（scramble_13 の左）: 道玄坂の面の交差点寄りの端に、足元の店先の上から屋上の立ち上がりの上まで届く縦長の寄せ絵の広告面。
  // 交差点へ向いた隅切りの面は、階ごとの店の看板の帯が縦に詰まる（大型ビジョンは屋上と東の面にあり、この面には掛からない）
  60739635: [
    {
      near: [-61.5, 7.7],
      panels: [...stripes(8, 7.4, 3.4, 1.15, STRIPE_RED), { t0: 0.8, t1: 0.94, y0: 6.5, y1: 31, kind: 'board', ref: ART.wallRedWhite }, { t0: 0.02, t1: 0.37, y0: 6.2, y1: 36.6, kind: 'board', ref: ART.collage }],
    },
    { near: [-48, 13.9], panels: cornerSigns(7, 5.2, 3.4, 1.9) },
    { near: [-72, 16.5], panels: stripes(8, 7.4, 3.4, 1.15, STRIPE_RED) },
    {
      near: [-46.2, 36.9],
      panels: [
        { t0: 0.52, t1: 0.9, y0: 8, y1: 22, kind: 'board', ref: ART.wallBlueFigure },
        { t0: 0.1, t1: 0.44, y0: 10, y1: 21, kind: 'board', ref: ART.wallRedWhite },
      ],
    },
  ],
  // その西の低い白い棟: 2〜3 階に黄色い大看板。細い青い棟: 頂部に白い板
  844691964: [{ near: [-78.5, 9.5], panels: [{ t0: 0.04, t1: 0.96, y0: 8.2, y1: 14.2, kind: 'board', ref: ART.wallYellow }] }],
  116806276: [{ near: [-85, 9.5], panels: [{ t0: 0.08, t1: 0.92, y0: 20.5, y1: 26.5, kind: 'color', ref: C.white }] }],
  // 宮益坂下の北西の角の棟（miyamasuzaka_01 の左端）。広場へ向いた面に、階ごとの店の看板の帯を縦に詰める
  155749492: [{ near: [131, -21], panels: signStack(9, 5.2, 3.5, 2.1) }],
  116806279: [{ near: [124, -13.5], panels: signStack(9, 5.2, 3.5, 2.1) }],
  // センター街の桃色の棟（center-gai_08/09/11/12 の右半分。地図の 136690959）。
  // 通りの面（北）: 面いっぱいに桃色の枠のガラスの窓割りと階ごとの青い帯の看板。通りに沿って奥へ逃げる面として斜めに見える。
  // 路地の面（西）: 濃い桃色の壁の手前寄りに、明るい大型ビジョン（右の奥に外階段: PINK_STAIR）
  136690959: [
    { near: [-154.5, -85.5], panels: [{ t0: 0.02, t1: 0.98, y0: 4.6, y1: 26.6, kind: 'board', ref: ART.pinkGlass }] },
    { near: [-162, -80.9], panels: [{ t0: 0.08, t1: 0.44, y0: 5.6, y1: 11, kind: 'screen', ref: 0, out: 0.5 }] },
  ],
  // その手前、路地の口の西の角の灰色の棟（center-gai_11/12 の右端。地図の 136690944）。通りの面の東の端に白と黄の縦長の袖看板、店先に白い帯
  136690944: [
    {
      near: [-169.9, -91.6],
      panels: [
        { t0: 0.02, t1: 0.16, y0: 6.5, y1: 16.5, kind: 'color', ref: C.white, out: 0.9 },
        { t0: 0.03, t1: 0.15, y0: 18, y1: 24.5, kind: 'color', ref: 0xf2c230, out: 0.9 },
        { t0: 0.2, t1: 0.98, y0: 3.4, y1: 5.2, kind: 'color', ref: C.white, out: 0.3 },
      ],
    },
  ],
  // センター街の中から駅向きに見える、分岐の角のガラスの棟（center-gai_11 の画面中央）。角を回って足元に黒い帯の看板、隅切りの中ほどにもう 1 枚。
  // 桃色は右の棟だけの色なので、ここには載せない
  136690970: [
    { near: [-116.5, -60], panels: [{ t0: 0.02, t1: 0.98, y0: 6.2, y1: 7.9, kind: 'board', ref: ART.blackBand }, CORNER_GLASS] },
    { near: [-113.1, -65.2], panels: [{ t0: 0, t1: 1, y0: 6.2, y1: 7.9, kind: 'color', ref: C.black }, CORNER_GLASS] },
    { near: [-109, -67], panels: [{ t0: 0.02, t1: 0.98, y0: 6.2, y1: 7.9, kind: 'board', ref: ART.blackBand }, CORNER_GLASS] },
    { near: [-104.1, -66.5], panels: [{ t0: 0, t1: 1, y0: 6.2, y1: 7.9, kind: 'color', ref: C.black }, CORNER_GLASS] },
  ],
  // 道玄坂下の北の角の棟（109_09/12・dogenzaka_12/13 の左手前）の格子と袖看板は mapLattice.ts
  116806281: [
    {
      near: [24.3, -47],
      panels: [
        { t0: 0.56, t1: 0.96, y0: 9, y1: 22, kind: 'screen', ref: 1 },
        { t0: 0.1, t1: 0.48, y0: 10, y1: 21, kind: 'board', ref: ART.wallRedWhite },
        { t0: 0.04, t1: 0.96, y0: 24, y1: 26.5, kind: 'color', ref: C.red },
      ],
    },
  ],
}

/**
 * 隣の棟に接していて、その屋上より上だけが見える面の決めごと（FACE_DECOS と同じ形。面の前が隣の棟の中でもよい）。
 * 塔の手前の棟（center-gai_11 の中央上、塔の右下に重なる）: センター街の側の北の面は、上の階が白い外壁で、外階段の踊り場が段々に並ぶ
 */
export const UPPER_FACE_DECOS: Record<number, FaceDeco[]> = {
  // 高い部分は南西の側だけ（mapBlockStyles.ts の STEPPED_BANK）なので、センター街から見えるのは西の面。北の面は段の高さまで
  114755219: [
    { near: [-85.5, -50.75], panels: backStair(20, 29.6) },
    { near: [-98.75, -38], panels: backStair(30.6, 38.6) },
  ],
}

/**
 * 桃色の棟の路地の面（西）の奥寄りに付く外階段（center-gai_11/12 の桃色の棟の右上）。壁と同じ桃色の柱と踊り場が、屋上まで段々に重なる。
 * near = 階段が付く面を選ぶ点、t0..t1 = 面の中の範囲（外から見て左が 0）、out = 壁からの出 m、tier = 踊り場の間隔 m
 */
export const PINK_STAIR = { building: 136690959, near: [-162, -80.9] as [number, number], t0: 0.6, t1: 0.9, out: 2.2, tier: 3.4, color: 0xf0468c, rail: 0xe23a7c } as const

/**
 * 輪郭の辺のうち、中点が near にいちばん近い辺。外から見て左を a・右を b にして返す（minLen m より短い辺は選ばない）。
 * 法線は輪郭の重心から外へ向く
 */
export function pickEdge(pts: Flat, near: readonly [number, number], minLen = 2): Edge | null {
  const n = pts.length / 2
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2] / n
    cz += pts[i * 2 + 1] / n
  }
  let best: Edge | null = null
  let bestDist = Infinity
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const x0 = pts[j * 2]
    const z0 = pts[j * 2 + 1]
    const x1 = pts[i * 2]
    const z1 = pts[i * 2 + 1]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < minLen) continue
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const d = Math.hypot(mx - near[0], mz - near[1])
    if (d >= bestDist) continue
    let nx = (z1 - z0) / len
    let nz = -(x1 - x0) / len
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    // 外から壁を見たときの右向き
    const rx = nz
    const rz = -nx
    const firstIsLeft = (x0 - mx) * rx + (z0 - mz) * rz < 0
    bestDist = d
    best = { ax: firstIsLeft ? x0 : x1, az: firstIsLeft ? z0 : z1, bx: firstIsLeft ? x1 : x0, bz: firstIsLeft ? z1 : z0, nx: nx + 0, nz: nz + 0, len }
  }
  return best
}

/** 建物の壁面の決めごとを、面の四隅（辺の中の範囲と高さ）に直す。decos を省くと FACE_DECOS と UPPER_FACE_DECOS の両方 */
export function facePanels(b: Pick<MapBuilding, 'id' | 'pts'>, decos: FaceDeco[] = [...(FACE_DECOS[b.id] ?? []), ...(UPPER_FACE_DECOS[b.id] ?? [])]): FacePanel[] {
  return decos.flatMap((d) => {
    const e = pickEdge(b.pts, d.near)
    if (!e) return []
    return d.panels.map((p) => ({
      ax: e.ax + (e.bx - e.ax) * p.t0,
      az: e.az + (e.bz - e.az) * p.t0,
      bx: e.ax + (e.bx - e.ax) * p.t1,
      bz: e.az + (e.bz - e.az) * p.t1,
      nx: e.nx,
      nz: e.nz,
      len: e.len * (p.t1 - p.t0),
      y0: p.y0,
      y1: p.y1,
      kind: p.kind,
      ref: p.ref,
      out: p.out ?? 0,
    }))
  })
}

/**
 * ハチ公前広場の南の解体現場（scramble_03/18）。地図に足した建物（scripts/gto-bake-map.mjs の EXTRA_BUILDINGS）を
 * 黒い幕の足場として描き、広場へ向いた面に白い仮囲いと人物の大きな広告面を載せる
 */
export const WEST_SITE = {
  building: 9100000001,
  hoardingH: 3,
  hoardingOut: 0.9,
  hoardingNear: [
    [36, 78],
    [18.5, 91.5],
  ] as [number, number][],
  ad: { near: [36, 78] as [number, number], t0: 0.34, t1: 0.86, y0: 8.5, y1: 20.5, art: ART.wallBlueFigure },
} as const

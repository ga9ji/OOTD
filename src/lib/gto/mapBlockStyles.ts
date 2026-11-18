// Grand Theft Outfit [部品: city] 現地写真から起こした、建物ごとの外装と屋上の広告塔の表。three/DOM なし。
// 入口: BLOCK_STYLES / EXTRA_BOARDS（map.ts の blockStyleOf / boardSpecsOf が読む）
// 契約: OSM の id で建物を指す。色・壁の種類・高さ関係・板の位置と大きさだけを写真から写す。絵柄と店名は架空。
import type { BlockStyle, BoardSpec } from './map'

/** 宮益坂下の広場（東口のバス乗り場側）。正面の街区の広告塔はここへ向く */
const MIYAMASU_PLAZA: [number, number] = [140, 14]

/** スクランブル交差点のハチ公側の角（scramble_08 の立ち位置） */
const HACHIKO_CORNER: [number, number] = [6, 10]

/** 文化村通りの北の角の棟（地図の 114755219）の段。from m より上は pts の輪郭だけ（西の面と南の面はそのまま、北東の隅を落とす） */
export const STEPPED_BANK = { from: 29, pts: [-76.3, -35.5, -77.7, -21.4, -101.5, -23.9, -96.5, -49.5] }

/** 形を作り込む建物（大型ビジョンの雑居ビル）の屋上に足す広告塔。scramble_08 の左の街区: 青と緑の 2 段、赤白の横長 */
export const EXTRA_BOARDS: Record<number, BoardSpec[]> = {
  136690966: [
    { toward: HACHIKO_CORNER, w: 8.5, h: 9.5, art: 4, lift: 9.5, shift: -5 },
    { toward: HACHIKO_CORNER, w: 9, h: 4.6, art: 3, lift: 9, shift: 7 },
  ],
  // ハチ公側の低い駅舎の屋上（scramble_14/16: 交差点へ向いた赤白の横長の板と、その横の小さな板）
  904652357: [
    { toward: [-28, -33], w: 15, h: 5.5, art: 3, lift: 1.4, shift: -6 },
    { toward: [-28, -33], w: 9, h: 4.2, art: 6, lift: 1.2, shift: 10 },
  ],
  // 連絡通路の屋上（scramble_14/17: ガラスの箱の上に、交差点へ向いた赤白の横長の板）
  355250634: [{ toward: [-28, -33], w: 14, h: 6, art: 3, lift: 1.2, shift: 4 }],
}

export const BLOCK_STYLES: Record<number, BlockStyle> = {
  // ---- 宮益坂下の正面を塞ぐ街区（miyamasuzaka_01/02）。左から白い庇の棟・茶と白の棟・白い横連窓の角の棟 ----
  120105805: { facade: 'ribbon', color: 0xf1f0ec, shop: 0xf4f1ea },
  155797253: { facade: 'office', color: 0xd9cdbb, shop: 0xe9e4d8, boards: [{ toward: MIYAMASU_PLAZA, w: 11, h: 10, art: 0, lift: 1.6 }] },
  120105789: { facade: 'ribbon', color: 0xeceeee, shop: 0xd9c9a8, raise: 1, boards: [{ toward: MIYAMASU_PLAZA, w: 13.5, h: 9, art: 1, lift: 1.8 }] },
  // ---- スクランブル交差点の北西、角のガラスのビルの左奥に立つ白いビル。屋上に丸い印の白い箱（scramble_08） ----
  // ---- センター街の中ほど、外壁が全面濃い桃色で大型ビジョンを載せた棟（center-gai_08/09/11/12 の右半分。駅向きに見て右＝通りの南側） ----
  // 地図の 136690959。南へ抜ける路地の口の東の角に立ち、通りの面（北）が桃色の枠のガラス、路地の面（西）が濃い桃色の壁に大型ビジョンと外階段。
  // 靴屋の角の棟（136690970）はここから 45m 先。高さ（8 階建て）は scripts/gto-bake-map.mjs、窓割りとビジョンは mapFacade.ts
  136690959: { facade: 'blank', color: 0xf0468c, shop: 0xe23a7c, lit: true },
  // ---- その手前（路地の口の西の角）の灰色のタイルの棟（center-gai_11/12 の右端）。白い縦長の袖看板と店先の白い帯は mapFacade.ts ----
  136690944: { facade: 'tile', color: 0xb9b3a8, shop: 0xf2f2ee },
  // ---- センター街の中から駅向きに見える分岐の角の棟（center-gai_11/12 の中央）。銀色がかった明るいガラス張りの 6 階建て。
  //      この棟の真上に駅直上の高層棟が立つ（center-gai_12）ので、かさ上げしない ----
  // 夜は 1 階の店先も中から白く灯る（center-gai_09: 通りの奥の足元がいちばん明るい）
  136690970: { facade: 'curtain', color: 0xcfdbe6, shop: 0xfff3dc },
  // その手前（横道の西）の通り沿いの細い棟。桃色の棟の奥の端と靴屋の棟の間にのぞくので、同じ明るいガラスにして 1 つの面に見せる
  136690967: { facade: 'curtain', color: 0xcfdbe6, shop: 0x17181c },
  // ---- 宮益坂下の交差点の北、明治通りの東の並び（miyamasuzaka_02 の左半分）。白と灰の中層棟が隙間なく壁になる ----
  120105793: { facade: 'office', color: 0xeef1f4, shop: 0xf4f1ea },
  120105798: { facade: 'ribbon', color: 0xd9dee3, shop: 0xe9e4d8, raise: 1 },
  120105794: { facade: 'office', color: 0xf1f3f5, shop: 0xf4f1ea },
  // ---- 宮益坂下の北、明治通りの西の映画館のビル（towers_16 の右手前）。白いパネルの外壁。丸い角と案内塔は mapEast.ts の NORTH_PLAZA ----
  120105804: { facade: 'ribbon', color: 0xf2f6fa, shop: 0xf4f1ea },
  // ---- センター街の奥。地図の高さが 2m（部品の取り違え）なので、ガラスの中層棟として建てる ----
  136730000: { facade: 'curtain', color: 0x7ea6cc, shop: 0x2b2b2e, raise: 10 },
  // 坂の南の角。茶色いタイルに横連窓、屋上に白い楕円の広告塔
  138589860: { facade: 'ribbon', color: 0xc98a5c, shop: 0xa86a48, raise: -1, boards: [{ toward: MIYAMASU_PLAZA, w: 13, h: 6.5, art: 2, lift: 2.2, shift: -4 }] },
  355252205: { facade: 'ribbon', color: 0xc98a5c, shop: 0xa86a48 },
  // ---- 109 の分岐の先端のまわり（dogenzaka_07）。文化村通りの向かいは暗い外壁の前に鉄骨の格子の棟（格子と袖看板は mapLattice.ts）、道玄坂の向かいは黒い外壁に低い位置の大型ビジョン ----
  // センター街の中から駅向きに見ると（center-gai_09/11）、この棟の高い部分は塔の右半分にだけ重なり、塔の左半分は角のガラスの棟の屋根のすぐ上まで見える。
  // 地図の輪郭のまま 38m まで建てると、塔の幅いっぱいを屋上まで塞ぐ（第15ラウンドの外れ: 通りの突き当たりの上に塔が無い）。
  // 北東の隅（センター街の立ち位置から見て方角 124 度より左）は 29m で止め、その上は南西の側だけを建てる
  114755219: { facade: 'ribbon', color: 0x565d64, shop: 0xf4f1ea, upper: { from: STEPPED_BANK.from, pts: STEPPED_BANK.pts }, boards: [{ toward: HACHIKO_CORNER, w: 9, h: 8, art: 5, lift: 1.5 }, { toward: HACHIKO_CORNER, w: 7.5, h: 4.2, art: 7, lift: 1.2, shift: 9.5 }] },
  // ---- 文化村通りの北（109_04〜08）。濃い灰色の外壁に白い斜めの光の線の棟、その右の細い棟は緑の縦長の広告と黄色い店先、左は暗い外壁の棟 ----
  // 第16ラウンドの練習判定（109_07）: 斜めの線の濃い面は右の細い 1 棟ぶんだけ。棟の左 6 割は縦のリブの灰色の壁（足元にロゴと映像の小窓、上は暗い窓の列）、
  // その左隣は白い円筒状の棟（階ごとの窓の看板、右の角に青い縦長の曲面ビジョン）
  60739633: { facade: 'blank', color: 0x74787c, shop: 0x1c1d20 },
  136690945: { facade: 'office', color: 0x8d9298, shop: 0xf2c230 },
  136690946: { facade: 'office', color: 0xe9e9e4, shop: 0x2b2b2e },
  // ---- 道玄坂の南（109_10/13、dogenzaka_01/07）。東から、白い棟（9 階。北の面に 2 段 2 列の広告、屋上に赤い字の看板）・
  //      黒い外壁に屋上の大型ビジョンの棟（5 階）・赤い大看板の低い棟（3 階）・橙の店先の低い棟。低い棟の上は背後のホテル棟の壁 ----
  116710254: { facade: 'office', color: 0xf2f2ee, shop: 0xf4f1ea, boards: [{ toward: [-150, 14], w: 15, h: 3.4, art: 30, lift: 0.2 }] },
  136587748: { facade: 'blank', color: 0x0e0f12, shop: 0x121316 },
  136587824: { facade: 'ribbon', color: 0xe6e2da, shop: 0xd5281f },
  // 橙の店先の棟（109_13 の右、庇の上）。屋上に、通りへ向いた大きな広告の板が 2 段に組まれている（上は青い横長、下は桃色と白）
  136587721: {
    facade: 'ribbon',
    color: 0xe6e2da,
    shop: 0xe9742b,
    boards: [
      { toward: [-128, -30.5], w: 15, h: 8, art: 4, lift: 10.5 },
      { toward: [-128, -30.5], w: 7.5, h: 8.6, art: 5, lift: 1.2, shift: 3.6 },
      { toward: [-128, -30.5], w: 6.4, h: 8.6, art: 2, lift: 1.2, shift: -3.8 },
    ],
  },
  // ---- 道玄坂の南、白い棟の東（dogenzaka_01 の画面の中央）。東から、角の 9 階建て（明るい外壁に階ごとの赤い帯、屋上に黄色い広告塔、
  //      交差点の側に大型ビジョン）・4 階建ての低い棟（地図の高さを直してある。黄色い大看板は mapFacade.ts）・細くて高い青い棟 ----
  60739635: { facade: 'ribbon', color: 0xefe4d2, shop: 0x2b2b2e, vision: { toward: [0, 0], tile: 1 }, boards: [{ toward: [-112, -21], w: 6.5, h: 11, art: 6, lift: 1.6 }] },
  116806276: { facade: 'blank', color: 0x2148a8, shop: 0xf2c230, raise: 2 },
  // ---- 宮益坂下の交差点の北西の角（miyamasuzaka_01 の左端）。暗いガラスの曲面に、階ごとの店の看板が縦に詰まった高い棟 ----
  155749492: { facade: 'curtain', color: 0x4f5c68, shop: 0x2b2b2e },
  116806279: { facade: 'curtain', color: 0x56636e, shop: 0x2b2b2e },
  // その西の棟。通りに面した低い基壇の奥に小窓の並ぶ白っぽい高い棟が立つ。
  // 高い部分は輪郭の西・奥寄りだけ
  136587834: { facade: 'ribbon', color: 0xe4e2dc, shop: 0xd5281f, tower: { podium: 12.5, pts: [-165.7, 38.8, -148.9, 31.8, -141.2, 47.8, -158, 54.8], color: 0xdcdedd } },
}

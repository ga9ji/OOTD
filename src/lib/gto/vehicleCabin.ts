// Grand Theft Outfit [部品: vehicle] 車室の寸法: 前のドアの枠と、座席・頭の位置。
// 入口: VEHICLE_CABIN / cabinLayout(spec, look) / doorSwing(open)
// 契約: 車の寸法と断面（vehicleShape.ts の VEHICLE_LOOK）だけから、車体の座標で返す。
//       車体の座標: 前が −z、右が ＋x、路面が y=0。左右は「車体の中心からの距離」で返すので、使う側（＋1 が右、−1 が左）を掛ける。
//       描画（components/gto/vehicleDoors.ts）はこれでドアの板と開口を作り、乗り降りの担当は座席と頭の位置に人物を置く。
import { clamp } from './math'

/** 車室を決める数字 */
export const VEHICLE_CABIN = {
  /** いっぱいに開いた角度 rad（約 65°） */
  swing: 1.13,
  /** 敷居の高さ（床下から m） */
  sill: 0.1,
  /** 座席の左右の位置（車幅の半分に対する割合）と、前後の位置（ドアの枠の前端から後端への割合） */
  seatSide: 0.44,
  seatBack: 0.62,
  /** 座面の高さ（床下から m）と、頭の中心の高さ（肩の線から屋根までの割合） */
  seatUp: 0.26,
  headUp: 0.52,
  /** 頭の大きさの目安 m（屋根に当たらないかの確認に使う） */
  headRadius: 0.11,
}

/** 車体の断面のうち、車室を決めるのに使う分（vehicleShape.ts の Station と同じ並び） */
export interface CabinStation {
  z: number
  belt: number
  roof?: number
  w: number
  wRoof?: number
  pillar?: boolean
}

export interface CabinLook {
  clearance: number
  stations: CabinStation[]
}

export interface CabinLayout {
  /** 前のドアの枠 */
  door: {
    /** ヒンジ（前の端）と後ろの端の前後の位置 m */
    hingeZ: number
    rearZ: number
    /** 敷居・肩（窓の下の線）・屋根の高さ m */
    sillY: number
    beltY: number
    roofY: number
    /** 肩と屋根での、車体の中心から側面までの距離 m */
    halfBelt: number
    halfRoof: number
  }
  /** 座った人物の腰と頭の中心（x は中心からの距離。使う側の符号を掛ける） */
  seat: { x: number; y: number; z: number }
  head: { x: number; y: number; z: number }
}

/** 車の寸法と断面から、前のドアの枠と座席の位置を出す */
export function cabinLayout(spec: { length: number; width: number; height: number }, look: CabinLook): CabinLayout {
  const tune = VEHICLE_CABIN
  const st = look.stations
  const firstRoof = Math.max(
    1,
    st.findIndex((s) => s.roof != null),
  )
  // ヒンジは屋根が始まる1つ前の断面（フロントガラスの付け根）
  const cowl = st[firstRoof - 1]
  const roofed = st.filter((s) => s.roof != null)
  const lastRoof = roofed[roofed.length - 1] ?? st[st.length - 1]
  // 後ろの端は最初の柱。柱が無ければ屋根の真ん中
  const pillar = st.find((s, i) => i >= firstRoof && s.pillar) ?? null
  const rearFrac = pillar ? pillar.z : (st[firstRoof].z + lastRoof.z) / 2
  const mid = pillar ?? st[firstRoof]
  const hingeZ = cowl.z * spec.length
  const rearZ = Math.max(hingeZ + 0.6, rearFrac * spec.length)
  const beltY = mid.belt * spec.height
  const roofY = (mid.roof ?? 1) * spec.height
  const halfBelt = (mid.w * spec.width) / 2
  const halfRoof = ((mid.wRoof ?? mid.w) * spec.width) / 2
  const seatX = Math.min((spec.width / 2) * tune.seatSide, halfRoof - tune.headRadius - 0.04)
  const seatZ = hingeZ + (rearZ - hingeZ) * tune.seatBack
  return {
    door: { hingeZ, rearZ, sillY: look.clearance + tune.sill, beltY, roofY, halfBelt, halfRoof },
    seat: { x: seatX, y: look.clearance + tune.seatUp, z: seatZ },
    head: { x: seatX, y: Math.min(beltY + (roofY - beltY) * tune.headUp, roofY - tune.headRadius - 0.03), z: seatZ },
  }
}

/** 開き具合 0〜1 を、ヒンジまわりの角度 rad に直す（開き始めと開き終わりがなだらか） */
export function doorSwing(open: number): number {
  const k = clamp(open, 0, 1)
  return VEHICLE_CABIN.swing * k * k * (3 - 2 * k)
}

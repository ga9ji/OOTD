// Grand Theft Outfit [部品: traffic-peds] 交通の車が、交差点で譲るかどうか。
// 入口: yieldBack / inboundEdge
// 契約: 信号の無い交差点では格上の道の車に、右折では対向の直進に譲る。譲るなら、交差点の節の手前
//       何 m で待つかを返す（交わる道の幅のぶん手前。鼻先を相手の車線へ出さない）。
//       相手が速いほど遠くから見る（曲がり始めてから気づいて、交差点の中で横向きに止まらない）。
import type { SignalNet } from './graph'
import { angleDiff, headingOf, pointAlong } from './math'
import { rankOf, TRAFFIC_TUNING, turnBetween, type Hazard } from './trafficLane'
import type { GraphEdge, RoadGraph } from './types'

/** 交通ではない車が、辺 mine の終点の交差点へ向かって走っているとき、その車が入ってくる辺（自分と同じ辺は除く）。無ければ null */
export function inboundEdge(graph: RoadGraph, mine: GraphEdge, h: Hazard): GraphEdge | null {
  if ((h.speed ?? 0) < 2 || h.heading == null) return null
  const node = graph.nodes[mine.to]
  // 交差点から遠ざかっている車は関係ない
  if (Math.abs(angleDiff(h.heading, headingOf(node.x - h.x, node.z - h.z))) > 0.7) return null
  for (const id of node.out) {
    const back = graph.edges[id]
    // 交差点から出る辺の逆向き = 交差点へ入る辺。一方通行なら、同じ道で交差点へ入る辺を探す
    const inbound = back.rev >= 0 ? graph.edges[back.rev] : null
    if (!inbound || inbound.id === mine.id) continue
    if (Math.abs(angleDiff(pointAlong(inbound.pts, inbound.cum, inbound.length).heading, h.heading)) < 0.6) return inbound
  }
  for (const e of graph.edges) {
    if (e.to !== mine.to || e.id === mine.id || e.rev >= 0) continue
    if (Math.abs(angleDiff(pointAlong(e.pts, e.cum, e.length).heading, h.heading)) < 0.6) return e
  }
  return null
}

/** 譲る車 */
interface Yielder {
  id: number
  speed: number
}

/**
 * 辺 edge から nextE へ進む車が、edge の終点の交差点で譲るなら、節の手前何 m で待つか。譲らないなら null。
 * toNode は、車からその節までの道のり（先の辺の交差点を見るときは、手前の辺のぶんも足した長さ）。
 * skip は、同じ道筋の上にいるので相手にしない辺（自分の走っている辺）。
 */
export function yieldBack(
  graph: RoadGraph,
  net: SignalNet,
  v: Yielder,
  edge: GraphEdge,
  nextE: GraphEdge,
  toNode: number,
  hazards: Hazard[],
  skip = -1,
): number | null {
  const T = TRAFFIC_TUNING
  const node = graph.nodes[edge.to]
  const myEnd = pointAlong(edge.pts, edge.cum, edge.length).heading
  const turn = turnBetween(edge, nextE)
  const signalled = net.signalNode[edge.to]
  let giveWay = false
  for (const h of hazards) {
    if (h.id < 0 || h.id === v.id || h.edge === edge.id || h.edge === skip || h.parked || h.heading == null) continue
    const dn = Math.hypot(h.x - node.x, h.z - node.z)
    // 速い相手ほど遠くから見る
    if (dn > Math.max(T.yieldRange, Math.min(T.yieldRangeMax, (h.speed ?? 0) * T.yieldEta))) continue
    // 交差点の中で止まっている対向の車（主人公や警察）の前を、右折で横切らない（鼻先を突っ込んで向かい合ったまま動けなくなる）
    if (h.edge == null && turn > 0.6 && dn < 14 && Math.abs(angleDiff(h.heading, myEnd)) > 2.3) {
      giveWay = true
      break
    }
    // 交通の車は走っている辺で、そうでない車（主人公や警察）は向きから、この交差点へ入ってくる辺を決める
    const oe = h.edge != null ? graph.edges[h.edge] : inboundEdge(graph, edge, h)
    if (!oe || oe.to !== edge.to) continue
    const eta = dn / Math.max(h.speed ?? 0, 3)
    const oncoming = Math.abs(angleDiff(h.heading ?? 0, myEnd)) > 2.3
    if (oncoming) {
      // 右折は、対向の直進を先に通す
      if (turn > 0.6 && eta < T.yieldEta && (h.speed ?? 0) > 1) giveWay = true
    } else if (!signalled) {
      const mine = rankOf(edge)
      const theirs = rankOf(oe)
      if (theirs > mine ? eta < T.yieldEta : theirs === mine && (h.edge == null || h.id < v.id) && eta < 3 && (h.edge == null ? eta < toNode / Math.max(v.speed, 3) + 1.5 : dn < toNode + 4)) giveWay = true
    }
    if (giveWay) break
  }
  if (!giveWay) return null
  // 交わる道の幅のぶん手前で待つ（鼻先を相手の車線へ出さない）
  let cross = 0
  for (const id of node.out) if (id !== edge.rev && id !== nextE.id) cross = Math.max(cross, graph.edges[id].width)
  return Math.max(T.yieldBack, cross / 2 + T.nose + 0.6)
}

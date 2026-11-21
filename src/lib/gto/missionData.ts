// Grand Theft Outfit [部品: missions] ミッションの中身（表）。登場人物・筋書き・店はすべて架空。
// 通りと坂の名前だけ実名。進め方（数え方・失敗の条件）は missions.ts が持つ。
// 座標は地図と同じ（x=東が＋、z=南が＋、m）。場所が歩ける所にあることはテストで確かめている。
// [areas] 依頼はエリアごとの表に分ける。MISSIONS は渋谷、SHINJUKU_MISSIONS は新宿。依頼人が立つのは、いまいるエリアの依頼だけ
//         （missionsOf）。id は全エリアを通して重ならない（達成の記録は 1 本の列に残す。ALL_MISSIONS）。
import type { AreaId, Flat } from './types'

interface StepBase {
  /** いまの目的（HUD と演出に出す） */
  text: string
  /** text の中で色を変えて目立たせる言葉（相手や場所の名前） */
  accent?: string
  /** この手順に入ったときの依頼人の台詞 */
  say?: string
  /** この手順に入ったとき、残り時間をこの秒数にする */
  timeLimit?: number
  /** この手順に入ったとき、前の手順の残り時間にこの秒数を足す */
  addTime?: number
}

/** 見回り。path を行ったり来たりし（1点なら立ち止まり）、半径 radius の輪の中にいる主人公を怪しむ */
export interface Guard {
  path: Flat
  speed: number
  radius: number
}

export type MissionStep =
  /**
   * 指定の場所へ行く。vehicle が true なら車に乗ったまま着くこと。fragile は「ぶつけてよい回数」（運ぶ）。
   * guards は「輪に入ってはいけない見回り」、noHeat は「手配を付けたまま来てはいけない」（どちらも満ちると失敗。fragile とは併用しない）
   * onFoot が true なら、車を降りて歩いて着くこと（そこに受け取る人が立つ。vehicle とは併用しない）
   */
  | (StepBase & {
      kind: 'goto'
      x: number
      z: number
      radius: number
      vehicle?: boolean
      onFoot?: boolean
      fragile?: number
      guards?: Guard[]
      noHeat?: boolean
    })
  /** 通行人の服を count 着奪う */
  | (StepBase & { kind: 'steal'; count: number })
  /** 車に乗る */
  | (StepBase & { kind: 'vehicle' })
  /** 手配度を 0 に戻す */
  | (StepBase & { kind: 'escape' })
  /** 道筋を歩く相手を尾ける。near より近いと警戒され、far より遠いと見失う */
  | (StepBase & { kind: 'tail'; path: Flat; speed: number; delay: number; near: number; far: number })

export interface MissionDef {
  id: string
  title: string
  /** 依頼人（架空の人物） */
  giver: string
  /** 引き受けたときの依頼人の台詞 */
  brief: string
  /** このミッションが開いたときに出す知らせ（誰が、どこで待っているか） */
  hook: string
  /** この id のミッションを達成すると開く（無ければ最初から開いている） */
  after?: string
  start: { x: number; z: number }
  steps: MissionStep[]
  /** 報酬（円） */
  reward: number
  /** 最後に残った時間 1 秒あたりの上乗せ（円） */
  timeBonus?: number
  /** 服にしわを付けずに運びきったときの上乗せ（円） */
  cleanBonus?: number
}

export const MISSIONS: MissionDef[] = [
  {
    // 奪う → 車をつかまえる → 時間内に車で届ける（最初の1本。歩き・奪う・乗る・走るをひと通りやる）
    id: 'first-fit',
    title: 'はじめての一着',
    giver: '仕立て屋のツムギ',
    brief: '「うちの新作を着て歩いてくれる人を探しててね。まずは一着、街で見つくろっておいで」',
    hook: '仕立て屋のツムギが、ハチ公前で着てくれる人を探している',
    start: { x: 30, z: 24 },
    steps: [
      { kind: 'steal', count: 1, text: '通行人の服を1着いただく', accent: '服を1着' },
      {
        kind: 'vehicle',
        text: '車を1台つかまえる',
        accent: '車',
        say: '「似合うじゃない。…あら、通報されたみたい。車をつかまえて、ここを離れて」',
      },
      {
        kind: 'goto',
        x: 128,
        z: -1.5,
        radius: 10,
        vehicle: true,
        timeLimit: 90,
        text: 'ガードをくぐって宮益坂下まで走る',
        accent: '宮益坂下',
        say: '「そのまま宮益坂下まで乗っていって。その服、クリーニング屋のサワに見せたいの」',
      },
    ],
    reward: 3000,
    timeBonus: 20,
  },
  {
    // 奪ってそろえ、しわを付けずに運ぶ
    id: 'miyamasu-laundry',
    title: '宮益坂クリーニング',
    giver: 'クリーニング屋のサワ',
    brief: '「預かり物が2着足りないの。似たのを見つけて、宮益坂の上の工場まで運んで」',
    hook: 'クリーニング屋のサワが、宮益坂下で人手を探している',
    after: 'first-fit',
    start: { x: 148, z: 6.5 },
    steps: [
      { kind: 'steal', count: 2, text: '服を2着そろえる', accent: '服を2着' },
      { kind: 'vehicle', text: '車に乗る', accent: '車', say: '「そろったわね。車で運んで。ぶつけるたびに、しわが増えるから」' },
      {
        kind: 'goto',
        x: 455,
        z: -71,
        radius: 12,
        vehicle: true,
        fragile: 4,
        text: '宮益坂の上の工場へ届ける。車をぶつけるな',
        accent: '宮益坂の上の工場',
        say: '「工場は宮益坂を上りきった所。そっとよ、そっと」',
      },
    ],
    reward: 12000,
    cleanBonus: 3000,
  },
  {
    // 車をつかまえ、時間内に運ぶ。途中で届け先が変わり、最後は降りて手渡す
    id: 'slope-delivery',
    title: '坂の上まで、冷めないうちに',
    giver: '古着バイヤーのレン',
    brief: '「道玄坂の上の店に、開店前に見本を届けたい。足は現地調達で頼む」',
    hook: '古着バイヤーのレンが、道玄坂下で運び手を探している',
    after: 'first-fit',
    start: { x: -96, z: 2 },
    steps: [
      { kind: 'vehicle', text: '車を1台調達する', accent: '車' },
      {
        kind: 'goto',
        x: -386,
        z: 200,
        radius: 12,
        vehicle: true,
        timeLimit: 100,
        text: '道玄坂を上りきる。開店に遅れるな',
        accent: '道玄坂',
        say: '「開店まで時間がない。道玄坂をまっすぐ上がってくれ」',
      },
      {
        kind: 'goto',
        x: -151,
        z: 180,
        radius: 10,
        vehicle: true,
        addTime: 45,
        text: 'セルリアンタワー通りの店へ回る',
        accent: 'セルリアンタワー通りの店',
        say: '「悪い、店を間違えた。セルリアンタワー通りのほうだ。まだ間に合う」',
      },
      {
        kind: 'goto',
        x: -151,
        z: 180,
        radius: 12,
        onFoot: true,
        addTime: 10,
        text: '車を降りて、店主に見本を手渡す',
        accent: '店主',
        say: '「着いたな。車を降りて、店先の店主に直接渡してくれ」',
      },
    ],
    reward: 8000,
    timeBonus: 50,
  },
  {
    // 時間内に奪い、手配から逃げ、受け渡す
    id: 'center-gai-sweep',
    title: 'センター街、総取り',
    giver: 'スタイリストのミナト',
    brief: '「明日の撮影の衣装が届かないんだ。センター街で3着、いますぐ借りてきて。返す予定はない」',
    hook: 'スタイリストのミナトが、センター街の奥で困っている',
    after: 'slope-delivery',
    start: { x: -146, z: -88 },
    steps: [
      { kind: 'steal', count: 3, timeLimit: 75, text: '服を3着いただく', accent: '服を3着' },
      { kind: 'escape', text: '手配が消えるまで逃げきる', accent: '手配', say: '「通報されたぞ。撒くまで、こっちには来るな」' },
      {
        kind: 'goto',
        x: 88,
        z: -55,
        radius: 5,
        noHeat: true,
        text: 'のんべい横丁で衣装を渡す。警察を連れてくるな',
        accent: 'のんべい横丁',
        say: '「撒いたか。のんべい横丁の奥で受け取る。手配を付け直したら、この話は無しだ」',
      },
    ],
    reward: 15000,
  },
  {
    // 尾行して、倉庫を突き止める
    id: 'tail-the-reseller',
    title: '転売屋は坂を上る',
    giver: '古着屋の店番カナメ',
    brief: '「限定の作業着を買い占めてる転売屋がいる。倉庫を突き止めたいんだ。気づかれないように尾けて」',
    hook: '古着屋の店番カナメが、公園通りの下で相談があるらしい',
    after: 'miyamasu-laundry',
    start: { x: -7, z: -181 },
    steps: [
      {
        kind: 'tail',
        path: [-36, -207, -83, -252, -96, -265, -106, -277, -108, -281, -133, -263, -138, -255, -157, -249, -157, -245, -156, -241],
        speed: 2.6,
        delay: 3,
        near: 9,
        far: 55,
        text: '転売屋を尾ける。近づきすぎるな、見失うな',
        accent: '転売屋',
      },
      {
        kind: 'goto',
        x: -155,
        z: -229,
        radius: 5,
        // 倉庫の手前を、倉庫番が行ったり来たりしている
        guards: [{ path: [-166, -238, -154, -238], speed: 1.2, radius: 4 }],
        text: 'スペイン坂の倉庫の前に立つ。倉庫番の赤い輪に入るな',
        accent: 'スペイン坂の倉庫',
        say: '「そこが倉庫か。入口の前まで行って、場所を押さえて。倉庫番には見つからないで」',
      },
      {
        kind: 'steal',
        count: 1,
        text: '限定の作業着を1着取り返す',
        accent: '作業着を1着',
        say: '「押さえた。ついでに一着、取り返しておいて。近くを歩いてる客のでいい」',
      },
      { kind: 'escape', text: '手配が消えるまで逃げきる', accent: '手配', say: '「通報された！撒いたら終わりだ、走って」' },
    ],
    reward: 10000,
  },
  {
    // 時間内に地点を回る（1か所ごとに時間が足される）
    id: 'morning-assembly',
    title: '朝礼まで、あと少し',
    giver: '新入社員のハル',
    brief: '「初出勤なのに、出勤服を街じゅうに置いてきちゃって…。朝礼までに拾ってきてください！」',
    hook: '新入社員のハルが、渋谷駅の南で泣きそうになっている',
    after: 'center-gai-sweep',
    start: { x: 215, z: 200 },
    steps: [
      { kind: 'goto', x: 307, z: 293, radius: 7, timeLimit: 45, text: '金王橋でネクタイを拾う', accent: 'ネクタイ' },
      {
        kind: 'goto',
        x: 159,
        z: 341,
        radius: 8,
        addTime: 35,
        text: 'SAKURAストリートで革靴を拾う',
        accent: '革靴',
        say: '「次は革靴です。SAKURAストリートの植え込みの所に」',
      },
      {
        kind: 'goto',
        x: 23,
        z: 331,
        radius: 7,
        addTime: 30,
        text: '渋谷さくら坂でジャケットを拾う',
        accent: 'ジャケット',
        say: '「ジャケットは渋谷さくら坂のベンチです。たぶん」',
      },
      {
        kind: 'vehicle',
        addTime: 15,
        text: '車をつかまえる。走っても間に合わない',
        accent: '車',
        say: '「全部そろった！でも走ったら間に合いません。車を、車をつかまえてください！」',
      },
      {
        kind: 'goto',
        x: 39,
        z: 238,
        radius: 9,
        vehicle: true,
        addTime: 20,
        text: '玉川通りの会社の前へ乗りつける',
        accent: '玉川通りの会社',
        say: '「会社は玉川通り沿いです。正面に乗りつけちゃってください！」',
      },
    ],
    reward: 9000,
    timeBonus: 80,
  },
]

/** 新宿（東口・歌舞伎町・新宿三丁目）の依頼。渋谷の依頼とは別の筋で、最初の 1 本は着いたときから開いている */
export const SHINJUKU_MISSIONS: MissionDef[] = [
  {
    // 奪う → 時間内に歩いて届ける → 車をつかまえる → 車で届ける（新宿の最初の 1 本。東口から歌舞伎町の奥まで、街をひと通り見せる）
    id: 'shinjuku-first-neon',
    title: 'ネオンの下の初仕事',
    giver: '看板描きのアカリ',
    brief: '「今夜ともす看板の前に立つ、見本の一着がほしいの。東口で見つくろって、セントラルロードまで持ってきて」',
    hook: '看板描きのアカリが、東口の広場で人を探している',
    start: { x: -18, z: 8 },
    steps: [
      { kind: 'steal', count: 1, text: '東口で通行人の服を1着いただく', accent: '服を1着' },
      {
        kind: 'goto',
        x: -21.7,
        z: -164.7,
        radius: 8,
        timeLimit: 150,
        text: '靖国通りを渡って、セントラルロードの入口へ歩く',
        accent: 'セントラルロードの入口',
        say: '「いい色。靖国通りを渡った先、セントラルロードの入口で待ってる。看板に灯が入る前にね」',
      },
      {
        kind: 'vehicle',
        addTime: 30,
        text: '車を1台つかまえる',
        accent: '車',
        say: '「ぴったり。次は花道通りの店まで見せに行くから、車をつかまえてきて」',
      },
      {
        kind: 'goto',
        x: 148.1,
        z: -323.4,
        radius: 10,
        vehicle: true,
        addTime: 60,
        text: '花道通りの店先まで乗りつける',
        accent: '花道通りの店先',
        say: '「歌舞伎町をぐるっと回って、花道通りまで。店の前に着けてくれればいいわ」',
      },
    ],
    reward: 4000,
    timeBonus: 20,
  },
  {
    // 車をつかまえ、時間内に 2 か所を回り、最後は降りて手渡す
    id: 'yasukuni-green-wave',
    title: '靖国通り、ぜんぶ青で',
    giver: '花屋のミドリ',
    brief: '「開店祝いの花が二つ、まだ店にあるの。しおれる前に届けたい。足は現地調達でお願い」',
    hook: '花屋のミドリが、区役所通りの入口で運び手を探している',
    after: 'shinjuku-first-neon',
    start: { x: 160, z: -72 },
    steps: [
      { kind: 'vehicle', text: '車を1台調達する', accent: '車' },
      {
        kind: 'goto',
        x: 449,
        z: -1,
        radius: 12,
        vehicle: true,
        timeLimit: 85,
        text: '靖国通りを東へ走りきる。花がしおれる前に',
        accent: '靖国通り',
        say: '「一つめは靖国通りをまっすぐ東。信号は、ぜんぶ青だと思って」',
      },
      {
        kind: 'goto',
        x: 262,
        z: 140,
        radius: 10,
        vehicle: true,
        addTime: 45,
        text: '明治通りを下って、新宿通りの角の店へ回る',
        accent: '新宿通りの角の店',
        say: '「二つめは新宿通りの角。明治通りを下ればすぐよ」',
      },
      {
        kind: 'goto',
        x: 268,
        z: 134,
        radius: 12,
        onFoot: true,
        addTime: 10,
        text: '車を降りて、店主に花を手渡す',
        accent: '店主',
        say: '「着いたのね。車を降りて、店主に直接渡して」',
      },
    ],
    reward: 9000,
    timeBonus: 50,
  },
  {
    // 尾行して、見回りをかわして場所を押さえ、取り返して逃げる
    id: 'shiki-no-michi-tail',
    title: '四季の路の忘れ物',
    giver: 'バーテンのシズカ',
    brief: '「常連の上着を持っていった客がいるの。四季の路を抜けて帰るはず。気づかれないように尾けて」',
    hook: 'バーテンのシズカが、四季の路の入口で相談があるらしい',
    after: 'shinjuku-first-neon',
    start: { x: 170, z: -102 },
    steps: [
      {
        kind: 'tail',
        path: [176, -107.9, 177.1, -110.8, 187.2, -118.3, 201.1, -130.6, 211.7, -147, 218.4, -163.9, 221.6, -171.6, 226, -179.8, 230, -199.4, 238.9, -223.9, 246.7, -245.6, 258.8, -261.8, 273.7, -272.9, 285.1, -279.4],
        speed: 2.6,
        delay: 3,
        near: 9,
        far: 55,
        text: '上着を持った客を尾ける。近づきすぎるな、見失うな',
        accent: '上着を持った客',
      },
      {
        kind: 'goto',
        x: 291,
        z: -281,
        radius: 5,
        // 路地の出口を、連れの男が行ったり来たりしている
        guards: [{ path: [300, -292, 300, -296], speed: 1.2, radius: 4 }],
        text: '四季の路の出口に立つ。連れの男の赤い輪に入るな',
        accent: '四季の路の出口',
        say: '「そこで待ち合わせね。出口まで行って、場所を押さえて。連れには見つからないで」',
      },
      {
        kind: 'steal',
        count: 1,
        text: '上着を1着取り返す',
        accent: '上着を1着',
        say: '「押さえた。上着を取り返して。近くを歩いてる人ので、たぶん合ってる」',
      },
      { kind: 'escape', text: '手配が消えるまで逃げきる', accent: '手配', say: '「通報された！撒いたら終わり。走って」' },
    ],
    reward: 11000,
  },
  {
    // 時間内に奪ってそろえ、車をつかまえ、しわを付けずに運ぶ
    id: 'sanchome-fitting',
    title: '三丁目の衣装合わせ',
    giver: '舞台衣装のトワ',
    brief: '「今夜の舞台の衣装が3着足りない。末広通りで借りてきて、花道通りの小屋まで運んで。しわは厳禁」',
    hook: '舞台衣装のトワが、末広通りで頭を抱えている',
    after: 'yasukuni-green-wave',
    start: { x: 335.7, z: 136 },
    steps: [
      { kind: 'steal', count: 3, timeLimit: 90, text: '服を3着いただく', accent: '服を3着' },
      { kind: 'vehicle', text: '車に乗る', accent: '車', say: '「そろったね。車で運んで。ぶつけるたびに、しわが増える」' },
      {
        kind: 'goto',
        x: 291,
        z: -300.6,
        radius: 12,
        vehicle: true,
        fragile: 4,
        text: '花道通りの小屋へ届ける。車をぶつけるな',
        accent: '花道通りの小屋',
        say: '「小屋は花道通りの東の端。開演前だから、そっとね」',
      },
    ],
    reward: 14000,
    cleanBonus: 3000,
  },
]

const BY_AREA: Record<AreaId, MissionDef[]> = { shibuya: MISSIONS, shinjuku: SHINJUKU_MISSIONS }

/** そのエリアで受けられる依頼の表（エリアの分からないときは渋谷） */
export const missionsOf = (area: AreaId | undefined): MissionDef[] => BY_AREA[area ?? 'shibuya'] ?? MISSIONS

/** 全エリアの依頼（id から引く・達成の記録を読むとき） */
export const ALL_MISSIONS: MissionDef[] = [...MISSIONS, ...SHINJUKU_MISSIONS]

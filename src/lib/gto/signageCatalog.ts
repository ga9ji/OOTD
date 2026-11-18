// Grand Theft Outfit [部品: signs] 架空の店・広告・ネオンの色の一覧。
// 入口: SHOPS / UPPER_SHOPS / ADS / NEON_COLORS / NEON_WORDS
// 契約: 名前はすべて言葉遊びで作った架空のもの（実在の店名・ロゴ・広告は入れない）。
//       色は渋谷の夜の写真の比率に寄せる（赤・白・黄が多く、緑・青が少し、濃い地にネオン色の文字が少し）。

export interface Shop {
  name: string
  sub: string
  bg: string
  fg: string
}

/** 1階に店を構える架空の店 */
export const SHOPS: Shop[] = [
  { name: 'うたまる', sub: 'カラオケ', bg: '#e8412f', fg: '#fff7d6' },
  { name: 'とり松', sub: '炭火やきとり', bg: '#2a1c14', fg: '#f2c14e' },
  { name: 'ミナト堂薬局', sub: 'くすり・化粧品', bg: '#f7d51d', fg: '#c81e1e' },
  { name: '七福軒', sub: 'らーめん', bg: '#c1121f', fg: '#ffffff' },
  { name: 'もくもく亭', sub: '焼肉', bg: '#1b1b1b', fg: '#ff7a3c' },
  { name: 'CAFE NAMIKI', sub: 'coffee & toast', bg: '#234f3c', fg: '#f3ead7' },
  { name: 'LOOP&LOOP', sub: '古着', bg: '#f0e6d2', fg: '#273a8c' },
  { name: 'ヒカリ堂', sub: 'メガネ', bg: '#ffffff', fg: '#0e6ba8' },
  { name: 'まるはち', sub: 'たこ焼', bg: '#ffd23f', fg: '#b3001b' },
  { name: '夜更かし', sub: 'BAR', bg: '#151226', fg: '#c9a7ff' },
  { name: '金の匙', sub: 'カレー', bg: '#7a3b12', fg: '#ffd97a' },
  { name: 'ピコピコ館', sub: 'ゲームセンター', bg: '#101f8a', fg: '#fff34f' },
  { name: 'ひとやすみ', sub: 'ネットカフェ 24H', bg: '#0b7a75', fg: '#ffffff' },
  { name: 'かなめ屋', sub: '質・買取', bg: '#0f3d2e', fg: '#f4d35e' },
  { name: 'すし波', sub: '回転寿司', bg: '#ffffff', fg: '#1d3f8f' },
  { name: '坂の上', sub: 'そば処', bg: '#3b2a20', fg: '#f1e3c6' },
  { name: 'KIRINUKI', sub: 'hair salon', bg: '#f4f1ea', fg: '#222222' },
  { name: 'ASHIMOTO', sub: 'shoes', bg: '#111111', fg: '#ffffff' },
  { name: 'TAILOR TSUMUGI', sub: '仕立て・お直し', bg: '#1f2a44', fg: '#e8c98a' },
  { name: '針と溝', sub: 'レコード', bg: '#ff5a36', fg: '#111111' },
  { name: '谷の湯', sub: '銭湯', bg: '#2d6cb5', fg: '#ffffff' },
  { name: 'HELLO坂', sub: '英会話', bg: '#ffffff', fg: '#e23d6d' },
  { name: 'のびる会', sub: '学習塾', bg: '#0d47a1', fg: '#ffeb3b' },
  { name: 'すみか不動産', sub: '賃貸・売買', bg: '#ff8f1f', fg: '#ffffff' },
  { name: '藍いろ屋', sub: 'DENIM', bg: '#1b2f5b', fg: '#dfe9ff' },
  { name: '天辺', sub: 'HAT & CAP', bg: '#e9e2d0', fg: '#8a2b1c' },
  { name: 'しろい歯科', sub: '4F', bg: '#ffffff', fg: '#23a094' },
  { name: 'まきまき', sub: 'クレープ', bg: '#ffb7c5', fg: '#7a1f3d' },
  { name: 'もちもち茶房', sub: 'タピオカ', bg: '#5b3a29', fg: '#ffe7c2' },
  { name: 'どんぶり一番', sub: '牛めし', bg: '#ef6c00', fg: '#ffffff' },
  { name: 'ねむり坂', sub: 'HOTEL', bg: '#2b1740', fg: '#ff9ee5' },
  { name: 'ひかり写真館', sub: '証明写真', bg: '#ffffff', fg: '#333333' },
  { name: 'ぎんなん書房', sub: '本・雑誌', bg: '#e9d985', fg: '#3a3a1e' },
  { name: 'DOGEN CURRY', sub: 'spice stand', bg: '#f2b632', fg: '#40210f' },
  { name: '大衆酒場 ハチの巣', sub: '', bg: '#fff3d1', fg: '#b3261e' },
  { name: 'シュワリ', sub: 'のびる炭酸', bg: '#00a6c8', fg: '#ffffff' },
  { name: 'MIYAMASU GYM', sub: '24h fitness', bg: '#0a0a0a', fg: '#c6ff3d' },
  { name: 'てくてく靴店', sub: '修理もします', bg: '#8c5a2b', fg: '#fff5e1' },
  { name: '雀荘 東南', sub: '3F', bg: '#0e5c2f', fg: '#ffffff' },
  { name: 'ゆびさき', sub: 'ネイル', bg: '#fbe4ef', fg: '#c2185b' },
  { name: 'めんくい亭', sub: 'つけ麺', bg: '#d81e1e', fg: '#ffe95c' },
  { name: '串かつ はしご', sub: '二度づけ禁止', bg: '#ffe14a', fg: '#1a1a1a' },
  { name: '餃子の丸窓', sub: '焼・水・揚', bg: '#ffffff', fg: '#d1241c' },
  { name: '火ばしら', sub: 'ホルモン焼', bg: '#b3140f', fg: '#ffd54a' },
  { name: '立ち呑み かど', sub: 'せんべろ', bg: '#fff6dc', fg: '#14315c' },
  { name: 'よいどれ横丁', sub: '居酒屋', bg: '#e02a2a', fg: '#ffffff' },
  { name: 'もんじゃ へらや', sub: '5・6F', bg: '#c41616', fg: '#ffffff' },
  { name: 'カラオケこだま', sub: '朝5時まで', bg: '#ffffff', fg: '#e0261f' },
  { name: 'ダーツ 的', sub: 'DARTS & BAR', bg: '#12091f', fg: '#49f2c2' },
  { name: 'CLUB ASAYAKE', sub: 'B1F', bg: '#0d0714', fg: '#ff4fa8' },
  { name: 'LIVE 谷底', sub: 'LIVE HOUSE', bg: '#0b0b12', fg: '#ffe45c' },
  { name: 'ドラッグ ミント', sub: '薬・日用品', bg: '#ffec3d', fg: '#0c7a4a' },
  { name: 'でんき屋ピカリ', sub: '家電・スマホ', bg: '#e0221c', fg: '#fff23d' },
  { name: 'ケータイ工房', sub: '修理 即日', bg: '#1668d6', fg: '#ffffff' },
  { name: 'リユース まわる', sub: '高価買取', bg: '#ffd400', fg: '#141414' },
  { name: '百円横丁', sub: '100YEN', bg: '#ff5fa2', fg: '#ffffff' },
  { name: 'スニーカー蔵', sub: 'SNEAKERS', bg: '#ffffff', fg: '#111111' },
  { name: 'ふるぎ 二巡目', sub: 'USED', bg: '#2c5a3a', fg: '#f5e9c9' },
  { name: 'ぱんのいえ', sub: 'ベーカリー', bg: '#f6e7c8', fg: '#7a4a1c' },
  { name: 'ドーナツ輪っか', sub: 'donut', bg: '#ff8fb3', fg: '#ffffff' },
  { name: '喫茶 ゆうぐれ', sub: '珈琲・ナポリタン', bg: '#5a2e1a', fg: '#ffd9a0' },
  { name: '茶ばしら', sub: 'TEA STAND', bg: '#3d7a3a', fg: '#ffffff' },
  { name: 'ピザ窯 MARU', sub: 'pizza', bg: '#1f6b3a', fg: '#ffffff' },
  { name: 'バーガー谷', sub: 'BURGER', bg: '#ffb81c', fg: '#a3180f' },
  { name: 'うどん こしだま', sub: '手打ち', bg: '#1d3a7a', fg: '#ffffff' },
  { name: '海鮮 なみ平', sub: '刺身・浜焼', bg: '#0f4f8a', fg: '#ffffff' },
  { name: 'チケット八番', sub: '金券・切符', bg: '#ffef5a', fg: '#d11a1a' },
  { name: 'ROUGE坂', sub: 'コスメ', bg: '#ff3d7f', fg: '#ffffff' },
]

/** 上の階に入る架空の店（袖看板と壁面の小さい看板に使う。1階の店も混ぜる） */
export const UPPER_SHOPS: Shop[] = [
  { name: 'ほぐし処 ゆるり', sub: '60分', bg: '#ffffff', fg: '#1a8f5a' },
  { name: '美容室 MAEGAMI', sub: 'cut & color', bg: '#111111', fg: '#ffffff' },
  { name: 'エステ つるり', sub: '脱毛', bg: '#ffe1ec', fg: '#d4266b' },
  { name: '占い 星めぐり', sub: '手相・タロット', bg: '#3a1a6b', fg: '#ffe066' },
  { name: '貸会議室 ヒトマ', sub: '7F', bg: '#ffffff', fg: '#1f4fa8' },
  { name: '英語塾 SLOPE', sub: '体験無料', bg: '#1557c0', fg: '#ffffff' },
  { name: 'ひだまり歯科', sub: '夜8時まで', bg: '#ffffff', fg: '#2a9d8f' },
  { name: '坂みち皮フ科', sub: '3F', bg: '#ffffff', fg: '#d6336c' },
  { name: 'カプセルイン 繭', sub: 'CAPSULE', bg: '#101a3a', fg: '#7fd4ff' },
  { name: 'HOTEL 谷間', sub: '休憩・宿泊', bg: '#1a0f2e', fg: '#ff7ad9' },
  { name: 'まんが図書室', sub: '24時間', bg: '#ff7a1a', fg: '#ffffff' },
  { name: 'サウナ ととのい', sub: 'SAUNA', bg: '#0f2a4a', fg: '#ffd35c' },
  { name: 'ボウル坂', sub: 'BOWLING', bg: '#d4141e', fg: '#ffffff' },
  { name: 'シネマ坂上', sub: '映画', bg: '#141414', fg: '#ff4a3d' },
  { name: 'ビリヤード 9', sub: 'POOL & BAR', bg: '#0c4a2a', fg: '#ffe98a' },
  { name: 'すぐ借りる', sub: 'レンタル', bg: '#ffe600', fg: '#0d3a9e' },
  { name: '写真スタジオ 灯', sub: 'PHOTO', bg: '#f2f2f2', fg: '#222222' },
  { name: 'ヨガ のび', sub: 'YOGA', bg: '#e6f5e9', fg: '#2a7a4a' },
  { name: '個室居酒屋 つどい', sub: '飲み放題', bg: '#7a1414', fg: '#ffd98a' },
  { name: '焼鳥 とまり木', sub: '2F', bg: '#fff2cc', fg: '#8a1c12' },
  { name: 'しゃぶしゃぶ 湯の花', sub: '食べ放題', bg: '#ffffff', fg: '#b3121c' },
  { name: 'BAR 午前二時', sub: '4F', bg: '#0a0a1a', fg: '#5cf2ff' },
  { name: 'スナック みちくさ', sub: '', bg: '#3a0f2a', fg: '#ffb3e0' },
  { name: '将棋サロン 歩', sub: '5F', bg: '#f5ead2', fg: '#3a2a14' },
]

/** 屋上や壁面の大きな広告（架空の商品・催し） */
export const ADS: Shop[] = [
  { name: 'TSUMUGI', sub: '春の新作、入荷。', bg: '#f4efe6', fg: '#1f2a44' },
  { name: 'シュワリ', sub: 'のびる炭酸、新発売', bg: '#00a6c8', fg: '#ffffff' },
  { name: '出勤服展', sub: '毎日の一着、ぜんぶ見せます', bg: '#111111', fg: '#ff6a2b' },
  { name: 'LOOP&LOOP', sub: '古着まつり 開催中', bg: '#273a8c', fg: '#f0e6d2' },
  { name: '谷底FM 77.7', sub: '坂のまちの放送局', bg: '#ffd23f', fg: '#1b1b1b' },
  { name: 'ASHIMOTO', sub: '歩くための靴。', bg: '#e23d2f', fg: '#ffffff' },
  { name: 'ねむり坂', sub: 'よく眠れる街のホテル', bg: '#2b1740', fg: '#ff9ee5' },
  { name: 'KIRINUKI', sub: '切り抜くように、整える', bg: '#eaeaea', fg: '#111111' },
  { name: 'うたまる', sub: '歌って帰ろう。全室リニューアル', bg: '#e8412f', fg: '#fff7d6' },
  { name: 'ピカリ', sub: '決算大感謝祭', bg: '#fff23d', fg: '#e0221c' },
  { name: 'ミント', sub: 'まいにち、すっきり。', bg: '#0c9a5c', fg: '#ffffff' },
  { name: 'ASAYAKE', sub: 'ALL NIGHT 22:00 OPEN', bg: '#0d0714', fg: '#ff4fa8' },
]

/** ネオン管の色。桃と薄緑を主に、差し色を少し */
export const NEON_COLORS = ['#ff3d9a', '#3dffc0', '#ff3d9a', '#3dffc0', '#ffb02e', '#38c8ff'] as const

/** ネオン管を曲げて書いた文字看板（架空の店の屋号を筆記体で。色は fg、2色目の飾りの管は sub の色 = bg） */
export interface NeonWord {
  /** 筆記体で書く屋号（英字） */
  name: string
  /** 下に小さく添える言葉 */
  sub: string
  /** 文字の管の色 */
  fg: string
  /** 飾り（下線・囲み）の管の色 */
  bg: string
}

/** 色は桃と薄緑が主（1枚に2色まで）。屋号は一覧の架空の店から取った言葉遊び */
export const NEON_WORDS: NeonWord[] = [
  { name: 'Asayake', sub: 'CLUB', fg: '#ff3d9a', bg: '#3dffc0' },
  { name: 'Nemurizaka', sub: 'HOTEL', fg: '#ff5fb0', bg: '#ff5fb0' },
  { name: 'Yofukashi', sub: 'BAR', fg: '#3dffc0', bg: '#ff3d9a' },
  { name: 'Tanizoko', sub: 'LIVE', fg: '#ff3d9a', bg: '#ffb02e' },
  { name: 'Yuugure', sub: 'COFFEE', fg: '#ffb02e', bg: '#ff3d9a' },
  { name: 'Hachinosu', sub: 'SAKABA', fg: '#3dffc0', bg: '#3dffc0' },
  { name: 'Utamaru', sub: 'KARAOKE', fg: '#ff3d9a', bg: '#38c8ff' },
  { name: 'Michikusa', sub: 'SNACK', fg: '#ff7ad9', bg: '#3dffc0' },
  { name: 'Hoshimeguri', sub: 'TAROT', fg: '#38c8ff', bg: '#ff3d9a' },
  { name: 'Gozen Niji', sub: 'BAR', fg: '#3dffc0', bg: '#ff3d9a' },
  { name: 'Totonoi', sub: 'SAUNA', fg: '#ff3d9a', bg: '#3dffc0' },
  { name: 'Tomarigi', sub: 'YAKITORI', fg: '#ffb02e', bg: '#3dffc0' },
]

// Pixel coordinates refer to the original transparent 240px-tall outfit photographs.
type Crop = readonly [left: number, top: number, width: number, height: number]
type Hand = readonly [x: number, y: number]
export type HuntLook = {
  key: string
  no: number
  label: string
  crop: Crop
  hand: Hand
}

export const PLAYER_LOOKS: readonly HuntLook[] = [
  { key: 'n18ee10bb4342', no: 115, label: 'テーラードジャケット', crop: [0, 0, 92, 232], hand: [12, 126] },
  { key: 'n327075b693ba', no: 339, label: 'イエローシャツ', crop: [0, 0, 77, 240], hand: [9, 132] },
  { key: 'n6648915dea03', no: 500, label: 'デニムジャケット', crop: [0, 0, 80, 240], hand: [72, 118] },
  { key: 'n47179311cfc0', no: 162, label: 'ボーダーTシャツ', crop: [0, 0, 95, 240], hand: [90, 124] },
]

export const RIVAL_LOOKS: Record<'cinder' | 'gale', HuntLook> = {
  cinder: { key: 'na8df60f04b00', no: 279, label: 'アーカイブ収集家 koki', crop: [8, 0, 89, 240], hand: [87, 127] },
  gale: { key: 'na36e5713937f', no: 72, label: '赤をまとう koki', crop: [74, 32, 84, 208], hand: [113, 113] },
}

export const photoUrl = (look: HuntLook) => `${import.meta.env.BASE_URL}cutouts/${look.key}.webp`

export async function loadHuntPhoto(look: HuntLook) {
  const image = new Image()
  image.src = photoUrl(look)
  await image.decode()
  return image
}

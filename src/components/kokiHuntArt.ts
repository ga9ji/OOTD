import { ATTACKS, CHARGE_SPEED, CHARGE_TIME, CHARGE_WIDTH, FIELD, SWEEP_RADIUS, type Battle, type Hunt, type Point } from '../lib/kokiHunt'

export const KOKI_SPRITE = 'n18ee10bb4342'
const TAU = Math.PI * 2

function polygon(ctx: CanvasRenderingContext2D, points: number[], fill: string, stroke?: string) {
  ctx.beginPath()
  ctx.moveTo(points[0], points[1])
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
  ctx.fillStyle = color
  ctx.fill()
}

export function makeTerrain(hunt: Hunt) {
  const terrain = document.createElement('canvas')
  terrain.width = FIELD.width
  terrain.height = FIELD.height
  const ctx = terrain.getContext('2d')
  if (!ctx) return terrain
  const gale = hunt.id === 'gale'
  const fill = ctx.createLinearGradient(0, 0, 580, 490)
  fill.addColorStop(0, gale ? '#385b58' : '#705440')
  fill.addColorStop(.55, gale ? '#294342' : '#4d4037')
  fill.addColorStop(1, gale ? '#151f26' : '#292b27')
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, FIELD.width, FIELD.height)
  for (let i = 0; i < 17; i += 1) {
    ctx.beginPath()
    const y = 20 + i * 32
    ctx.moveTo(-30, y - 120)
    ctx.bezierCurveTo(120, y + 80, 380, y - 170, 640, y + 17)
    ctx.quadraticCurveTo(730, y + 89, 790, y + 47)
    ctx.strokeStyle = i % 4 === 0 ? '#f1da9a2a' : '#f1da9a14'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  for (let i = 0; i < 77; i += 1) {
    const x = ((i * 1879) % 751) + 4
    const y = ((i * 1321) % 435) + 4
    const size = i % 7 + 2
    polygon(ctx, [x - size, y, x - size / 2, y - size / 2, x + size / 2, y - size, x + size, y, x + 1, y + 2], i % 3 === 0 ? '#fbdd9d38' : '#171b1b4c')
  }
  polygon(ctx, [0, 0, 165, 0, 121, 34, 74, 43, 43, 77, 0, 89], '#171f20aa')
  polygon(ctx, [760, 444, 564, 444, 628, 417, 677, 415, 717, 381, 760, 363], '#131d1eb9')
  ctx.strokeStyle = '#e2cfac59'
  ctx.setLineDash([5, 8])
  ctx.strokeRect(15, 15, FIELD.width - 30, FIELD.height - 30)
  return terrain
}

function drawWarning(ctx: CanvasRenderingContext2D, battle: Battle) {
  if (battle.phase !== 'windup' && battle.phase !== 'strike') return
  ctx.save()
  ctx.translate(battle.monster.x, battle.monster.y)
  ctx.strokeStyle = '#ffd088'
  ctx.fillStyle = battle.phase === 'strike' ? '#ff69566d' : '#eb503c42'
  ctx.lineWidth = 2.5
  ctx.setLineDash([8, 6])
  ctx.beginPath()
  if (battle.hunt.id === 'cinder') {
    ctx.rotate(Math.atan2(battle.aim.y, battle.aim.x))
    const reach = CHARGE_SPEED * (battle.phase === 'strike' ? battle.phaseTimer : CHARGE_TIME)
    ctx.moveTo(0, -CHARGE_WIDTH / 2)
    ctx.lineTo(reach, -CHARGE_WIDTH / 2)
    ctx.arc(reach, 0, CHARGE_WIDTH / 2, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(0, CHARGE_WIDTH / 2)
    ctx.arc(0, 0, CHARGE_WIDTH / 2, Math.PI / 2, Math.PI * 1.5)
  } else {
    ctx.arc(0, 0, SWEEP_RADIUS, 0, TAU)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawCinder(ctx: CanvasRenderingContext2D) {
  polygon(ctx, [-39, 7, -71, -5, -83, 4, -65, 11, -39, 29], '#51342b', '#a96b47')
  polygon(ctx, [-49, 5, 31, 4, 20, 33, 7, 34, 4, 20, -23, 18, -29, 36, -43, 34], '#342a27', '#90684e')
  polygon(ctx, [-56, 2, -44, -25, -22, -44, 13, -40, 36, -19, 51, -11, 43, 10, 14, 19, -25, 15], '#67412d', '#d19964')
  polygon(ctx, [-54, -4, -43, -28, -20, -48, -6, -35, 9, -52, 24, -35, 36, -20, 26, -10, -7, -9, -36, 8], '#a06239', '#e6a45e')
  polygon(ctx, [-40, -12, -29, -30, -19, -37, -16, -20, -24, -11], '#d18448')
  polygon(ctx, [-6, -18, 7, -43, 16, -35, 25, -20, 18, -17], '#d18448')
  polygon(ctx, [22, -9, 39, -25, 55, -17, 67, -3, 60, 9, 39, 13, 26, 8], '#47312a', '#c38454')
  polygon(ctx, [41, -18, 53, -38, 75, -46, 65, -29, 56, -16], '#e8cb91', '#795e41')
  polygon(ctx, [54, -7, 67, -22, 82, -20, 65, -6], '#bd9d75')
  ellipse(ctx, 51, -11, 4, 2.5, '#ffcc6d')
}

function drawGale(ctx: CanvasRenderingContext2D, flap: number) {
  polygon(ctx, [-28, 6, -79, 16, -96, 35, -65, 26, -48, 26, -24, 21], '#436e73', '#83b0ab')
  polygon(ctx, [-33, -2, -63, -37 - flap, -86, -49 - flap, -105, -73 - flap, -63, -68 - flap, -34, -50, 7, -19], '#7eaaa5', '#b8dfc6')
  polygon(ctx, [-32, -4, -70, -30 - flap, -74, -45 - flap, -40, -35, 18, -12], '#47737b')
  polygon(ctx, [-31, 1, -71, 29 + flap, -87, 62 + flap, -64, 55 + flap, -41, 38, 26, 3], '#84aba9', '#c4e5ce')
  polygon(ctx, [-27, 10, -53, 34, -67, 52 + flap, -48, 47, -12, 19], '#4a7372')
  polygon(ctx, [-46, -4, -31, -27, 14, -33, 33, -15, 47, -15, 59, -5, 42, 6, 27, 7, 5, 22, -25, 14], '#4a7d82', '#a9d6c9')
  polygon(ctx, [-34, -14, -12, -31, 13, -32, 24, -46, 33, -39, 33, -17, 18, -6, -2, -17], '#b6dfc8', '#86a7a0')
  polygon(ctx, [32, -12, 53, -10, 68, -2, 52, 3, 38, 2], '#d7d09d')
  ellipse(ctx, 43, -9, 3.5, 2, '#fff2ab')
}

function drawMonster(ctx: CanvasRenderingContext2D, battle: Battle) {
  const { x, y } = battle.monster
  const gale = battle.hunt.id === 'gale'
  const motion = battle.phase === 'recover' ? 0 : Math.sin(battle.elapsed * 8)
  ellipse(ctx, x, y + 9, gale ? 74 : 59, 23, '#18191bc0')
  ctx.save()
  ctx.translate(x, y - 9 + motion * (gale ? 5 : 2))
  if (battle.aim.x < 0) ctx.scale(-1, 1)
  if (battle.impact > 0 && battle.impactedMonster) {
    ctx.shadowColor = '#ffe4a9'
    ctx.shadowBlur = 13
  }
  if (gale) drawGale(ctx, motion * 11)
  else drawCinder(ctx)
  ctx.restore()
}

function drawPlayer(ctx: CanvasRenderingContext2D, battle: Battle, image: HTMLImageElement) {
  const { x, y } = battle.player
  ellipse(ctx, x, y + 5, 20, 8, '#111311bb')
  if (battle.attack) {
    const angle = Math.atan2(battle.monster.y - y, battle.monster.x - x)
    ctx.beginPath()
    ctx.arc(x, y, ATTACKS[battle.attack].range, angle - .67, angle + .67)
    ctx.strokeStyle = battle.attack === 'heavy' ? '#ffce72' : '#ede8c6'
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(x, y)
  if (battle.dodgeTimer > 0) {
    ctx.globalAlpha = .68
    ctx.rotate(battle.dodgeDir.x * .47)
  }
  if (image.complete && image.naturalWidth > 0) {
    const height = 82
    const width = image.naturalWidth / image.naturalHeight * height
    ctx.shadowColor = battle.impact && !battle.impactedMonster ? '#ff7860' : '#fff1c4'
    ctx.shadowBlur = 7
    ctx.drawImage(image, -width / 2, -height + 8, width, height)
  } else {
    ellipse(ctx, 0, -13, 12, 22, '#e9e3bc')
  }
  ctx.restore()
  ctx.font = '700 13px system-ui'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#fff5d5'
  ctx.fillText('koki', x, y + 21)
}

function drawImpact(ctx: CanvasRenderingContext2D, point: Point, progress: number) {
  ctx.save()
  ctx.translate(point.x, point.y - 24)
  ctx.globalAlpha = progress
  for (let i = 0; i < 7; i += 1) {
    ctx.rotate(TAU / 7)
    polygon(ctx, [12, 0, 46, -3, 29, 4], '#fff1a2')
  }
  ctx.restore()
}

export function drawBattle(ctx: CanvasRenderingContext2D, terrain: HTMLCanvasElement, battle: Battle, image: HTMLImageElement) {
  ctx.drawImage(terrain, 0, 0)
  drawWarning(ctx, battle)
  drawMonster(ctx, battle)
  drawPlayer(ctx, battle, image)
  if (battle.impact > 0) drawImpact(ctx, battle.impactedMonster ? battle.monster : battle.player, battle.impact / .24)
}

export function drawHuntIcon(ctx: CanvasRenderingContext2D, hunt: Hunt) {
  ctx.translate(116, 77)
  if (hunt.id === 'gale') drawGale(ctx, 0)
  else drawCinder(ctx)
}

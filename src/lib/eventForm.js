// 活动结算表单的校验和计分。
// 这两件事只取决于表单里填的内容，不依赖界面状态，所以单独放在这里：可以直接拿数据来测试
// （tests/render.test.cjs），界面组件 EventScoring.jsx 只负责把输入框和这里连起来
import { parseNames, round4 } from './utils.js'

// 一张训练 / 彩排卡片是不是"用上了"：填了教官的才算。
// 参训可以留空——对外带训时就只有教官、没有参训队员
const hasCoaches = card => parseNames(card.coaches).length > 0

// 真正起了作用的卡片数：底部操作栏和历史记录里显示的是这个数，
// 彩排环节那张删不掉的空卡片不算一次彩排
export const countCards = cards => cards.filter(hasCoaches).length

// 一张训练 / 彩排卡片合不合格：教官必须填，参训可以留空（对外带训时就只有教官、没有参训队员）。
// 合格返回空串，否则返回给用户看的提示
function checkCard (card, label, mayBeBlank) {
  if (hasCoaches(card)) return ''
  if (parseNames(card.participants).length) return `${label}填了参训队员，却没有填教官。教官不能为空，参训可以留空`
  // 教官、参训都是空的：这张卡片等于没用上。删不掉的那一张（彩排环节至少留 1 张卡片）留空就表示"没有彩排"
  return mayBeBlank ? '' : `${label}的教官和参训都是空的，不需要的话请点 － 删掉这张卡片`
}

// 整张表单的校验：合格返回空串，否则返回第一条不合格的原因。
// excel 是读出来的主表数据，只用来看"有没有同名的列"（测试时可以不传）
export function validateEventForm ({ activityName, headCoaches, trainings, rehearsals, formal, excel }) {
  const name = String(activityName || '').trim()
  if (!name) return '请填写活动名称（它会成为主表里新加那一列的表头）'
  const heads = parseNames(headCoaches)
  if (heads.length < 1 || heads.length > 5) return '主教官需填写 1~5 位人名，不能为空'
  for (let i = 0; i < trainings.length; i++) {
    const err = checkCard(trainings[i], `第 ${i + 1} 次训练`, false)
    if (err) return err
  }
  for (let i = 0; i < rehearsals.length; i++) {
    // 彩排环节至少保留 1 张卡片：只有这一张时，留空就表示"没有彩排"
    const err = checkCard(rehearsals[i], `第 ${i + 1} 次彩排`, rehearsals.length === 1)
    if (err) return err
  }
  if (!parseNames(formal.participants).length) return '正式活动「参加」名单不能为空'
  if (excel?.activityColumns?.some(c => c.name === name)) return `主表中已存在同名活动列「${name}」，请更换活动名称`
  // 表格里任何一列都不能叫这个名字：和「姓名」「汇总」这些固定列重名的话，这一列在表里就分不清了。
  // 主进程写入时也会拦，这里提前说出来，不用等到预览之后才被挡回去
  if ((excel?.headers || []).some(h => String(h || '').trim() === name)) return `主表里已经有一列叫「${name}」，活动名称不能和它相同，请换一个`
  return ''
}

// 计算积分。主教官每人 +2.0；训练、彩排按时长（1 小时 = 1.0 分），教官和参训队员分值相同；
// 正式活动按参加时长计分，场务每人固定 +0.5。
// resolutions：名单里不在名册中的名字怎么处理——null 表示忽略，字符串表示改记到那位队员名下
export function computeEventScores ({ headCoaches, trainings, rehearsals, formal, rosterSet, dupSet }, resolutions = {}) {
  const resolve = (name) => {
    if (rosterSet.has(name)) return name
    const r = resolutions[name]
    return r ? r : null // 未处理或忽略 -> null
  }
  const parts = {} // name -> { head, training, rehearsal, formal, stage }
  const add = (rawName, key, val) => {
    const name = resolve(rawName)
    if (!name) return
    if (!parts[name]) parts[name] = { head: 0, training: 0, rehearsal: 0, formal: 0, stage: 0 }
    parts[name][key] = round4(parts[name][key] + val)
  }
  parseNames(headCoaches).forEach(n => add(n, 'head', 2.0))
  trainings.forEach(t => {
    parseNames(t.coaches).forEach(n => add(n, 'training', t.hours))
    parseNames(t.participants).forEach(n => add(n, 'training', t.hours))
  })
  rehearsals.forEach(r => {
    parseNames(r.coaches).forEach(n => add(n, 'rehearsal', r.hours))
    parseNames(r.participants).forEach(n => add(n, 'rehearsal', r.hours))
  })
  parseNames(formal.participants).forEach(n => add(n, 'formal', formal.hours))
  parseNames(formal.stageCrew).forEach(n => add(n, 'stage', 0.5))

  const rows = Object.entries(parts).map(([name, p]) => {
    const total = round4(p.head + p.training + p.rehearsal + p.formal + p.stage)
    return { name, ...p, total, duplicate: dupSet.has(name) }
  }).sort((a, b) => b.total - a.total)
  const scores = {}
  rows.forEach(r => { if (r.total) scores[r.name] = r.total })
  return { rows, scores }
}

// 历史流水的线性版本栈：同一 objectKey 下，仅最新未撤销记录为「活跃」，其下均为「锁定」
export function computeStatusMap (history) {
  const status = {}
  const groups = {}
  for (const rec of history) {
    if (rec.status === 'undone') { status[rec.batchId] = 'undone'; continue }
    if (!groups[rec.objectKey]) groups[rec.objectKey] = []
    groups[rec.objectKey].push(rec)
  }
  for (const key of Object.keys(groups)) {
    const list = groups[key]
    list.forEach((rec, i) => {
      status[rec.batchId] = i === list.length - 1 ? 'active' : 'locked'
    })
  }
  return status
}

// 某活动当前每人分值 = 该对象所有未撤销记录的差值累加
export function currentScoresOf (history, objectKey) {
  const scores = {}
  for (const rec of history) {
    if (rec.objectKey !== objectKey || rec.status === 'undone') continue
    for (const [name, delta] of Object.entries(rec.details || {})) {
      scores[name] = (scores[name] || 0) + delta
    }
  }
  return scores
}

export const TYPE_LABELS = {
  event_create: '新建大型活动',
  event_edit: '修改大型活动',
  daily: '日常训练',
  flag: '升降旗',
  department: '部门积分'
}

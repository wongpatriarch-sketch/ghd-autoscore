const fs = require('fs')

// 用临时文件替换正式文件（同名覆盖）。
//
// 为什么要重试：Windows 上"改名覆盖一个已经存在的文件"时，如果恰好有别的程序正开着这个文件
// （杀毒软件在扫描、搜索索引在建索引、资源管理器在读预览），系统会拒绝这一次改名，
// 报的是 EPERM / EACCES / EBUSY，通常几十毫秒后对方就放手了。本机实测：机器繁忙时几千次写入里会碰上一两次。
// 这种一闪而过的失败会让一次本来正常的保存报"文件被占用"，所以先等一下再重试几次。
// 表格真的被 Excel / WPS 开着时，每一次重试都会失败，最后一次的错误原样交给调用方去提示用户。
const RETRY_DELAYS = [30, 80, 160, 320] // 毫秒；一共最多多等不到 0.6 秒
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY'])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 成功返回 null；失败返回最后一次的错误（临时文件还在，留给调用方清理）。
// 调用方应当在调用前确认正式文件所在的位置是可写的，这里的重试只解决"一闪而过"的占用。
async function replaceFile (tmp, target) {
  let last = null
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt) await sleep(RETRY_DELAYS[attempt - 1])
    try {
      fs.renameSync(tmp, target)
      return null
    } catch (e) {
      last = e
      // 不是"可能一闪而过"的错误（例如文件夹不存在）：重试多少次都一样，直接放弃
      if (!TRANSIENT.has(e.code)) break
    }
  }
  return last
}

module.exports = { replaceFile, RETRY_DELAYS }

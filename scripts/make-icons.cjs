/*
 * 从队徽原图生成软件需要的图标：  node scripts/make-icons.cjs <队徽原图.png> [--preview 预览图.png]
 *
 * 生成三个文件：
 *   build/icon.ico       Windows 图标文件，里面有 10 种尺寸（16~256 像素）各一张。
 *                        打包时 electron-builder 把它原样写进 exe、安装包、卸载程序
 *                        （桌面快捷方式、开始菜单、任务栏显示的就是它）
 *   build/icon.png       1024×1024 的母版。icon.ico 里的各个尺寸都是从它缩出来的
 *   src/assets/logo.png   256×256。欢迎页左上角和侧边栏里显示的小徽标
 *
 * 为什么要处理：原图是白底的圆形队徽。软件界面是深色的，Windows 任务栏也可能是深色的，
 * 直接拿原图当图标的话，圆形外面会带着一圈白色的直角。所以要把圆形以外的部分做成透明，
 * 并且把圆形边缘上"黑边和白底混在一起"的灰色像素还原成黑色，否则图标外面会出现一圈浅色毛边。
 *
 * 为什么 icon.ico 里要放这么多种尺寸，并且要控制每个条目的体积：Windows 在不同地方用不同大小的图标
 * （任务栏 16~48 像素，桌面快捷方式 48~256 像素，跟显示缩放比例有关），显示时挑一张不小于目标尺寸的图再缩小。
 * 以前只给打包工具一张 1024×1024 的图，它转出来的图标文件里只有一张 256×256 的压缩图（90KB 多）。
 * 把图标写进 exe 的 rcedit 会把超过 64KB 的条目长度记错（见下面 MAX_ENTRY_BYTES 的说明），
 * 结果任务栏上只显示出最上面一截。所以现在每种常用尺寸都单独准备一张，并且每个条目都不超过 60KB。
 *
 * 做法：
 *   1. 在原图上从四面八方朝圆心看过去，找出黑色外圈在每个角度上的准确半径（原图的圆并不是数学上完美的圆）；
 *   2. 以圆心为中心裁出一个正方形（四周留一点边），缩放到目标尺寸；
 *   3. 按第 1 步量出的半径给每个像素算透明度：圆外全透明，圆内不透明，正好压在边上的按覆盖比例半透明；
 *   4. 从 1024 的母版缩出各种小尺寸，拼成 icon.ico（见 buildIconFile）。
 *
 * 缩放用的是 Electron 自带的 nativeImage（Chromium 的图像引擎），不需要再装别的图像库。
 * 所以本文件被 node 运行时会用 Electron 重新启动自己，由 runInElectron 真正干活。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const root = path.resolve(__dirname, '..')

if (process.versions.electron && process.type === 'browser') {
  runInElectron()
} else {
  runInNode()
}

// ---------- 用 node 运行时：解析参数，调用 Electron 执行后半段 ----------
function runInNode () {
  const args = process.argv.slice(2)
  const source = args.find(a => !a.startsWith('--') && !isOptionValue(args, a))
  const previewIdx = args.indexOf('--preview')
  const preview = previewIdx >= 0 ? args[previewIdx + 1] : null
  if (!source || !fs.existsSync(source)) {
    console.error('用法：node scripts/make-icons.cjs <队徽原图.png> [--preview 预览图.png]')
    process.exit(2)
  }
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (!fs.existsSync(electron)) {
    console.error('找不到 Electron（请先执行 npm install）：', electron)
    process.exit(2)
  }

  // 这个小工具本身也是个 Electron 程序，会往"用户数据目录"写一点缓存。
  // 把目录指到临时文件夹，免得碰到软件真正在用的那个目录。
  const tag = `ghd-icons-${process.pid}`
  const userData = path.join(os.tmpdir(), `${tag}-userdata`)
  const resultFile = path.join(os.tmpdir(), `${tag}.json`)
  fs.mkdirSync(userData, { recursive: true })

  const r = spawnSync(electron,
    [`--user-data-dir=${userData}`, __filename, path.resolve(source), root, preview ? path.resolve(preview) : '', resultFile],
    { encoding: 'utf8' })

  try { fs.rmSync(userData, { recursive: true, force: true }) } catch (_) {}
  let result = null
  try { result = JSON.parse(fs.readFileSync(resultFile, 'utf-8')) } catch (_) {}
  try { fs.unlinkSync(resultFile) } catch (_) {}
  if (!result || !result.ok) {
    console.error('图标生成失败：', result ? result.error : `Electron 没有给出结果（退出码 ${r.status}）${r.stderr ? `\n${r.stderr}` : ''}`)
    process.exit(1)
  }
  delete result.ok
  for (const f of result.files) {
    const shape = f.sizes ? `${f.sizes[0]}~${f.sizes[f.sizes.length - 1]} 像素共 ${f.sizes.length} 种` : `${f.width}×${f.height}`
    console.log(`  ${f.path}  ${shape}  ${(f.bytes / 1024).toFixed(0)} KB`)
    for (const n of f.notes || []) console.log(`      ${n}`)
  }
  console.log(`  圆心 (${result.circle.cx}, ${result.circle.cy})，半径 ${result.circle.rMin.toFixed(1)}~${result.circle.rMax.toFixed(1)} 像素（原图 ${result.source.width}×${result.source.height}）`)
  if (result.preview) console.log('  预览：', result.preview)
}

// "--preview" 后面跟的那个值是参数值，不是原图路径
function isOptionValue (args, a) {
  const i = args.indexOf(a)
  return i > 0 && args[i - 1] === '--preview'
}

// ---------- 用 Electron 运行时：真正生成图标 ----------
function runInElectron () {
  const { app, nativeImage } = require('electron')
  // node 传进来的参数：原图、工程根目录、预览图路径（没有就是空串）、结果文件。
  // 命令行开关（如 --user-data-dir）也会留在 argv 里，所以从"本文件的路径"往后取，不按固定位置数
  const args = process.argv.slice(process.argv.indexOf(__filename) + 1)
  const [source, root, preview, resultFile] = args
  const finish = result => {
    try { fs.writeFileSync(resultFile, JSON.stringify(result), 'utf-8') } catch (_) {}
    app.exit(result.ok ? 0 : 1)
  }
  app.whenReady().then(() => {
    try {
      finish({ ok: true, ...generate(source, root, preview, nativeImage) })
    } catch (e) {
      finish({ ok: false, error: e && e.stack ? e.stack : String(e) })
    }
  })
}

function generate (source, root, preview, nativeImage) {
  const original = nativeImage.createFromPath(source)
  const { width: W, height: H } = original.getSize()
  if (!W || !H) throw new Error(`读不出图片：${source}`)
  if (W !== H) throw new Error(`原图不是正方形（${W}×${H}），请先裁成正方形`)

  const circle = measureCircle(original, W)
  const pad = Math.round(circle.rMax * 0.06) // 圆外留 6% 的边，图标显得不挤
  const side = Math.ceil((circle.rMax + pad) * 2)
  const x0 = Math.round(circle.cx - side / 2)
  const y0 = Math.round(circle.cy - side / 2)

  const files = []
  let master = null // 1024 的母版，icon.ico 里的各个尺寸都从它缩出来
  for (const [rel, size] of [['build/icon.png', 1024], ['src/assets/logo.png', 256]]) {
    const image = render(original, circle, x0, y0, side, size, nativeImage)
    if (size === 1024) master = image
    const png = image.toPNG()
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, png)
    files.push({ path: rel, width: size, height: size, bytes: png.length })
  }

  const ico = buildIconFile(master)
  fs.writeFileSync(path.join(root, 'build/icon.ico'), ico.data)
  files.push({ path: 'build/icon.ico', sizes: ICON_SIZES, bytes: ico.data.length, notes: ico.notes })

  let previewPath = null
  if (preview) {
    const sheet = makePreview(path.join(root, 'build/icon.png'), nativeImage)
    fs.writeFileSync(preview, sheet.toPNG())
    previewPath = preview
  }
  return { source: { width: W, height: H }, circle: { cx: +circle.cx.toFixed(1), cy: +circle.cy.toFixed(1), rMin: circle.rMin, rMax: circle.rMax }, files, preview: previewPath }
}

// 第 1 步：量出圆心和每个角度上黑边外沿的半径
function measureCircle (image, W) {
  const bmp = image.toBitmap() // 每个像素 4 个字节，顺序是 B、G、R、A
  // 按小数坐标取亮度（双线性插值）。取样点落在图外时按图边上的像素算
  const lumAt = (x, y) => {
    const x0 = Math.min(Math.max(Math.floor(x), 0), W - 2)
    const y0 = Math.min(Math.max(Math.floor(y), 0), W - 2)
    const fx = Math.min(Math.max(x - x0, 0), 1)
    const fy = Math.min(Math.max(y - y0, 0), 1)
    const lum = (px, py) => {
      const i = (py * W + px) * 4
      return (bmp[i] * 114 + bmp[i + 1] * 587 + bmp[i + 2] * 299) / 1000
    }
    return (lum(x0, y0) * (1 - fx) + lum(x0 + 1, y0) * fx) * (1 - fy) + (lum(x0, y0 + 1) * (1 - fx) + lum(x0 + 1, y0 + 1) * fx) * fy
  }

  // 黑边很暗，先找出所有"暗像素"的范围，圆心就在这个范围的中心
  let minX = W; let minY = W; let maxX = -1; let maxY = -1
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      // 原图不透明，A 恒为 255，这里顺便排除掉可能存在的透明像素
      if (bmp[i + 3] > 0 && Math.max(bmp[i], bmp[i + 1], bmp[i + 2]) < 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('原图里找不到深色的外圈，请确认是白底的圆形队徽')
  const cx = (minX + maxX + 1) / 2
  const cy = (minY + maxY + 1) / 2
  const rFar = Math.max(maxX - minX + 1, maxY - minY + 1) / 2

  // 每 0.25 度量一次：从圆外朝圆心走，记下亮度降到 128 以下的位置（黑边的外沿），
  // 并在相邻两个取样点之间线性插值，得到亚像素级别的位置
  const N = 1440
  const edge = new Float64Array(N)
  const step = 0.5
  for (let k = 0; k < N; k++) {
    const cs = Math.cos((k / N) * 2 * Math.PI)
    const sn = Math.sin((k / N) * 2 * Math.PI)
    let prev = lumAt(cx + cs * (rFar + 3), cy + sn * (rFar + 3))
    let at = rFar - 1
    for (let d = rFar + 3 - step; d > rFar - 80; d -= step) {
      const l = lumAt(cx + cs * d, cy + sn * d)
      if (l < 128) { at = d + step * ((128 - l) / (prev - l || 1)); break }
      prev = l
    }
    edge[k] = at
  }
  // 圆周上相邻角度的半径做一点平均，抹掉图像噪点带来的小抖动
  const smooth = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let s = 0
    for (let j = -4; j <= 4; j++) s += edge[(k + j + N) % N]
    smooth[k] = s / 9
  }
  let rMin = Infinity; let rMax = 0
  for (const r of smooth) { if (r < rMin) rMin = r; if (r > rMax) rMax = r }
  return { cx, cy, edge: smooth, n: N, rMin, rMax }
}

// 按角度取黑边外沿的半径（相邻两个角度之间线性插值）
function radiusAt (circle, theta) {
  const u = (((theta / (2 * Math.PI)) * circle.n) % circle.n + circle.n) % circle.n
  const k = Math.floor(u)
  const f = u - k
  return circle.edge[k] * (1 - f) + circle.edge[(k + 1) % circle.n] * f
}

// 第 2、3 步：裁剪并缩放到目标尺寸，再按量出的半径把圆外做成透明
function render (original, circle, x0, y0, side, size, nativeImage) {
  const scaled = original.crop({ x: x0, y: y0, width: side, height: side }).resize({ width: size, height: size, quality: 'best' })
  const bmp = scaled.toBitmap() // BGRA；输入是不透明图，所以每个像素的 A 都是 255
  const k = size / side // 目标图上的 1 个像素 = 原图上的 1/k 个像素
  const half = 0.5 / k
  for (let j = 0; j < size; j++) {
    const sy = y0 + (j + 0.5) / k - circle.cy
    for (let i = 0; i < size; i++) {
      const sx = x0 + (i + 0.5) / k - circle.cx
      // 覆盖比例：像素中心离圆边还有多远。≥1 完全在圆内，≤0 完全在圆外
      const cover = radiusAt(circle, Math.atan2(sy, sx)) - Math.hypot(sx, sy) + half
      if (cover >= 1) continue
      const p = (j * size + i) * 4
      if (cover <= 0) { bmp[p] = 0; bmp[p + 1] = 0; bmp[p + 2] = 0; bmp[p + 3] = 0; continue }
      // 压在边上的像素：颜色 = 黑边 × cover + 白底 × (1 - cover)。
      // 把白底的那一份减掉，就还原出黑边本身（位图里颜色是按透明度预先乘过的，所以减掉白底后正好就是该存的值）
      const white = Math.round((1 - cover) * 255)
      bmp[p] = Math.max(0, bmp[p] - white)
      bmp[p + 1] = Math.max(0, bmp[p + 1] - white)
      bmp[p + 2] = Math.max(0, bmp[p + 2] - white)
      bmp[p + 3] = Math.round(cover * 255)
    }
  }
  return nativeImage.createFromBitmap(Buffer.from(bmp), { width: size, height: size })
}

// ---------- 第 4 步：拼出 Windows 图标文件 build/icon.ico ----------

// 图标文件里放哪些尺寸（像素）。任务栏、窗口标题栏、Alt+Tab 切换用的是 16~48，
// 桌面快捷方式和资源管理器用的是 48~256，具体多大还跟显示缩放比例（100%~300%）有关。
const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
// 这两种尺寸存成 PNG 压缩格式，其余存成不压缩的 BMP（兼容性最好）。
// 128×128 的 BMP 不压缩就有 66KB，超过下面这个上限，所以 128 和 256 只能用 PNG。
const PNG_SIZES = [128, 256]
// 单个条目的体积上限（字节）。把图标写进 exe 的工具 rcedit 有个毛病：条目超过 65536 字节时，
// 登记的长度只保留后 16 位，Windows 照着这个错误的长度去读，大尺寸图标就只剩半截。
// 所以这里按 60000 控制，留一点余量。
const MAX_ENTRY_BYTES = 60000

// 图标文件 = 目录表（6 字节总头 + 每个条目 16 字节）+ 各条目的图像数据，尺寸从小到大排
function buildIconFile (master) {
  const notes = []
  const entries = ICON_SIZES.map(size => {
    const bm = master.resize({ width: size, height: size, quality: 'best' }).toBitmap() // BGRA，颜色已按透明度预先乘过
    let data
    if (PNG_SIZES.includes(size)) {
      const r = fitPngEntry(bm, size)
      data = r.data
      notes.push(`${size} 像素：${r.quality}`)
    } else {
      data = bmpEntry(size, bm)
    }
    if (data.length > MAX_ENTRY_BYTES) throw new Error(`图标里 ${size}×${size} 的条目有 ${data.length} 字节，超过了 ${MAX_ENTRY_BYTES} 字节的上限`)
    return { size, data }
  })
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(0, 0) // 保留，必须为 0
  header.writeUInt16LE(1, 2) // 1 = 这是图标（2 是鼠标指针）
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length // 第一个条目的数据紧跟在目录表后面
  entries.forEach((e, i) => {
    const o = 6 + i * 16
    header[o] = e.size === 256 ? 0 : e.size // 宽、高各占 1 个字节，256 记作 0
    header[o + 1] = e.size === 256 ? 0 : e.size
    header.writeUInt16LE(1, o + 4)
    header.writeUInt16LE(32, o + 6) // 每个像素 32 位
    header.writeUInt32LE(e.data.length, o + 8)
    header.writeUInt32LE(offset, o + 12)
    offset += e.data.length
  })
  return { data: Buffer.concat([header, ...entries.map(e => e.data)]), notes }
}

// 不压缩的条目：文件头 + 像素 + 遮罩。这是 Windows 最早期的图标格式，什么程序都认得。
//   文件头 40 字节：宽、高（要写两倍，因为像素后面还跟着一张同样大小的遮罩）、每个像素 32 位
//   像素：从下往上一行一行存，每个像素按 蓝、绿、红、透明度 的顺序
//   遮罩：每个像素 1 位，老式程序靠它判断哪里透明。像素自己带透明度，遮罩全写 0 就行；每行要凑满 32 位的整倍数
function bmpEntry (size, bm) {
  const xorBytes = size * size * 4
  const maskRowBytes = Math.ceil(size / 32) * 4
  const maskBytes = maskRowBytes * size
  const buf = Buffer.alloc(40 + xorBytes + maskBytes) // 新建时全是 0，遮罩和文件头里该为 0 的项不用再写
  buf.writeUInt32LE(40, 0) // 文件头的长度
  buf.writeInt32LE(size, 4)
  buf.writeInt32LE(size * 2, 8)
  buf.writeUInt16LE(1, 12) // 颜色平面数
  buf.writeUInt16LE(32, 14) // 每个像素 32 位
  buf.writeUInt32LE(xorBytes + maskBytes, 20) // 像素和遮罩一共多少字节
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4 // 图像第 y 行（从上往下数）存在数据里倒数第 y+1 行的位置
    const dst = 40 + y * size * 4
    for (let x = 0; x < size; x++) {
      const p = src + x * 4
      const q = dst + x * 4
      const a = bm[p + 3]
      const f = a ? 255 / a : 0 // 颜色乘过透明度（原值 × a / 255），除回去才是原值
      // 正常情况下还原出的原值不会超过 255，这里卡一下是保险
      buf[q] = Math.min(255, Math.round(bm[p] * f))
      buf[q + 1] = Math.min(255, Math.round(bm[p + 1] * f))
      buf[q + 2] = Math.min(255, Math.round(bm[p + 2] * f))
      buf[q + 3] = a
    }
  }
  return buf
}

// 压缩条目：生成一个不超过 MAX_ENTRY_BYTES 的 PNG。
// 队徽原图带着一层颗粒噪点，噪点几乎压不动，所以原样的 256×256 有 90KB 多，超限。
// 这里逐级降低画质，取第一个装得下的结果：
//   原样 → 颜色 6 位 → 颜色 5 位 → 轻微柔化后 6 位 → 轻微柔化后 5 位
// 实际停在哪一档，运行时会打印出来。
function fitPngEntry (bm, size) {
  const soft = smooth(bm, size, 0.8)
  const variants = [
    [bm, 8, '原样'],
    [bm, 6, '颜色 6 位'],
    [bm, 5, '颜色 5 位'],
    [soft, 6, '轻微柔化 + 颜色 6 位'],
    [soft, 5, '轻微柔化 + 颜色 5 位']
  ]
  for (const [src, bits, quality] of variants) {
    const data = encodePng(quantize(toStraightRgba(src), bits), size, size)
    if (data.length <= MAX_ENTRY_BYTES) return { data, quality }
  }
  throw new Error(`图标里 ${size}×${size} 的条目压缩后仍超过 ${MAX_ENTRY_BYTES} 字节，请换一张颜色更简洁的队徽原图`)
}

// 转成 PNG 要的格式：每个像素按 红、绿、蓝、透明度 存，颜色是没乘过透明度的原值
function toStraightRgba (bm) {
  const out = Buffer.alloc(bm.length)
  for (let p = 0; p < bm.length; p += 4) {
    const a = bm[p + 3]
    if (!a) continue // 全透明的像素颜色记 0，压缩起来最省
    const f = 255 / a
    out[p] = Math.min(255, Math.round(bm[p + 2] * f))
    out[p + 1] = Math.min(255, Math.round(bm[p + 1] * f))
    out[p + 2] = Math.min(255, Math.round(bm[p] * f))
    out[p + 3] = a
  }
  return out
}

// 减少每个颜色分量的档数：8 位是 256 档，6 位是 64 档，5 位是 32 档。档数少、细节少，压出来就小。
// 队徽是大块平涂的颜色，32 档肉眼也看不出差别。
function quantize (rgba, bits) {
  if (bits >= 8) return rgba
  const step = 256 >> bits
  const out = Buffer.from(rgba)
  for (let p = 0; p < out.length; p += 4) {
    for (let c = 0; c < 3; c++) out[p + c] = Math.min(255, Math.round(out[p + c] / step) * step) // 最亮的一档四舍五入后是 256，要卡回 255
  }
  return out
}

// 轻微柔化（高斯模糊），用来抹掉噪点。
// 在"颜色已经乘过透明度"的数据上做，圆边那一圈才不会被旁边的透明像素拉黑。
function smooth (bm, size, sigma) {
  const R = 2 // 只看周围 2 个像素
  const k = []
  let sum = 0
  for (let j = -R; j <= R; j++) {
    const row = []
    for (let i = -R; i <= R; i++) {
      const v = Math.exp(-(i * i + j * j) / (2 * sigma * sigma)) // 离得越近，权重越大
      row.push(v)
      sum += v
    }
    k.push(row)
  }
  const out = Buffer.alloc(bm.length)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0
        for (let j = -R; j <= R; j++) {
          const yy = y + j
          if (yy < 0 || yy >= size) continue // 图外按全透明算
          for (let i = -R; i <= R; i++) {
            const xx = x + i
            if (xx < 0 || xx >= size) continue
            s += bm[(yy * size + xx) * 4 + c] * k[j + R][i + R]
          }
        }
        out[(y * size + x) * 4 + c] = Math.round(s / sum)
      }
    }
  }
  return out
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// 把像素写成 PNG 文件内容（红、绿、蓝各 8 位 + 透明度，不隔行）。
// PNG 的压缩分两步：每一行先"过滤"（每个字节减去左邻或上邻，大片相同的颜色就变成一串 0），再整体用 deflate 压缩。
// 过滤有 5 种算法，哪种最省要看图像内容，所以每行 5 种都试一遍，取"结果里小数字最多"的那种。
function encodePng (rgba, w, h) {
  const bpp = 4
  const stride = w * bpp
  const raw = Buffer.alloc((stride + 1) * h) // 每行开头留 1 个字节记这一行用的是哪种过滤
  let prev = null
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride)
    let best = null
    let bestFilter = 0
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const line = Buffer.alloc(stride)
      let score = 0
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? cur[x - bpp] : 0
        const up = prev ? prev[x] : 0
        const upLeft = prev && x >= bpp ? prev[x - bpp] : 0
        let v = cur[x]
        if (f === 1) v -= left
        else if (f === 2) v -= up
        else if (f === 3) v -= (left + up) >> 1
        else if (f === 4) v -= paeth(left, up, upLeft)
        v &= 255 // 减出负数时绕回 0~255，解码时加回去会得到同样的结果
        line[x] = v
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) {
        bestScore = score
        best = line
        bestFilter = f
      }
    }
    raw[y * (stride + 1)] = bestFilter
    best.copy(raw, y * (stride + 1) + 1)
    prev = cur
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // 颜色类型 6 = 红、绿、蓝、透明度
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), // 等级 9 = 压得最狠
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// PNG 的第 4 种过滤（Paeth）：用左、上、左上三个邻居猜当前值，猜得准过滤后就是 0
function paeth (left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
}

// PNG 文件由一个个"数据块"组成：4 字节长度 + 4 字节类型 + 内容 + 4 字节校验码
function pngChunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

// CRC-32 校验码（PNG 规定用这个多项式）
function crc32 (buf) {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

// 效果预览：把图标缩成几种实际会显示的大小，分别放在深色和浅色底上，拼成一张图
function makePreview (iconFile, nativeImage) {
  const icon = nativeImage.createFromPath(iconFile)
  const sizes = [256, 64, 48, 32, 16]
  const gap = 24
  const left = 32
  const rowH = 288
  const width = left + sizes.reduce((s, v) => s + v + gap, 0) + 40
  const height = rowH * 2
  const bgs = [[32, 32, 36], [236, 236, 236]]
  const out = Buffer.alloc(width * height * 4)
  const put = (idx, r, g, b) => { out[idx] = b; out[idx + 1] = g; out[idx + 2] = r; out[idx + 3] = 255 }
  const blend = (idx, r, g, b, a) => {
    put(idx, (r * a + out[idx + 2] * (1 - a)), (g * a + out[idx + 1] * (1 - a)), (b * a + out[idx] * (1 - a)))
  }
  for (let row = 0; row < 2; row++) {
    for (let y = row * rowH; y < (row + 1) * rowH; y++) {
      for (let x = 0; x < width; x++) put((y * width + x) * 4, bgs[row][0], bgs[row][1], bgs[row][2])
    }
    let x = left
    for (const s of sizes) {
      const small = icon.resize({ width: s, height: s, quality: 'best' }).toBitmap()
      const y0 = row * rowH + (rowH - s >> 1)
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          const p = (j * s + i) * 4
          const a = small[p + 3] / 255
          if (a === 0) continue
          blend(((y0 + j) * width + x + i) * 4, small[p + 2] / a, small[p + 1] / a, small[p] / a, a)
        }
      }
      x += s + gap
    }
  }
  return nativeImage.createFromBitmap(out, { width, height })
}

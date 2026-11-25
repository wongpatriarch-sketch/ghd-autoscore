// 给 ExcelJS（4.4.0）打一个很小的补丁：让"列宽恰好等于 9"的列在写回时不被丢掉。
//
// 原因：ExcelJS 把列宽 9 当作"默认列宽"——凡是列宽正好是 9、又没有其他列级属性的列，
// 写回文件时会被当成"没设置过"而直接省略。真实主表的 A、B 两列（姓名、夜训周训）列宽正是 9，
// 于是软件每写一次，这两列就被悄悄改回 Excel 的默认宽度；按模板新建的空白表也有同样的问题。
//
// 补丁只改两处判断，其余行为（相邻同宽列合并成一段、没设置过列宽的列保持默认）和原来一致：
//   1. 一列只要带有列宽，就算"自定义列宽"；
//   2. 给一列套用列定义时，"没有列宽"保持为没有，而不是被填成默认值 9（否则会和文件里明确写的 9 混淆）。
// 改的是 Column 类的原型，所以只要在本软件里加载一次就全程生效；excelService.js 在最前面 require 了它。
const Column = require('exceljs/lib/doc/column')

const defn = Object.getOwnPropertyDescriptor(Column.prototype, 'defn')
Object.defineProperty(Column.prototype, 'defn', {
  ...defn,
  set (value) {
    defn.set.call(this, value)
    if (value && value.width === undefined) this.width = undefined
  }
})

Object.defineProperty(Column.prototype, 'isCustomWidth', {
  get () { return this.width !== undefined },
  configurable: true
})

// 测试 enableBlockOnError 的目标文件
// 请通过 OpenCode 修改此文件，故意引入类型错误（如将 string 赋值给 number），观察是否被阻止

export function greet(name: string): string {
  return `Hello, ${name}`
}

export function add(a: number, b: number): number {
  return a + b
}

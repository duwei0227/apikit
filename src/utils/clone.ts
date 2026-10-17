/**
 * 按 JSON 深拷贝：去掉函数、File 等不能序列化的值，也能用于 Vue 的响应式对象。
 * （structuredClone 遇到响应式代理会报错，所以这里不用它）
 */
export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

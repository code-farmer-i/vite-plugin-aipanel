#!/usr/bin/env node
/**
 * OpenCode VS Code 格式化桥接脚本
 *
 * VS Code 扩展可用时通过 HTTP API 格式化，不可用时直接返回（由 OpenCode 内置 prettier 兜底）。
 *
 * 用法: node format-bridge.cjs <filePath>
 */

import fs from 'fs'
import http from 'http'
import path from 'path'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node format-bridge.cjs <filePath>')
  process.exit(1)
}

const absPath = path.resolve(filePath)
const PORT = parseInt(process.env.AIPANEL_VSCODE_PORT || '', 10) || 51939

function touchFile(): void {
  const now = new Date()
  fs.utimesSync(absPath, now, now)
}

function probeHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.setTimeout(500, () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

interface FormatResult {
  error?: string
}

function formatViaExtension(): Promise<FormatResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ filePath: absPath })
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: '/format',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString()) as FormatResult
            if (result.error) {
              reject(new Error(result.error))
            } else {
              resolve(result)
            }
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout'))
    })
    req.write(body)
    req.end()
  })
}

async function main(): Promise<void> {
  const healthy = await probeHealth()
  if (!healthy) {
    touchFile()
    process.exit(0)
  }

  try {
    await formatViaExtension()
  } catch {
    // 扩展调用失败，由 OpenCode 内置 prettier 兜底
  }

  touchFile()
  process.exit(0)
}

main()

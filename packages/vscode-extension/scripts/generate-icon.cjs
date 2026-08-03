#!/usr/bin/env node
/**
 * 从 components 源 logo.svg 生成 PNG 图标（供 VS Code 扩展使用）
 * 使用 sharp 正确渲染 SVG 矢量图形
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SIZE = 128;
const svgPath = path.join(__dirname, "../../components/src/open-code-widget/src/assets/logo.svg");
const pngPath = path.join(__dirname, "..", "logo.png");

const svgBuffer = fs.readFileSync(svgPath);

sharp(svgBuffer)
  .resize(SIZE, SIZE)
  .png()
  .toFile(pngPath)
  .then((info) => {
    console.log(`Generated ${pngPath} (${info.size} bytes, ${info.width}x${info.height})`);
  })
  .catch((err) => {
    console.error("Failed to generate icon:", err);
    process.exit(1);
  });

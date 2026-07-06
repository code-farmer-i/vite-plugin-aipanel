/**
 * 从项目图标 SVG 生成各尺寸 PNG 图标
 * 注意：Trigger.vue 中 SVG 通过 CSS rotate(180deg)，生成 PNG 时也要旋转
 */
import sharp from "sharp";
import { resolve } from "path";

const iconsDir = resolve(import.meta.dirname || __dirname, "../public/icons");
const svgBuffer = await sharp(resolve(iconsDir, "icon.svg")).toBuffer();

const sizes = [16, 48, 128];

for (const size of sizes) {
  await sharp(svgBuffer)
    .rotate(180)
    .resize(size, size)
    .png()
    .toFile(resolve(iconsDir, `icon-${size}.png`));
  console.log(`Generated icon-${size}.png`);
}

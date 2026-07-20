/**
 * 从共享 logo.svg 生成各尺寸 PNG 图标
 * 源文件：packages/components/src/open-code-widget/src/assets/logo.svg
 */
import sharp from "sharp";
import { resolve } from "path";

const iconsDir = resolve(import.meta.dirname || __dirname, "../public/icons");
const svgBuffer = await sharp(
  resolve(
    import.meta.dirname || __dirname,
    "../../components/src/open-code-widget/src/assets/logo.svg",
  ),
).toBuffer();

const sizes = [16, 48, 128];

for (const size of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(resolve(iconsDir, `icon-${size}.png`));
  console.log(`Generated icon-${size}.png`);
}

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

declare module "*.svg?raw" {
  const content: string;
  export default content;
}

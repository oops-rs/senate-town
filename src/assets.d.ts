// Assets bundled into town.js by esbuild (tools/build.mjs): images as data
// URLs, the Tiled map as JSON.
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
declare module "*.tmj" {
  const map: unknown;
  export default map;
}

// Worker に同梱するファイルの型（JSON は Vite が取り込む）。
declare module "*.json" {
  const value: unknown;
  export default value;
}

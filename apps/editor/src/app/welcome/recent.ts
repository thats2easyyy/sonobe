/** The folder a recent prototype lives in, shortened for a secondary line ("~/Design/Prototypes"). Empty when the path has none, as for browser projects. */
export function recentFolder(path: string): string {
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(/[\\/]+/);
  if (parts.length < 3) return "";
  const folders = parts.slice(0, -1);
  const home = folders[0] === "" && (folders[1] === "Users" || folders[1] === "home") ? 3 : /^[A-Za-z]:$/.test(folders[0] ?? "") && folders[1] === "Users" ? 3 : 0;
  const shown = home ? ["~", ...folders.slice(home)] : folders;
  if (shown.length > 3) return ["…", ...shown.slice(-2)].join(separator);
  return shown.join(separator);
}

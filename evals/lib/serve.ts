/** A case's design file, served on 127.0.0.1 for the length of a run (the prompt's {{url}}). */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

export interface Served {
  url: string;
  close(): Promise<void>;
}

export async function serveFile(file: string): Promise<Served> {
  const body = readFileSync(file);
  const name = path.basename(file);
  const type = name.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
  const server = createServer((req, res) => {
    if (req.url === `/${name}` || req.url === "/") {
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/${encodeURIComponent(name)}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

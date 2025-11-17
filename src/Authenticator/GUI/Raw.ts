import http from "http";
import { join } from "path";
import { readFileSync } from "fs";

module.exports = function (port: number, url: string, content: string) {
  return new Promise<string>((resolve) => {
    const server = http.createServer(async (req, res) => {
      if (req.url.includes("?")) {
        const code = new URLSearchParams(
          req.url.substr(req.url.indexOf("?") + 1),
        ).get("code");

        try {
          if (content) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(content);
          } else {
            const file = readFileSync(
              join(process.cwd(), "assets", "server", "index.html"),
            );
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(file);
          }
        } catch (err) {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("You can close this window now.");
        }

        server.close();
        clearTimeout(timeout);
        resolve(code);
      }
    });

    const timeout = setTimeout(
      () => {
        server.close();
        resolve("cancel");
      },
      5 * 60 * 1000,
    ); // 5 minutes timeout

    server.listen(port || 8888);
    console.log(`Please open your browser and navigate to: ${url}`);
  });
};

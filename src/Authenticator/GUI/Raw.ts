import http from "http";

module.exports = function (port: number, url: string) {
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(
      () => {
        resolve("cancel");
      },
      5 * 60 * 1000,
    ); // 5 minutes timeout

    http
      .createServer(async (req, res) => {
        if (req.url.includes("?")) {
          const code = new URLSearchParams(
            req.url.substr(req.url.indexOf("?") + 1),
          ).get("code");
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("You can close this window now.");

          clearTimeout(timeout);
          resolve(code);
        }
      })
      .listen(port || 8888);
    console.log(`Please open your browser and navigate to: ${url}`);
  });
};

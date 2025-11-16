const {
  Launch,
  Microsoft,
  checkInternet,
  Mojang,
} = require("@fitzxel/minecraft-java-core");
const prompt = require("prompt");
const launcher = new Launch();

const fs = require("fs");
const accJson = "./test/account.json";
let mc;

const client_id = "7ae13d13-d132-462b-8619-bfb13246a563";
const client_secret = "";

(async () => {
  const internet = await checkInternet();
  const ms = internet
    ? new Microsoft(client_id, undefined, undefined, client_secret)
    : null;

  if (!fs.existsSync(accJson)) {
    mc = await ms.getAuth("raw");
    fs.writeFileSync(accJson, JSON.stringify(mc, null, 4));
  } else {
    mc = JSON.parse(fs.readFileSync(accJson));
    if (!mc.refresh_token) {
      mc = await ms.getAuth("raw");
      fs.writeFileSync(accJson, JSON.stringify(mc, null, 4));
    } else if (internet) {
      mc = await ms.refresh(mc);
      if (mc.error) mc = await ms.getAuth("raw");
      fs.writeFileSync(accJson, JSON.stringify(mc, null, 4));
    }
  }

  if (mc) {
    console.log("[#] Authenticated as:", mc.name);
  } else {
    console.log("[#] Using offline mode.");
    prompt.start();
    const { username } = await prompt.get(["username"]);
    mc = await Mojang.login(username);
  }

  launcher.config({
    path: "./test/minecraft",
    authenticator: mc,
    version: "latest_release",
    intelEnabledMac: true,
    instance: "test-instance",
    loader: {
      type: "forge",
      build: "latest",
      enable: false,
    },
    memory: {
      min: "2G",
      max: "4G",
    },
    java: {
      path: null,
      version: process.argv.includes("--java-version")
        ? process.argv[process.argv.indexOf("--java-version") + 1]
        : null,
      type: "jre",
    },
    detached: process.argv.includes("--detached"),
  });

  launcher
    .on("progress", (progress, size, element) =>
      console.log(
        `[Game DL]: ${element} - ${((progress / size) * 100).toFixed(2)}%`,
      ),
    )
    .on("patch", (patch) => process.stdout.write(`[Game Patch]: ${patch}`))
    .on("data", (line) => process.stdout.write(`[Game Data]: ${line}`))
    .on("error", (error) => console.error(`[Game Error]: ${error.message}`))
    .on("close", (code) => {
      console.log(`[Game]: exited with code ${code}.`);
      process.exit(0);
    });

  if (process.argv.includes("--only-download")) {
    console.log("[#] Starting download only...");
    await launcher.downloadGame();

    console.log("[#] Game download completed. Exiting...");
    process.exit(0);
  } else {
    const mcProcess = await launcher.start();
    console.log(`
            ---------- Minecraft launched ----------
        [#] Minecraft launched successfully! PID: ${mcProcess.pid}
            ----------------------------------------
        `);

    if (process.argv.includes("--auto-close")) {
      console.log("[#] Auto-closing Minecraft in 20 seconds...");
      setTimeout(() => {
        console.log("[#] Minecraft closed automatically...");
        mcProcess.kill();
      }, 20000);
    }
  }
})();

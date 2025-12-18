const {
  Launch,
  Microsoft,
  checkInternet,
  Mojang,
} = require("@fitzxel/minecraft-java-core");
const prompt = require("prompt");
const fs = require("fs");

const launcher = new Launch();
const offline = true;
const accJson = "./test/account.json";
let mc;

// this logging test gonna fail with this client_id if secret is empty or invalid
const client_id = "7ae13d13-d132-462b-8619-bfb13246a563";
const client_secret = "";

(async () => {
  try {
    if (offline) throw "[#] Offline mode";

    const internet = await checkInternet();
    const ms = new Microsoft(client_id, undefined, undefined, client_secret);

    const fileFound = fs.existsSync(accJson);

    if (!internet && !fileFound) {
      throw "[#] No internet connection and no account file found.";
    }

    if (!fileFound) {
      console.log("[#] No account file found, getting new auth...");
      mc = await ms.getAuth("raw");
      fs.writeFileSync(accJson, JSON.stringify(mc, null, 4));
    } else {
      mc = JSON.parse(fs.readFileSync(accJson));
      if (!mc.refresh_token) {
        console.log("[#] No refresh token found, getting new auth...");
        mc = await ms.getAuth("raw");
        fs.writeFileSync(accJson, JSON.stringify(mc, null, 4));
      } else {
        console.log("[#] Refreshing auth...");
        mc = await ms.refresh(mc);
        if (mc.error) mc = await ms.getAuth("raw");
        fs.writeFileSync(accJson, JSON.stringify(mc, null, 4));
      }
    }

    if (mc.error) throw mc;
    console.log("[#] Authenticated as:", mc.name);
  } catch (err) {
    console.log(err);
    if (err !== "[#] Offline mode")
      console.log("[#] Auth failed, using offline mode.");

    prompt.start();
    const { username } = await prompt.get(["username"]);
    mc = await Mojang.login(username);
  }

  launcher.config({
    path: "./test/minecraft",
    authenticator: mc,
    version: "1.20.1",
    intelEnabledMac: true,
    instance: "test-instance",
    loader: {
      type: "forge",
      build: "1.20.1-47.4.10",
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
        `[Game DL]: ${element} - ${((progress / size) * 100).toFixed(2)}%`
      )
    )
    .on("patch", (patch) => process.stdout.write(`[Game Patch]: ${patch}`))
    .on("data", (line) => process.stdout.write(`[Game Data]: ${line}`))
    .on("error", (error) =>
      console.error(`[Game Error]: ${error.message || JSON.stringify(error)}`)
    )
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
    if (mcProcess.pid) {
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
    } else {
      console.log("[#] Minecraft failed to launch.");
      process.exit(1);
    }
  }
})();

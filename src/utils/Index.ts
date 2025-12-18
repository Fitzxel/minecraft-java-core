/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";
import * as tar from "tar";
import Unzipper from "./unzipper.js";

// This interface defines the structure of a Minecraft library rule.
interface LibraryRule {
  action: "allow" | "disallow";
  os?: {
    name?: string;
  };
  features?: any; // Adjust or remove if not used in your code
}

/**
 * Represents a Library object, possibly containing rules or additional fields.
 * Adjust according to your actual library structure.
 */
interface MinecraftLibrary {
  name: string;
  rules?: LibraryRule[];
  downloads?: {
    artifact?: {
      url?: string;
      size?: number;
    };
  };
  natives?: Record<string, string>;
  [key: string]: any; // Extend if needed
}

/**
 * Represents a minimal version JSON structure to check if it's considered "old" (pre-1.6 or legacy).
 */
interface MinecraftVersionJSON {
  assets?: string; // "legacy" or "pre-1.6" indicates older assets
  [key: string]: any;
}

/**
 * Parses a Gradle/Maven identifier string (like "net.minecraftforge:forge:1.19-41.0.63")
 * into a local file path (group/artifact/version) and final filename (artifact-version.jar).
 * Optionally allows specifying a native string suffix or forcing an extension.
 *
 * @param main         A Gradle-style coordinate (group:artifact:version[:classifier])
 * @param nativeString A suffix for native libraries (e.g., "-natives-linux")
 * @param forceExt     A forced file extension (default is ".jar")
 * @returns An object with `path` and `name`, where `path` is the directory path and `name` is the filename
 */
function getPathLibraries(
  main: string,
  nativeString?: string,
  forceExt?: string
) {
  // Example "net.minecraftforge:forge:1.19-41.0.63"
  const libSplit = main.split(":");

  // If there's a fourth element, it's typically a classifier appended to version
  const fileName = libSplit[3] ? `${libSplit[2]}-${libSplit[3]}` : libSplit[2];

  // Replace '@' in versions if present (e.g., "1.0@beta" => "1.0.beta")
  let finalFileName = fileName.includes("@")
    ? fileName.replace("@", ".")
    : `${fileName}${nativeString || ""}${forceExt || ".jar"}`;

  // Construct the path: "net.minecraftforge" => "net/minecraftforge"
  // artifact => "forge"
  // version => "1.19-41.0.63"
  const pathLib = `${libSplit[0].replace(/\./g, "/")}/${libSplit[1]}/${
    libSplit[2].split("@")[0]
  }`;

  return {
    path: pathLib,
    name: `${libSplit[1]}-${finalFileName}`,
    version: libSplit[2],
  };
}

/**
 * Computes a hash (default SHA-1) of the given file by streaming its contents.
 *
 * @param filePath   Full path to the file on disk
 * @param algorithm  Hashing algorithm (default: "sha1")
 * @returns          A Promise resolving to the hex string of the file's hash
 */
async function getFileHash(
  filePath: string,
  algorithm: string = "sha1"
): Promise<string> {
  const shasum = crypto.createHash(algorithm);
  const fileStream = fs.createReadStream(filePath);

  return new Promise((resolve) => {
    fileStream.on("data", (data) => {
      shasum.update(data);
    });

    fileStream.on("end", () => {
      resolve(shasum.digest("hex"));
    });
  });
}

/**
 * Determines if a given Minecraft version JSON is considered "old"
 * by checking its assets field (e.g., "legacy" or "pre-1.6").
 *
 * @param json The Minecraft version JSON
 * @returns true if it's an older version, false otherwise
 */
function isold(json: MinecraftVersionJSON): boolean {
  return json.assets === "legacy" || json.assets === "pre-1.6";
}

/**
 * Returns metadata necessary to download specific loaders (Forge, Fabric, etc.)
 * based on a loader type string (e.g., "forge", "fabric").
 * If the loader type is unrecognized, returns undefined.
 *
 * @param type A string representing the loader type
 */
function loader(type: string) {
  if (type === "forge") {
    return {
      metaData:
        "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
      meta: "https://files.minecraftforge.net/net/minecraftforge/forge/${build}/meta.json",
      promotions:
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
      install:
        "https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer",
      universal:
        "https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-universal",
      client:
        "https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-client",
    };
  } else if (type === "neoforge") {
    return {
      legacyMetaData:
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge",
      metaData:
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
      legacyInstall:
        "https://maven.neoforged.net/releases/net/neoforged/forge/${version}/forge-${version}-installer.jar",
      install:
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar",
    };
  } else if (type === "fabric") {
    return {
      metaData: "https://meta.fabricmc.net/v2/versions",
      json: "https://meta.fabricmc.net/v2/versions/loader/${version}/${build}/profile/json",
    };
  } else if (type === "legacyfabric") {
    return {
      metaData: "https://meta.legacyfabric.net/v2/versions",
      json: "https://meta.legacyfabric.net/v2/versions/loader/${version}/${build}/profile/json",
    };
  } else if (type === "quilt") {
    return {
      metaData: "https://meta.quiltmc.org/v3/versions",
      json: "https://meta.quiltmc.org/v3/versions/loader/${version}/${build}/profile/json",
    };
  }
  // If none match, return undefined
}

/**
 * A list of potential Maven mirrors for downloading libraries.
 */
const mirrors = [
  "https://maven.minecraftforge.net",
  "https://maven.neoforged.net/releases",
  "https://maven.creeperhost.net",
  "https://libraries.minecraft.net",
  "https://repo1.maven.org/maven2",
];

/**
 * Reads a .jar, .zip, or .tar.gz file, returning specific entries or listing file entries in the archive.
 *
 * @param archivePath Full path to the archive file (.jar, .zip, or .tar.gz)
 * @param file        The file entry to extract data from (e.g., "install_profile.json"). If null, returns all entries or partial lists.
 * @param prefix      A path prefix filter (e.g., "maven/org/lwjgl/") if you want a list of matching files instead of direct extraction
 * @param includeDirs Whether to include directories in the result
 * @returns           A buffer or an array of { name, data, isDirectory }, or a list of filenames if prefix is given
 */
async function getFileFromArchive(
  archivePath: string,
  file: string | null = null,
  prefix: string | null = null,
  includeDirs: boolean = false
): Promise<any> {
  const result: any[] = [];
  const ext = path.extname(archivePath).toLowerCase();
  const isTarGz =
    archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz");

  // Handle TAR.GZ files
  if (isTarGz || ext === ".tar" || ext === ".gz") {
    return new Promise((resolve, reject) => {
      const entries: Array<{
        name: string;
        data: Buffer;
        isDirectory: boolean;
      }> = [];

      tar.t({
        file: archivePath,
        sync: true,
        onentry: (entry) => {
          const entryName = entry.path;
          const isDirectory = entry.type === "Directory";

          if (!isDirectory) {
            // Read the file content
            const chunks: Buffer[] = [];
            entry.on("data", (chunk: Buffer) => chunks.push(chunk));
            entry.on("end", () => {
              const data = Buffer.concat(chunks);
              entries.push({ name: entryName, data, isDirectory });
            });
          } else {
            entries.push({
              name: entryName,
              data: Buffer.alloc(0),
              isDirectory,
            });
          }
        },
      });

      // Process collected entries
      for (const entry of entries) {
        if (includeDirs ? !prefix : !entry.isDirectory && !prefix) {
          if (entry.name === file) {
            return resolve(entry.data);
          } else if (!file) {
            result.push({
              name: entry.name,
              data: entry.data,
              isDirectory: entry.isDirectory,
            });
          }
        }

        if (!entry.isDirectory && prefix && entry.name.includes(prefix)) {
          result.push(entry.name);
        }
      }

      if (file && !prefix) {
        return resolve(undefined);
      }
      resolve(result);
    });
  }

  // Handle ZIP files (original logic)
  const zip = new Unzipper(archivePath);
  const entries = zip.getEntries();

  return new Promise((resolve) => {
    for (const entry of entries) {
      if (includeDirs ? !prefix : !entry.isDirectory && !prefix) {
        if (entry.entryName === file) {
          return resolve(entry.getData());
        } else if (!file) {
          result.push({
            name: entry.entryName,
            data: entry.getData(),
            isDirectory: entry.isDirectory,
          });
        }
      }

      if (!entry.isDirectory && prefix && entry.entryName.includes(prefix)) {
        result.push(entry.entryName);
      }
    }

    if (file && !prefix) {
      return resolve(undefined);
    }

    resolve(result);
  });
}

/**
 * Determines if a library should be skipped based on its 'rules' property.
 * For example, it might skip libraries if action='disallow' for the current OS,
 * or if there are specific conditions not met.
 *
 * @param lib A library object (with optional 'rules' array)
 * @returns true if the library should be skipped, false otherwise
 */
function skipLibrary(lib: MinecraftLibrary): boolean {
  // Map Node.js platform strings to Mojang's naming
  const LibMap: Record<string, string> = {
    win32: "windows",
    darwin: "osx",
    linux: "linux",
  };

  // If no rules, it's not skipped
  if (!lib.rules) {
    return false;
  }

  let shouldSkip = true;

  for (const rule of lib.rules) {
    // If features exist, your logic can handle them here
    if (rule.features) {
      // Implementation is up to your usage
      continue;
    }

    // "allow" means it can be used if OS matches (or no OS specified)
    // "disallow" means skip if OS matches (or no OS specified)
    if (
      rule.action === "allow" &&
      ((rule.os && rule.os.name === LibMap[process.platform]) || !rule.os)
    ) {
      shouldSkip = false;
    } else if (
      rule.action === "disallow" &&
      ((rule.os && rule.os.name === LibMap[process.platform]) || !rule.os)
    ) {
      shouldSkip = true;
    }
  }

  return shouldSkip;
}

function fromAnyReadable(
  webStream: ReadableStream<Uint8Array>
): import("node:stream").Readable {
  let NodeReadableStreamCtor: typeof ReadableStream | undefined;
  if (!NodeReadableStreamCtor && typeof globalThis?.navigator === "undefined") {
    import("node:stream/web").then((mod) => {
      NodeReadableStreamCtor = mod.ReadableStream;
    });
  }
  if (
    NodeReadableStreamCtor &&
    webStream instanceof NodeReadableStreamCtor &&
    typeof (Readable as any).fromWeb === "function"
  ) {
    return Readable.fromWeb(webStream as any);
  }

  const nodeStream = new Readable({ read() {} });
  const reader = webStream.getReader();

  (function pump() {
    reader
      .read()
      .then(({ done, value }) => {
        if (done) return nodeStream.push(null);
        nodeStream.push(Buffer.from(value));
        pump();
      })
      .catch((err) => nodeStream.destroy(err));
  })();

  return nodeStream;
}

// Export all utility functions and constants
export {
  getPathLibraries,
  getFileHash,
  isold,
  loader,
  mirrors,
  getFileFromArchive,
  skipLibrary,
  fromAnyReadable,
};

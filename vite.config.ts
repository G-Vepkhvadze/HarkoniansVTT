import * as fsPromises from "fs/promises";
import copy from "rollup-plugin-copy";
import { defineConfig, Plugin } from "vite";
import { promises as fs } from "fs";

const moduleVersion = process.env.MODULE_VERSION;
const githubProject = process.env.GH_PROJECT;
const githubTag = process.env.GH_TAG;

async function copyCSS() {
    try {
        await fs.mkdir("dist/styles", { recursive: true });
        await fs.copyFile("src/styles/harkonians.css", "dist/styles/harkonians.css");
    } catch (error) {
        console.error("Error copying CSS:", error);
    }
}

async function copyTemplates() {
    try {
        await fs.mkdir("dist/templates", { recursive: true });
        const files = await fs.readdir("src/templates");
        for (const file of files) {
            await fs.copyFile(`src/templates/${file}`, `dist/templates/${file}`);
        }
    } catch (error) {
        console.error("Error copying templates:", error);
    }
}

export default defineConfig({
  build: {
    sourcemap: true,
    outDir: "dist",
    rollupOptions: {
      input: "src/scripts/main.js",
      output: {
        entryFileNames: "scripts/main.js",
        format: "es",
      },
    },
  },
  plugins: [
    updateModuleManifestPlugin(),
    copy({
      targets: [
        { src: "src/languages", dest: "dist" },
        { src: "src/styles/favicon.ico", dest: "dist" },
      ],
      hook: "writeBundle",
    }),
    {
      name: "copy-assets",
      async closeBundle() {
        await copyCSS();
        await copyTemplates();
      }
    }
  ],
});

function updateModuleManifestPlugin(): Plugin {
  return {
    name: "update-module-manifest",
    async writeBundle(): Promise<void> {
      const manifestContents: string = await fsPromises.readFile(
        "src/module.json",
        "utf-8"
      );
      const manifestJson = JSON.parse(manifestContents) as Record<string, unknown>;
      const version = moduleVersion || (manifestJson.version as string);
      manifestJson["version"] = version;
      if (githubProject) {
        const baseUrl = `https://github.com/${githubProject}/releases`;
        manifestJson["manifest"] = `${baseUrl}/latest/download/module.json`;
        if (githubTag) {
          manifestJson[
            "download"
          ] = `${baseUrl}/download/${githubTag}/harkoniansvtt.zip`;
        }
      }
      await fsPromises.writeFile(
        "dist/module.json",
        JSON.stringify(manifestJson, null, 4)
      );
    },
  };
}

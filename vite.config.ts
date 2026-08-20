import { defineConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, "dist");

async function copyFile(
    source: string,
    destination: string
) {
    await fs.mkdir(
        path.dirname(destination),
        { recursive: true }
    );

    await fs.copyFile(
        source,
        destination
    );
}

async function copyDirectory(
    source: string,
    destination: string
) {
    await fs.mkdir(
        destination,
        { recursive: true }
    );

    const entries =
        await fs.readdir(
            source,
            { withFileTypes: true }
        );

    for (const entry of entries) {
        const sourcePath =
            path.join(
                source,
                entry.name
            );

        const destinationPath =
            path.join(
                destination,
                entry.name
            );

        if (entry.isDirectory()) {
            await copyDirectory(
                sourcePath,
                destinationPath
            );
        } else {
            await copyFile(
                sourcePath,
                destinationPath
            );
        }
    }
}

function copyFoundryFiles() {
    return {
        name: "copy-foundry-files",

        async closeBundle() {

            await copyFile(
                path.resolve(
                    rootDir,
                    "styles",
                    "harkonians.css"
                ),
                path.resolve(
                    distDir,
                    "styles",
                    "harkonians.css"
                )
            );

            await copyDirectory(
                path.resolve(
                    rootDir,
                    "templates"
                ),
                path.resolve(
                    distDir,
                    "templates"
                )
            );

            await copyFile(
                path.resolve(
                    rootDir,
                    "module.json"
                ),
                path.resolve(
                    distDir,
                    "module.json"
                )
            );

            console.log(
                "HarkoniansVTT | Foundry files copied."
            );
        }
    };
}

export default defineConfig({
    build: {

        lib: {
            entry: path.resolve(
                rootDir,
                "src",
                "main.js"
            ),

            formats: ["es"],

            fileName: () => "src/main.js"
        },

        rollupOptions: {
            output: {
                format: "es",

                entryFileNames:
                    "src/main.js",

                chunkFileNames:
                    "src/[name].js",

                assetFileNames:
                    "src/assets/[name][extname]"
            }
        },

        emptyOutDir: true,

        sourcemap: false,

        minify: false
    },

    plugins: [
        copyFoundryFiles()
    ]
});
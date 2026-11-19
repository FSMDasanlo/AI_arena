const { build } = require("esbuild");
const { cp, mkdir } = require("node:fs/promises");
const path = require("node:path");

async function main() {
    await mkdir("dist", { recursive: true });
    await build({
        entryPoints: ["js/attachments.js"],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        outfile: "dist/attachments.js",
        minify: true,
    });
    const pdfDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
    await cp(path.join(pdfDir, "legacy", "build", "pdf.worker.min.mjs"), "dist/pdf.worker.min.mjs");
    for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
        await cp(path.join(pdfDir, dir), path.join("dist", dir), { recursive: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

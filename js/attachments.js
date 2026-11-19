import { MAX_ARCHIVE_BYTES, unzip } from "./archive.mjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth/mammoth.browser.js";
import ExcelJS from "exceljs/dist/exceljs.min.js";

const MAX_TEXT_BYTES = 200 * 1024;
const TEXT_EXTENSIONS = new Set([
    "txt", "md", "csv", "json", "xml", "html", "css", "js", "ts", "py",
    "java", "c", "cpp", "cs", "sql", "log", "yml", "yaml",
]);
const encoder = new TextEncoder();

pdfjs.GlobalWorkerOptions.workerSrc = new URL("dist/pdf.worker.min.mjs", document.baseURI).href;

function extension(name) {
    return name.split(".").pop().toLowerCase();
}

function supported(name) {
    return TEXT_EXTENSIONS.has(extension(name)) ||
        ["pdf", "docx", "xlsx", "jpg", "jpeg", "png"].includes(extension(name));
}

async function pdfText(bytes) {
    const base = new URL("dist/", document.baseURI);
    const task = pdfjs.getDocument({
        data: bytes.slice(),
        cMapUrl: new URL("cmaps/", base).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("standard_fonts/", base).href,
        wasmUrl: new URL("wasm/", base).href,
    });
    try {
        const pdf = await task.promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((item) => item.str || "").join(" "));
            if (encoder.encode(pages.join("\n")).length > MAX_TEXT_BYTES) {
                throw new Error("El texto extraído supera 200 KB.");
            }
        }
        return pages.join("\n");
    } finally {
        await task.destroy();
    }
}

async function fileContent(name, bytes, plainText = false) {
    const ext = extension(name);
    if (plainText || TEXT_EXTENSIONS.has(ext)) {
        if (bytes.length > MAX_TEXT_BYTES) throw new Error("El texto supera 200 KB.");
        const text = new TextDecoder().decode(bytes);
        if (text.includes("\u0000")) throw new Error("No es un archivo de texto válido.");
        return { text };
    }
    if (ext === "jpg" || ext === "jpeg" || ext === "png") {
        const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
        const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if ((ext === "png" && !png) || (ext !== "png" && !jpeg)) {
            throw new Error("La imagen no es un JPG o PNG válido.");
        }
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = () => reject(new Error("No se ha podido leer la imagen."));
            reader.readAsDataURL(new Blob([bytes], { type: png ? "image/png" : "image/jpeg" }));
        });
        return { image: { name, mimeType: png ? "image/png" : "image/jpeg", data } };
    }
    let text;
    if (ext === "pdf") {
        text = await pdfText(bytes);
    } else if (ext === "docx") {
        unzip(bytes, undefined, 1000);
        const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
        text = result.value;
    } else if (ext === "xlsx") {
        unzip(bytes, undefined, 1000);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes);
        const sheets = [];
        let textBytes = 0;
        workbook.eachSheet((sheet) => {
            const rows = [];
            sheet.eachRow((row) => {
                const cells = [];
                row.eachCell((cell) => {
                    const value = `${cell.address}: ${cell.text}`;
                    textBytes += encoder.encode(value).length + 1;
                    if (textBytes > MAX_TEXT_BYTES) throw new Error("El texto extraído supera 200 KB.");
                    cells.push(value);
                });
                rows.push(cells.join("\t"));
            });
            sheets.push(`Hoja: ${sheet.name}\n${rows.join("\n")}`);
        });
        text = sheets.join("\n\n");
    } else {
        throw new Error("Formato no compatible.");
    }
    if (!text.trim()) throw new Error("No contiene texto extraíble (no se realiza OCR).");
    if (encoder.encode(text).length > MAX_TEXT_BYTES) throw new Error("El texto extraído supera 200 KB.");
    return { text };
}

async function readAttachment(file) {
    const isZip = extension(file.name) === "zip";
    const plainText = TEXT_EXTENSIONS.has(extension(file.name)) ||
        (!isZip && !supported(file.name) && file.type.startsWith("text/"));
    const limit = plainText ? MAX_TEXT_BYTES : MAX_ARCHIVE_BYTES;
    if (file.size > limit) throw new Error(`El archivo supera ${limit / 1024 / (limit === MAX_TEXT_BYTES ? 1 : 1024)} ${limit === MAX_TEXT_BYTES ? "KB" : "MB"}.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = isZip ? unzip(bytes, supported) : [{ name: file.name, bytes }];
    const texts = [];
    const images = [];
    const warnings = [];
    let textBytes = 0;
    for (const entry of entries) {
        if (!supported(entry.name) && !(plainText && !isZip)) {
            warnings.push(`${entry.name}: formato no compatible.`);
            continue;
        }
        try {
            const content = await fileContent(entry.name, entry.bytes, plainText && !isZip);
            if (content.image) {
                images.push(content.image);
            } else {
                const block = `Contenido del archivo "${entry.name}":\n"""\n${content.text}\n"""`;
                const blockBytes = encoder.encode(content.text).length;
                if (textBytes + blockBytes > MAX_TEXT_BYTES) throw new Error("El texto total supera 200 KB.");
                textBytes += blockBytes;
                texts.push(block);
            }
        } catch (error) {
            if (!isZip) throw error;
            warnings.push(`${entry.name}: ${error.message}`);
        }
    }
    if (!texts.length && !images.length) {
        throw new Error(`No hay contenido compatible para enviar.${warnings.length ? `\n${warnings.join("\n")}` : ""}`);
    }
    if (images.length) warnings.push("Las imágenes solo se envían a Gemini; Groq no las procesa.");
    return { name: file.name, text: texts.join("\n\n"), images, warnings };
}

window.ArenaAttachments = { readAttachment };

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createApp(attachmentReader) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) {
            elements.set(id, {
                value: "",
                textContent: "",
                disabled: false,
                hidden: false,
                classList: { add() {}, remove() {} },
                addEventListener(name, callback) { this[name] = callback; },
            });
        }
        return elements.get(id);
    };
    const calls = [];
    const document = {
        getElementById: element,
        querySelectorAll: () => [],
        addEventListener: (name, callback) => { if (name === "DOMContentLoaded") callback(); },
    };
    const context = vm.createContext({
        document,
        window: {
            APP_CONFIG: { groqApiKey: "test", geminiApiKey: "test" },
            ArenaAttachments: { readAttachment: attachmentReader },
        },
        fetch: async (url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return {
                ok: true,
                json: async () => url.includes("groq.com")
                    ? { choices: [{ message: { content: "Groq" } }] }
                    : { candidates: [{ content: { parts: [{ text: "Gemini" }] } }] },
            };
        },
        performance, AbortSignal, setInterval, clearInterval, setTimeout,
        alert: (message) => { throw new Error(message); },
    });
    vm.runInContext(fs.readFileSync("js/app.js", "utf8"), context);
    return { context, element, calls };
}

test("sends text to both providers but images only to Gemini", async () => {
    const attachment = {
        name: "contenido.zip",
        text: "Contenido del PDF",
        images: [{ name: "foto.png", mimeType: "image/png", data: "datos" }],
        warnings: ["Las imágenes solo se envían a Gemini."],
    };
    const app = createApp(async () => attachment);
    await app.context.onFileSelected({ target: { files: [{ name: attachment.name }] } });
    await app.context.fight("Pregunta");

    assert.equal(app.calls.length, 2);
    const groq = app.calls.find((call) => call.url.includes("groq.com")).body;
    const gemini = app.calls.find((call) => call.url.includes("googleapis.com")).body;
    assert.match(groq.messages[0].content, /Contenido del PDF/);
    assert.equal(JSON.stringify(groq).includes("datos"), false);
    assert.match(gemini.contents[0].parts[0].text, /Contenido del PDF/);
    assert.equal(gemini.contents[0].parts[2].inlineData.data, "datos");
    assert.match(app.element("file-warning").textContent, /solo se envían a Gemini/);
});

test("an image-only attachment does not call Groq or declare a winner", async () => {
    const app = createApp(async () => ({
        name: "foto.png", text: "", images: [{ name: "foto.png", mimeType: "image/png", data: "datos" }], warnings: [],
    }));
    await app.context.onFileSelected({ target: { files: [{ name: "foto.png" }] } });
    await app.context.fight("Pregunta");
    assert.equal(app.calls.length, 1);
    assert.match(app.calls[0].url, /googleapis/);
    assert.match(app.element("verdict").textContent, /Solo Gemini/);
});

test("clearing an attachment while it is being read prevents stale results", async () => {
    let finish;
    const app = createApp(() => new Promise((resolve) => { finish = resolve; }));
    const reading = app.context.onFileSelected({ target: { files: [{ name: "archivo.pdf" }] } });
    assert.equal(app.element("fight-btn").disabled, true);
    app.element("file-clear").click();
    finish({ name: "archivo.pdf", text: "antiguo", images: [], warnings: [] });
    await reading;
    await app.context.fight("Pregunta");
    assert.equal(app.element("file-name").textContent, "");
    assert.equal(app.element("fight-btn").disabled, false);
    assert.equal(app.calls[0].body.messages[0].content, "Pregunta");
});

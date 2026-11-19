const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createDialog(responses) {
    const elements = new Map();
    function makeElement() {
        return {
            value: "", disabled: false, hidden: false, children: [],
            classList: { add() {}, remove() {} },
            addEventListener(name, callback) { this[name] = callback; },
            append(...children) { this.children.push(...children); },
            appendChild(child) { this.children.push(child); },
            set textContent(value) { this.text = value; this.children = []; },
            get textContent() { return this.text || ""; },
        };
    }
    function element(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    }
    const calls = [];
    const context = vm.createContext({
        document: {
            getElementById: element,
            createElement: makeElement,
            addEventListener(name, callback) { if (name === "DOMContentLoaded") callback(); },
        },
        window: { APP_CONFIG: { groqApiKey: "test", geminiApiKey: "test" } },
        fetch: async (url, options) => {
            const id = url.includes("groq.com") ? "groq" : "gemini";
            calls.push({ id, body: JSON.parse(options.body) });
            const result = responses[id].shift();
            if (result instanceof Error) throw result;
            assert.notEqual(result, undefined, `unexpected ${id} request`);
            return {
                ok: true,
                json: async () => id === "groq"
                    ? { choices: [{ message: { content: result } }] }
                    : { candidates: [{ content: { parts: [{ text: result }] } }] },
            };
        },
        performance, AbortSignal, setInterval, clearInterval, setTimeout,
        alert: (message) => { throw new Error(message); },
    });
    vm.runInContext(fs.readFileSync("js/dialogos.js", "utf8"), context);
    element("prompt-groq").value = "Postura Groq";
    element("prompt-gemini").value = "Postura Gemini";
    return { context, element, calls };
}

test("retries only the failed fighter with the same round request and preserves both histories", async () => {
    const app = createDialog({
        groq: ["Groq 1", "Groq 2", "Groq 3"],
        gemini: ["Gemini 1", new Error("Saturado"), new Error("Sigue saturado"), "Gemini 2", "Gemini 3"],
    });
    await app.context.nextRound();
    app.element("prompt-gemini").value = "Matiz";
    await app.context.nextRound();

    assert.equal(app.element("retry-gemini").hidden, false);
    assert.equal(app.element("retry-groq").hidden, true);
    assert.equal(app.element("fight-btn").disabled, true);
    assert.equal(app.element("prompt-gemini").disabled, true);
    const failed = app.calls.at(-1).body;
    assert.match(failed.contents.at(-1).parts[0].text, /Groq 1/);
    assert.match(failed.contents.at(-1).parts[0].text, /Matiz/);

    await app.element("retry-gemini").click();
    assert.equal(app.element("retry-gemini").hidden, false);
    assert.deepEqual(app.calls.at(-1).body, failed);
    await app.element("retry-gemini").click();
    assert.deepEqual(app.calls.at(-1).body, failed);
    assert.equal(app.calls.filter((call) => call.id === "groq").length, 2);
    assert.equal(app.element("answer-gemini").children.length, 2);
    assert.equal(app.element("fight-btn").disabled, false);
    assert.equal(app.element("retry-gemini").hidden, true);

    await app.context.nextRound();
    const groq = app.calls.filter((call) => call.id === "groq").at(-1).body.messages;
    const gemini = app.calls.filter((call) => call.id === "gemini").at(-1).body.contents;
    assert.equal(groq.length, 5);
    assert.match(groq[4].content, /Gemini 2/);
    assert.equal(gemini.length, 5);
    assert.match(gemini[4].parts[0].text, /Groq 2/);
});

test("first-round failures can be retried independently or reset", async () => {
    const app = createDialog({
        groq: [new Error("Error Groq"), "Groq 1"],
        gemini: [new Error("Error Gemini"), "Gemini 1"],
    });
    await app.context.nextRound();
    assert.equal(app.element("retry-groq").hidden, false);
    assert.equal(app.element("retry-gemini").hidden, false);
    await app.element("retry-groq").click();
    assert.equal(app.element("fight-btn").disabled, true);
    assert.equal(app.element("retry-groq").hidden, true);
    assert.equal(app.element("retry-gemini").hidden, false);
    await app.element("retry-gemini").click();
    assert.equal(app.element("round-info").textContent, "Ronda 1 completada");
    assert.equal(app.element("fight-btn").disabled, false);
    assert.equal(app.calls.at(-1).body.contents.length, 1);
    app.context.resetAll();
    assert.equal(app.element("round-info").textContent, "Ronda 0");
    assert.equal(app.element("retry-gemini").hidden, true);
    assert.equal(app.element("fight-btn").disabled, false);
});

test("reset discards an incomplete round", async () => {
    const app = createDialog({
        groq: ["Groq 1", "Groq nuevo"],
        gemini: [new Error("Error Gemini"), "Gemini nuevo"],
    });
    await app.context.nextRound();
    app.context.resetAll();
    assert.equal(app.element("retry-gemini").hidden, true);
    assert.equal(app.element("prompt-gemini").disabled, false);
    app.element("prompt-groq").value = "Nuevo Groq";
    app.element("prompt-gemini").value = "Nuevo Gemini";
    await app.context.nextRound();
    const groq = app.calls.filter((call) => call.id === "groq").at(-1).body.messages;
    assert.equal(groq.length, 1);
    assert.equal(groq[0].content, "Nuevo Groq");
});

import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { MAX_ARCHIVE_BYTES, unzip } from "../js/archive.mjs";

test("extracts supported files and reports unsupported entries without decompressing them", () => {
    const archive = zipSync({
        "carpeta/a.txt": strToU8("hola"),
        "antiguo.doc": new Uint8Array(MAX_ARCHIVE_BYTES + 1),
    });
    const files = unzip(archive, (name) => name.endsWith(".txt"));
    assert.equal(new TextDecoder().decode(files.find((f) => f.name.endsWith(".txt")).bytes), "hola");
    assert.deepEqual(files.find((f) => f.name.endsWith(".doc")), { name: "antiguo.doc" });
});

test("rejects archives exceeding the actual decompressed size limit", () => {
    const archive = zipSync({ "grande.txt": new Uint8Array(MAX_ARCHIVE_BYTES + 1) });
    assert.throws(() => unzip(archive), /descomprimido supera 10 MB/);
});

test("rejects too many entries and incomplete archives", () => {
    const entries = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`${i}.txt`, strToU8("x")]));
    assert.throws(() => unzip(zipSync(entries)), /supera 100 archivos/);
    const valid = zipSync({ "a.txt": strToU8("hola") });
    assert.throws(() => unzip(valid.subarray(0, valid.length - 10)));
});

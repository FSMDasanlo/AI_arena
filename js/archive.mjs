import { Unzip, UnzipInflate, unzipSync } from "fflate";

export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
export function unzip(bytes, shouldExtract = () => true, maxEntries = 100) {
    unzipSync(bytes, { filter: () => false });
    const files = [];
    let total = 0;
    let entries = 0;
    let completed = 0;
    const unzipper = new Unzip((file) => {
        if (file.name.endsWith("/")) return;
        if (++entries > maxEntries) throw new Error(`El ZIP supera ${maxEntries} archivos.`);
        if (!shouldExtract(file.name)) {
            files.push({ name: file.name });
            completed++;
            return;
        }
        const chunks = [];
        let length = 0;
        file.ondata = (error, data, final) => {
            if (error) throw error;
            length += data.length;
            total += data.length;
            if (total > MAX_ARCHIVE_BYTES) throw new Error("El contenido descomprimido supera 10 MB.");
            chunks.push(data);
            if (final) {
                const content = new Uint8Array(length);
                let offset = 0;
                for (const chunk of chunks) {
                    content.set(chunk, offset);
                    offset += chunk.length;
                }
                files.push({ name: file.name, bytes: content });
                completed++;
            }
        };
        file.start();
    });
    unzipper.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 1024) {
        unzipper.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    }
    if (!files.length || entries !== completed) throw new Error("El ZIP está vacío o no se ha podido leer.");
    return files;
}

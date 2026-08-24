const SAVE_VERSION = 1;

async function savePath(slot) {
  const [{ mkdir, readFile, rename, writeFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const local = globalThis.process?.env?.LOCALAPPDATA || globalThis.process?.cwd?.() || ".";
  const directory = path.join(local, "ThreeBrowser", "MedievalValleyRpg", "saves");
  await mkdir(directory, { recursive: true });
  return {
    file: path.join(directory, `${slot}.json`),
    temporary: path.join(directory, `${slot}.writing.json`),
    readFile,
    rename,
    writeFile,
  };
}

export function createSaveService() {
  return {
    async save(slot, snapshot) {
      const paths = await savePath(slot);
      const envelope = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        snapshot,
      };
      await paths.writeFile(paths.temporary, JSON.stringify(envelope, null, 2), "utf8");
      await paths.rename(paths.temporary, paths.file);
      return paths.file;
    },
    async load(slot) {
      const paths = await savePath(slot);
      try {
        const envelope = JSON.parse(await paths.readFile(paths.file, "utf8"));
        if (envelope?.version !== SAVE_VERSION || !envelope.snapshot) {
          throw new Error("Save file version is not supported.");
        }
        return envelope.snapshot;
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

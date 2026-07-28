import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export function loadRootEnv(): void {
  try {
    loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

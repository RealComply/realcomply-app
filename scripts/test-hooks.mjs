// Lets `node --test` run the TypeScript sources as they are written for Next:
// "@/..." resolves to src/, and extensionless imports find their .ts/.tsx
// file. Node strips the types itself, so there is no build step and no test
// framework to install. Used by `npm test` only; the app never loads this.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const SRC = ${JSON.stringify(new URL("../src/", import.meta.url).href)};
      const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
      export async function resolve(specifier, context, next) {
        const base = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
        const local = base !== specifier || specifier.startsWith(".");
        if (!local) return next(specifier, context);
        let lastError;
        for (const ext of EXTENSIONS) {
          try {
            return await next(base + ext, context);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      }
    `),
);

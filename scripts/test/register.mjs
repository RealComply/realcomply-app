// Loaded with `node --import` by `npm test`. Registers resolve.mjs so the
// test runner can follow the same imports the app uses. See that file.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);

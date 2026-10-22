import { resolveRuntimeRole } from "./runtime/roles.js";

const role = resolveRuntimeRole(process.argv[2], process.env.MAIVW_RUNTIME_ROLE);
process.env.MAIVW_RUNTIME_ROLE = role;

await import("./index.js");

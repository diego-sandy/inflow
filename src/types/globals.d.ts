/** Commit sha of this build, injected by wxt.config.ts (`define`). */
declare const __COMMIT_SHA__: string;
/** Fingerprint of the companion's code this build expects; see wxt.config.ts. */
declare const __COMPANION_SHA__: string;
/** The last commit that changed the companion's code, which older companions stamp instead. */
declare const __COMPANION_LEGACY_SHA__: string;

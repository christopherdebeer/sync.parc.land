/**
 * auth.tsx — Barrel re-exports for MCP auth subsystem.
 *
 * All implementations have been extracted to focused modules.
 * This file preserves the import contract for mcp/mcp.ts.
 */

// OAuth 2.1 protocol
export { handlePRM, handleASMetadata, handleDCR, handleConsent, handleToken } from "./oauth.ts";

// WebAuthn passkeys
export { handleRegisterOptions, handleRegisterVerify, handleAuthOptions, handleAuthVerify } from "./webauthn.ts";

// Management UI + API, authorize page, recovery flow
export {
  handleAuthorize,
  handleManagePage,
  handleManageApi,
  handleRecoverPage,
  handleRecoverValidate,
  handleRecoverRegisterOptions,
  handleRecoverRegisterVerify,
} from "./manage.tsx";

// Legacy token resolution (used by tool-context.ts legacy fallback path)
export { resolveToken } from "./vault.ts";
